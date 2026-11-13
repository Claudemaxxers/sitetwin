import "server-only";
import { randomUUID } from "node:crypto";
import { extractEvents } from "./extract";
import { evaluate } from "./rules";
import { appendEvent, broadcast, getEvents, getFlags, saveFlag } from "./store";
import { notifySuperintendent } from "./telegram";
import { applyEvent, deriveTwin } from "./twin";
import { elementName } from "./model";
import { answerFromRecord, findElement, isLearnedNoise, isQuestion, learnFromDecisions } from "./answer";
import { parseSender } from "./heuristic";
import type { Flag, SiteEvent, Source } from "./types";

export interface IngestInput {
  source: Source;
  sender: string;
  text: string;
  image?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };
}

/** Message in → events appended → rules evaluated → flags raised → everyone notified. */
export async function ingest(input: IngestInput) {
  const history = getEvents();
  const allFlags = getFlags();
  const twin = deriveTwin(history);

  // Crews can ask: the answer comes from the record, decisions stay with the superintendent.
  if (input.text && !input.image && isQuestion(input.text)) {
    const { actor, trade } = parseSender(input.sender);
    const answer = answerFromRecord(input.text, twin, allFlags, history);
    const ev: SiteEvent = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      source: input.source,
      sender: input.sender,
      rawText: input.text,
      messageId: randomUUID(),
      actor,
      trade,
      elementId: findElement(input.text) ?? "ALL",
      action: "question_answered",
      drawingRev: null,
      confidence: 1,
      summary: answer,
    };
    appendEvent(ev);
    broadcast("ingest");
    return { engine: "record" as const, events: [ev], flags: [] as Flag[], answer };
  }

  const { events: extracted, engine } = await extractEvents({ ...input, twin });
  const lessons = learnFromDecisions(allFlags, history);

  const messageId = randomUUID();
  const created: SiteEvent[] = [];
  const newFlags: Flag[] = [];
  const openFlags = allFlags.filter((f) => f.status === "open");

  for (const x of extracted) {
    const ev: SiteEvent = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      source: input.source,
      sender: input.sender,
      rawText: input.text || "(Foto)",
      messageId,
      ...x,
    };
    for (const d of evaluate(ev, twin, [...openFlags, ...newFlags])) {
      const learned = d.severity !== "critical" && isLearnedNoise(lessons, d.rule, ev.trade);
      newFlags.push({
        ...d,
        severity: learned ? "medium" : d.severity,
        reason: learned ? `${d.reason} (Gelernt: Bauleitung hat das bei ${ev.trade} mehrfach freigegeben, daher niedrige Priorität.)` : d.reason,
        id: randomUUID(),
        ts: ev.ts,
        status: "open",
      });
    }
    appendEvent(ev);
    applyEvent(twin, ev);
    created.push(ev);
  }
  newFlags.forEach(saveFlag);
  broadcast("ingest");

  for (const f of newFlags.filter((f) => f.severity !== "medium")) {
    await notifySuperintendent(`⚠️ ${f.title}\n${f.reason}\n\nIn SiteTwin freigeben oder stoppen.`);
  }
  return { engine, events: created, flags: newFlags };
}

/** The superintendent decides; the decision itself becomes part of the record. */
export async function decide(flagId: string, outcome: "approve" | "stop", comment: string, by = "Bauleitung") {
  const flag = getFlags().find((f) => f.id === flagId);
  if (!flag) throw new Error("Flag nicht gefunden");
  if (flag.status !== "open") throw new Error("Flag ist bereits entschieden");

  const ts = new Date().toISOString();
  const verdict = outcome === "approve" ? "freigegeben" : "gestoppt";
  const ev: SiteEvent = {
    id: randomUUID(),
    ts,
    source: "ui",
    sender: `${by} (bauleitung)`,
    rawText: comment || `${flag.title}: ${verdict}`,
    messageId: randomUUID(),
    actor: by,
    trade: "bauleitung",
    elementId: flag.elementId,
    action: "decision_made",
    drawingRev: null,
    confidence: 1,
    summary: `${by} hat „${flag.title}“ ${verdict}${comment ? `: ${comment}` : ""}`,
    flagId,
    outcome,
  };
  appendEvent(ev);
  const updated: Flag = {
    ...flag,
    status: outcome === "approve" ? "approved" : "stopped",
    decidedAt: ts,
    decidedBy: by,
    comment,
    eventIds: [...flag.eventIds, ev.id],
  };
  saveFlag(updated);
  broadcast("decision");
  await notifySuperintendent(
    `${outcome === "approve" ? "✅ Freigabe" : "🛑 STOPP"} – ${elementName(flag.elementId)}\n${flag.title}${comment ? `\nBauleitung: ${comment}` : ""}`,
  );
  return { event: ev, flag: updated };
}
