import { elementName, wallsFor } from "./model";
import type { Flag, RuleId, Severity, SiteEvent, TwinState } from "./types";

export type FlagDraft = Omit<Flag, "id" | "ts" | "status">;

const SEQUENCE_TRADES = new Set(["planung", "bauleitung"]);
export const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Deterministic rule engine. Evaluates one incoming event against the twin
 * state *before* that event and returns the conflicts it creates.
 * `openFlags` is used to avoid raising the same issue twice.
 */
export function evaluate(ev: SiteEvent, before: TwinState, openFlags: Flag[] = []): FlagDraft[] {
  const drafts: FlagDraft[] = [];
  const add = (rule: RuleId, severity: Severity, elementId: string, title: string, reason: string) => {
    const dup = openFlags.some((f) => f.status === "open" && f.rule === rule && f.elementId === elementId);
    const dupHere = drafts.some((d) => d.rule === rule && d.elementId === elementId);
    if (!dup && !dupHere) drafts.push({ rule, severity, elementId, title, reason, eventIds: [ev.id] });
  };
  const who = `${ev.actor} (${ev.trade})`;

  // R5: unsure extraction – ask instead of silently assuming.
  if (ev.confidence < CONFIDENCE_THRESHOLD && ev.action !== "decision_made") {
    add(
      "low_confidence",
      "medium",
      ev.elementId,
      "Rückfrage nötig: Nachricht unklar",
      `Nachricht von ${who} konnte nicht sicher zugeordnet werden (Sicherheit ${Math.round(ev.confidence * 100)} %): „${ev.rawText.slice(0, 140)}“`,
    );
  }

  for (const wallId of wallsFor(ev.elementId)) {
    const w = before[wallId];
    if (!w) continue;
    const name = elementName(wallId);

    // R1: closing (or planning to close) a wall that has not passed inspection.
    if ((ev.action === "wall_closed" || ev.action === "wall_close_planned") && !w.done.inspection_passed) {
      const planned = ev.action === "wall_close_planned";
      add(
        "closed_before_inspection",
        "critical",
        wallId,
        planned ? `${name}: Schließen geplant ohne Abnahme` : `${name}: Wand ohne Abnahme geschlossen`,
        planned
          ? `${who} will ${name} schließen, die Abnahme der Installation fehlt noch. Jetzt ist noch Zeit zu handeln.`
          : `${who} meldet ${name} als geschlossen, eine Abnahme ist nicht dokumentiert. Öffnen oder Abnahme nachweisen.`,
      );
    }

    // R2: work based on an outdated drawing revision.
    if (ev.action !== "drawing_revised" && ev.drawingRev && ev.drawingRev.localeCompare(w.currentRev) < 0) {
      add(
        "stale_drawing",
        "high",
        wallId,
        `${name}: Arbeit nach veraltetem Plan (Rev ${ev.drawingRev})`,
        `${who} arbeitet nach Rev ${ev.drawingRev}, gültig ist Rev ${w.currentRev}.`,
      );
    }

    // R3: out of sequence (closing without inspection is covered by R1).
    if (ev.action === "inspection_passed" && !w.done.mep_rough_in_done) {
      add("out_of_sequence", "high", wallId, `${name}: Abnahme vor Installation`, `${who} meldet eine Abnahme, die Installation ist aber nicht als fertig gemeldet.`);
    }
    if (ev.action === "finishing_done" && !w.done.wall_closed) {
      add("out_of_sequence", "high", wallId, `${name}: Spachteln vor Beplankung`, `${who} meldet Oberflächenarbeiten, die Wand ist aber nicht als geschlossen gemeldet.`);
    }
    if ((ev.action === "wall_closed" || ev.action === "wall_close_planned") && w.done.inspection_passed && !w.done.mep_rough_in_done) {
      add("out_of_sequence", "high", wallId, `${name}: Schließen vor Installation`, `${who} will ${name} schließen, die Installation ist nicht gemeldet.`);
    }

    // R4: a trade works on a wall whose latest change it never confirmed.
    const isWork = ["mep_rough_in_done", "wall_closed", "wall_close_planned", "finishing_done"].includes(ev.action);
    if (isWork && !ev.drawingRev && w.revEventId && !SEQUENCE_TRADES.has(ev.trade) && !w.acks.includes(ev.trade)) {
      add(
        "unacknowledged_change",
        "medium",
        wallId,
        `${name}: Planänderung Rev ${w.currentRev} nicht bestätigt`,
        `${who} arbeitet an ${name}, hat die Änderung auf Rev ${w.currentRev} aber nicht bestätigt.`,
      );
    }
  }
  return drafts;
}
