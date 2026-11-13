import { describe, expect, it } from "vitest";
import { evaluate } from "@/lib/rules";
import { deriveTwin } from "@/lib/twin";
import { heuristicExtract } from "@/lib/heuristic";
import { SCENARIO, seedEvents } from "@/lib/scenario";
import { answerFromRecord, isLearnedNoise, isQuestion, learnFromDecisions } from "@/lib/answer";
import type { Action, Flag, SiteEvent, Trade } from "@/lib/types";

let n = 0;
function ev(action: Action, elementId: string, opts: Partial<SiteEvent> & { trade?: Trade } = {}): SiteEvent {
  n += 1;
  return {
    id: `t${n}`,
    ts: new Date(2026, 0, 1, 0, n).toISOString(),
    source: "chat",
    sender: "Test",
    rawText: "",
    messageId: `m${n}`,
    actor: "Test",
    trade: "trockenbau",
    elementId,
    action,
    drawingRev: null,
    confidence: 0.9,
    summary: "",
    ...opts,
  };
}
const rules = (e: SiteEvent, history: SiteEvent[], open: Flag[] = []) => evaluate(e, deriveTwin(history), open).map((f) => f.rule);

describe("twin derivation", () => {
  it("follows the work steps", () => {
    const t = deriveTwin([ev("mep_rough_in_done", "EG-W-12", { trade: "elektro" }), ev("inspection_passed", "EG-W-12", { trade: "pruefer" })]);
    expect(t["EG-W-12"].status).toBe("inspected");
    expect(t["EG-W-01"].status).toBe("open");
  });
  it("expands room events to its walls and resets acks on a new revision", () => {
    const t = deriveTwin([
      ev("change_acknowledged", "ALL", { drawingRev: "A", trade: "elektro" }),
      ev("drawing_revised", "EG-R-1.04", { drawingRev: "C", trade: "planung" }),
    ]);
    expect(t["EG-W-12"].currentRev).toBe("C");
    expect(t["EG-W-03"].currentRev).toBe("C");
    expect(t["EG-W-13"].currentRev).toBe("A");
    expect(t["EG-W-12"].acks).toEqual([]);
    expect(t["EG-W-13"].acks).toEqual(["elektro"]);
  });
  it("a failed inspection removes the inspected step", () => {
    const t = deriveTwin([ev("mep_rough_in_done", "EG-W-12"), ev("inspection_passed", "EG-W-12"), ev("inspection_failed", "EG-W-12")]);
    expect(t["EG-W-12"].status).toBe("installed");
  });
});

describe("rules", () => {
  const installed = [ev("mep_rough_in_done", "EG-W-12", { trade: "elektro" })];
  const inspected = [...installed, ev("inspection_passed", "EG-W-12", { trade: "pruefer" })];

  it("R1 flags closing (or planning to close) before inspection", () => {
    expect(rules(ev("wall_closed", "EG-W-12"), installed)).toContain("closed_before_inspection");
    expect(rules(ev("wall_close_planned", "EG-W-12"), installed)).toContain("closed_before_inspection");
    expect(rules(ev("wall_closed", "EG-W-12"), inspected)).not.toContain("closed_before_inspection");
  });

  it("R2 flags work from an outdated revision", () => {
    const h = [...inspected, ev("drawing_revised", "EG-W-12", { drawingRev: "C", trade: "planung" })];
    expect(rules(ev("wall_closed", "EG-W-12", { drawingRev: "B" }), h)).toContain("stale_drawing");
    expect(rules(ev("wall_closed", "EG-W-12", { drawingRev: "C" }), h)).not.toContain("stale_drawing");
  });

  it("R3 flags steps out of sequence", () => {
    expect(rules(ev("inspection_passed", "EG-W-12", { trade: "pruefer" }), [])).toContain("out_of_sequence");
    expect(rules(ev("finishing_done", "EG-W-12", { trade: "maler" }), inspected)).toContain("out_of_sequence");
    expect(rules(ev("finishing_done", "EG-W-12", { trade: "maler" }), [...inspected, ev("wall_closed", "EG-W-12")])).toEqual([]);
  });

  it("R4 flags work by a trade that never confirmed the latest change", () => {
    const h = [...inspected, ev("drawing_revised", "EG-W-12", { drawingRev: "C", trade: "planung" })];
    expect(rules(ev("wall_closed", "EG-W-12"), h)).toContain("unacknowledged_change");
    const acked = [...h, ev("change_acknowledged", "EG-W-12", { drawingRev: "C", trade: "trockenbau" })];
    expect(rules(ev("wall_closed", "EG-W-12"), acked)).toEqual([]);
  });

  it("R5 asks back on low confidence", () => {
    expect(rules(ev("note", "ALL", { confidence: 0.3 }), [])).toEqual(["low_confidence"]);
  });

  it("does not raise the same open flag twice", () => {
    const e = ev("wall_close_planned", "EG-W-12");
    const first = evaluate(e, deriveTwin(installed));
    const open = first.map((d, i) => ({ ...d, id: `f${i}`, ts: e.ts, status: "open" as const }));
    expect(rules(ev("wall_closed", "EG-W-12"), installed, open)).not.toContain("closed_before_inspection");
  });
});

describe("demo scenario end to end (heuristic extractor)", () => {
  it("raises R1 + R2 on the drywall message and nothing on the clean ones", () => {
    const history = seedEvents(Date.UTC(2026, 10, 13));
    const results = SCENARIO.filter((m) => !isQuestion(m.text)).map((m) => {
      const x = heuristicExtract(m.text, m.sender);
      const e = ev(x.action, x.elementId, { ...x, rawText: m.text });
      const r = evaluate(e, deriveTwin(history)).map((f) => f.rule);
      history.push(e);
      return r;
    });
    expect(results[0]).toEqual([]);
    expect(results[1]).toEqual([]);
    expect(results[2].sort()).toEqual(["closed_before_inspection", "stale_drawing"]);
    expect(results[3]).toEqual([]);
    expect(results[4]).toEqual(["low_confidence"]);
    const twin = deriveTwin(history);
    expect(twin["EG-W-12"].currentRev).toBe("C");
    expect(twin["EG-W-12"].acks).toContain("elektro");
  });
});

describe("answers and learning loop", () => {
  it("answers a crew question from the record", () => {
    const h = [ev("mep_rough_in_done", "EG-W-12", { trade: "elektro" })];
    const a = answerFromRecord("Darf ich Wand 12 zumachen?", deriveTwin(h), [], h);
    expect(isQuestion("Darf ich Wand 12 zumachen?")).toBe(true);
    expect(a).toContain("Abnahme fehlt");
    expect(a).toContain("Noch nicht schließen");
  });
  it("downgrades a flag the superintendent keeps approving, never one they stopped", () => {
    const e1 = ev("wall_closed", "EG-W-01", { trade: "maler" });
    const e2 = ev("wall_closed", "EG-W-02", { trade: "maler" });
    const f = (id: string, e: SiteEvent, status: Flag["status"]): Flag => ({ id, ts: e.ts, rule: "unacknowledged_change", severity: "medium", elementId: e.elementId, title: "", reason: "", eventIds: [e.id], status });
    const approved = [f("a", e1, "approved"), f("b", e2, "approved")];
    expect(isLearnedNoise(learnFromDecisions(approved, [e1, e2]), "unacknowledged_change", "maler")).toBe(true);
    const withStop = [...approved, f("c", e2, "stopped")];
    expect(isLearnedNoise(learnFromDecisions(withStop, [e1, e2]), "unacknowledged_change", "maler")).toBe(false);
  });
});
