import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getProjektDaten, supabaseConfigured } from "@/lib/sb";
import type { Eintrag } from "@/lib/twin-model";

export const dynamic = "force-dynamic";

/**
 * "Ask Talona": answers only from the record, every answer names its sources.
 * Uses Claude when credentials are configured; otherwise a plain search over the record.
 */
const Antwort = z.object({
  antwort: z.string(),
  quellen: z.array(z.string()),
});

const SYSTEM = `Du bist SiteTwin, der Assistent einer Baustelle. Du beantwortest Fragen des Büros ausschließlich aus dem Protokoll unten.
Regeln:
- Antworte auf Deutsch, in zwei bis vier kurzen Sätzen, wie ein Polier am Telefon. Nenne Namen und Zeitpunkte.
- Nutze nur Fakten aus dem Protokoll. Wenn etwas nicht drinsteht, sag das klar.
- Gib in "quellen" die IDs der Einträge an, auf die sich die Antwort stützt (höchstens 5).`;

function zeile(e: Eintrag) {
  const t = e.zeitpunkt ? new Date(e.zeitpunkt).toLocaleString("de-AT", { timeZone: "Europe/Vienna", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  return `[${e.id}] ${t} · ${e.person ?? "?"} · ${[e.top, e.raum, e.element].filter(Boolean).join(" / ")} · ${e.art}: ${e.zusammenfassung}${e.wartet_auf ? ` (wartet auf: ${e.wartet_auf})` : ""}`;
}

function suche(frage: string, eintraege: Eintrag[]) {
  const worte = frage
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["was", "ist", "der", "die", "das", "wer", "wie", "wann", "mit", "und", "den", "dem", "hat", "gibt", "noch", "diese", "woche", "beim", "stand"].includes(w));
  const top = frage.match(/top\s*(\d+)/i)?.[1];
  return eintraege
    .map((e) => {
      const text = `${e.zusammenfassung} ${e.person} ${e.top} ${e.raum} ${e.element} ${e.wartet_auf}`.toLowerCase();
      let score = worte.reduce((a, w) => a + (text.includes(w) ? 1 : 0), 0);
      if (top && e.top === `Top ${top}`) score += 2;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.e.zeitpunkt ?? "").localeCompare(a.e.zeitpunkt ?? ""))
    .slice(0, 4)
    .map((x) => x.e);
}

export async function POST(req: Request) {
  const { projekt, frage } = (await req.json()) as { projekt: string; frage: string };
  if (!frage?.trim() || !supabaseConfigured()) return NextResponse.json({ error: "Keine Frage" }, { status: 400 });
  const d = await getProjektDaten(projekt);
  if (!d) return NextResponse.json({ error: "Projekt nicht gefunden" }, { status: 404 });
  const eintraege = d.eintraege.filter((e) => e.zeitpunkt);

  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    try {
      const client = new Anthropic();
      const protokoll = eintraege.map(zeile).join("\n");
      const signale = d.signale.map((s) => `- ${s.titel} (Status: ${s.status}, zuständig: ${s.zustaendig ?? "–"})`).join("\n");
      const res = await client.beta.messages.parse({
        model: process.env.SITETWIN_ASK_MODEL || "claude-opus-5-5",
        max_tokens: 2000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(Antwort) },
        system: [{ type: "text", text: `${SYSTEM}\n\nProjekt: ${d.projekt.name ?? d.projekt.projekt}\n\nProtokoll:\n${protokoll}\n\nErkannte Abweichungen:\n${signale || "keine"}`, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: frage }],
      });
      if (res.stop_reason !== "refusal" && res.parsed_output) {
        const ids = new Set(res.parsed_output.quellen);
        return NextResponse.json({ antwort: res.parsed_output.antwort, quellen: eintraege.filter((e) => ids.has(e.id)).map((e) => e.id), engine: "claude" });
      }
    } catch (err) {
      console.error("[fragen] Claude-Aufruf fehlgeschlagen, Suche im Protokoll:", err instanceof Error ? err.message : err);
    }
  }

  const treffer = suche(frage, eintraege);
  const antwort = treffer.length
    ? `Dazu steht im Protokoll: ${treffer
        .slice(0, 3)
        .map((e) => e.zusammenfassung.replace(/\.$/, ""))
        .join(". ")}.`
    : "Dazu steht nichts im Protokoll.";
  return NextResponse.json({ antwort, quellen: treffer.map((e) => e.id), engine: "suche" });
}
