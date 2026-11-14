export type Trade =
  | "elektro"
  | "sanitaer"
  | "trockenbau"
  | "maler"
  | "planung"
  | "bauleitung"
  | "pruefer"
  | "unbekannt";

export type Source = "telegram" | "mail" | "foto" | "chat" | "ui" | "seed";

/** Work steps in the order they must happen on a wall. */
export const STEP_ORDER = [
  "mep_rough_in_done", // MEP rough-in (electrical/plumbing) done
  "inspection_passed", // inspection before closing
  "wall_closed", // Trockenbau beplankt / Wand geschlossen
  "finishing_done", // Spachteln / Malen
] as const;
export type Step = (typeof STEP_ORDER)[number];

export type Action =
  | Step
  | "wall_close_planned" // announcement: "mache morgen zu" (closing up tomorrow) – early enough to intervene
  | "inspection_failed"
  | "drawing_revised"
  | "change_acknowledged"
  | "decision_made"
  | "question_answered"
  | "note";

export const WORK_ACTIONS: Action[] = [
  "mep_rough_in_done",
  "inspection_passed",
  "wall_closed",
  "wall_close_planned",
  "finishing_done",
];

export interface SiteEvent {
  id: string;
  ts: string; // ISO
  source: Source;
  sender: string;
  rawText: string;
  messageId: string; // groups events extracted from one message
  actor: string;
  trade: Trade;
  elementId: string; // wall id, room id or "ALL"
  action: Action;
  drawingRev: string | null;
  confidence: number;
  summary: string;
  flagId?: string; // for decision_made
  outcome?: "approve" | "stop";
}

export type Severity = "critical" | "high" | "medium";
export type RuleId =
  | "closed_before_inspection"
  | "stale_drawing"
  | "out_of_sequence"
  | "unacknowledged_change"
  | "low_confidence";

export interface Flag {
  id: string;
  ts: string;
  rule: RuleId;
  severity: Severity;
  elementId: string;
  title: string;
  reason: string;
  eventIds: string[];
  status: "open" | "approved" | "stopped";
  decidedAt?: string;
  decidedBy?: string;
  comment?: string;
}

export type WallStatus = "open" | "installed" | "inspected" | "closed" | "finished";

export interface WallState {
  id: string;
  status: WallStatus;
  done: Partial<Record<Step, string>>; // step -> event id
  closePlanned: boolean;
  currentRev: string;
  revEventId: string | null;
  acks: Trade[]; // trades that confirmed the current revision
  history: string[]; // event ids, oldest first
}

export type TwinState = Record<string, WallState>;
