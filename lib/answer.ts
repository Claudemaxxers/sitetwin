import { ROOMS, WALLS, elementName, wallsFor } from "./model";
import type { Flag, SiteEvent, TwinState } from "./types";

/** A crew message that asks something instead of reporting work. */
export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.endsWith("?") || /^(welche|welcher|was|wann|wer|darf|kann ich|können wir|ist|gilt|wo)\b/.test(t);
}

export function findElement(text: string): string | null {
  const t = text.toLowerCase();
  const n = t.match(/wand\s*(\d{1,2})/);
  if (n) return WALLS.find((w) => w.label === `Wand ${Number(n[1])}`)?.id ?? null;
  const room = ROOMS.find((r) => {
    const [word, num] = r.name.toLowerCase().split(" ");
    return t.includes(num) || new RegExp(`\\b${word}`).test(t);
  });
  return room?.id ?? null;
}

/** Answer from the record only – never from guesswork. */
export function answerFromRecord(text: string, twin: TwinState, flags: Flag[], events: SiteEvent[]): string {
  const id = findElement(text);
  if (!id) {
    const open = flags.filter((f) => f.status === "open");
    return open.length
      ? `Aktuell ${open.length} offene Punkte bei der Bauleitung: ${open.map((f) => f.title).join("; ")}.`
      : "Kein offener Konflikt im Protokoll. Für Details bitte Raum oder Wandnummer nennen.";
  }
  const walls = wallsFor(id);
  const lines = walls.slice(0, 4).map((w) => {
    const s = twin[w];
    const missing = !s.done.mep_rough_in_done ? "Installation fehlt" : !s.done.inspection_passed ? "Abnahme fehlt" : null;
    return `${elementName(w)}: gültig Rev ${s.currentRev}${s.acks.length ? ` (bestätigt: ${s.acks.join(", ")})` : ""}${missing ? `, ${missing}` : ""}`;
  });
  const own = flags.filter((f) => walls.includes(f.elementId) || f.elementId === id);
  const open = own.filter((f) => f.status === "open");
  const stopped = own.filter((f) => f.status === "stopped");
  const closeAsk = /(zu ?machen|schließen|schliessen|beplanken|zumachen)/i.test(text);
  let verdict = "";
  if (open.length) verdict = ` ⚠ Offen bei der Bauleitung: ${open.map((f) => f.title).join("; ")}. Bitte warten.`;
  else if (stopped.length) verdict = ` 🛑 Gestoppt von ${stopped[0].decidedBy}${stopped[0].comment ? `: „${stopped[0].comment}“` : ""}.`;
  else if (closeAsk) {
    const ready = walls.every((w) => twin[w].done.inspection_passed);
    verdict = ready ? " ✅ Abnahme liegt vor, Schließen ist freigegeben." : " ✋ Noch nicht schließen: Abnahme fehlt.";
  }
  const last = [...events].reverse().find((e) => wallsFor(e.elementId).some((w) => walls.includes(w)) && e.action !== "question_answered");
  const lastLine = last ? ` Letzte Änderung: ${last.actor} (${last.trade}).` : "";
  return `${lines.join(" · ")}.${verdict}${lastLine}`;
}

/**
 * Learning loop: when the superintendent keeps approving the same kind of flag
 * from the same trade, the system learns it is noise and downgrades it.
 * Stops are reinforced: those flags never get downgraded.
 */
export type Lessons = Record<string, { approved: number; stopped: number }>;

export function learnFromDecisions(flags: Flag[], events: SiteEvent[]): Lessons {
  const byId = new Map(events.map((e) => [e.id, e]));
  const lessons: Lessons = {};
  for (const f of flags) {
    if (f.status === "open") continue;
    const trade = byId.get(f.eventIds[0])?.trade ?? "unbekannt";
    const k = `${f.rule}:${trade}`;
    lessons[k] ??= { approved: 0, stopped: 0 };
    if (f.status === "approved") lessons[k].approved++;
    else lessons[k].stopped++;
  }
  return lessons;
}

export function isLearnedNoise(lessons: Lessons, rule: string, trade: string): boolean {
  const l = lessons[`${rule}:${trade}`];
  return !!l && l.approved >= 2 && l.stopped === 0;
}
