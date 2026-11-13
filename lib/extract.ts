import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ROOMS, WALLS, isKnownElement } from "./model";
import { heuristicExtract, parseSender, type Extracted } from "./heuristic";
import type { TwinState } from "./types";

const ACTIONS = [
  "mep_rough_in_done",
  "inspection_passed",
  "inspection_failed",
  "wall_close_planned",
  "wall_closed",
  "finishing_done",
  "drawing_revised",
  "change_acknowledged",
  "note",
] as const;
const TRADES = ["elektro", "sanitaer", "trockenbau", "maler", "planung", "bauleitung", "pruefer", "unbekannt"] as const;

const ExtractionSchema = z.object({
  events: z.array(
    z.object({
      element_id: z.string(),
      action: z.enum(ACTIONS),
      trade: z.enum(TRADES),
      actor: z.string(),
      drawing_rev: z.string().nullable(),
      confidence: z.number(),
      summary: z.string(),
    }),
  ),
});

const SYSTEM = `You turn construction-site messages (group chat, email, photos) into structured events for a digital twin of the building.

Building elements (use these exact ids):
${ROOMS.map((r) => `- ${r.id}: ${r.name}`).join("\n")}
${WALLS.map((w) => `- ${w.id}: ${w.label}, ${w.kind}, between ${w.rooms.join(" and ")}`).join("\n")}
- ALL: the whole floor

Actions:
- mep_rough_in_done: electrical/plumbing rough-in in a wall is finished
- inspection_passed / inspection_failed: inspection before closing the wall
- wall_close_planned: someone announces they WILL close/board a wall (future tense, "morgen", "mache ... zu")
- wall_closed: a wall HAS been closed/boarded
- finishing_done: filling/plastering/painting finished
- drawing_revised: a planner issues a new drawing revision (set drawing_rev to the new letter)
- change_acknowledged: a trade confirms it has seen a revision
- note: anything else

Rules:
- One message can contain several events; return one per element and action.
- Prefer a wall id when a wall is named ("Wand 12" -> EG-W-12); use a room id when only a room is named.
- drawing_rev: the revision letter the sender refers to or works from ("nach Plan Rev B" -> "B"), else null.
- Infer the trade from the sender label and content.
- confidence 0..1: how sure you are about element AND action. Vague messages ("bin hinten fertig") get below 0.5 with action "note".
- summary: one short German sentence.`;

let client: Anthropic | null = null;

export async function extractEvents(input: {
  text: string;
  sender: string;
  image?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };
  twin: TwinState;
}): Promise<{ events: Extracted[]; engine: "claude" | "heuristic" }> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return { events: [heuristicExtract(input.text, input.sender)], engine: "heuristic" };
  }
  client ??= new Anthropic();
  const revs = Object.values(input.twin)
    .map((w) => `${w.id}: Rev ${w.currentRev}, Status ${w.status}`)
    .join("\n");

  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) {
    content.push({ type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } });
  }
  content.push({
    type: "text",
    text: `Current state:\n${revs}\n\nSender: ${input.sender}\nMessage:\n${input.text || "(photo only – describe what the photo shows about the walls)"}`,
  });

  try {
    const response = await client.messages.parse({
      model: process.env.SITETWIN_MODEL || "claude-sonnet-5-5",
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(ExtractionSchema) },
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return { events: [heuristicExtract(input.text, input.sender)], engine: "heuristic" };
    }
    const fallbackSender = parseSender(input.sender);
    const events = response.parsed_output.events.map<Extracted>((e) => {
      const known = isKnownElement(e.element_id);
      return {
        elementId: known ? e.element_id : "ALL",
        action: known ? e.action : "note",
        trade: e.trade === "unbekannt" ? fallbackSender.trade : e.trade,
        actor: e.actor || fallbackSender.actor,
        drawingRev: e.drawing_rev ? e.drawing_rev.toUpperCase() : null,
        confidence: known ? Math.max(0, Math.min(1, e.confidence)) : 0.3,
        summary: e.summary,
      };
    });
    return { events: events.length ? events : [heuristicExtract(input.text, input.sender)], engine: "claude" };
  } catch (err) {
    console.error("[extract] Claude call failed, using heuristic:", err instanceof Error ? err.message : err);
    return { events: [heuristicExtract(input.text, input.sender)], engine: "heuristic" };
  }
}
