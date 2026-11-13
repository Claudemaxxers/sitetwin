import type { Action, Severity, Source, WallStatus } from "@/lib/types";

export const STATUS_COLOR: Record<WallStatus, string> = {
  open: "#b8b2ab",
  installed: "#2f6fe0",
  inspected: "#2f9e5b",
  closed: "#d9a21b",
  finished: "#efece8",
};
export const STATUS_LABEL: Record<WallStatus, string> = {
  open: "Offen",
  installed: "Installiert",
  inspected: "Abgenommen",
  closed: "Geschlossen",
  finished: "Fertig",
};
export const CONFLICT_COLOR = "#dc3b2f";
export const STOPPED_COLOR = "#ee783b";

export const SEVERITY_STYLE: Record<Severity, { label: string; color: string }> = {
  critical: { label: "KRITISCH", color: "#dc3b2f" },
  high: { label: "HOCH", color: "#ee783b" },
  medium: { label: "MITTEL", color: "#d9a21b" },
};

export const ACTION_LABEL: Record<Action, string> = {
  mep_rough_in_done: "Installation fertig",
  inspection_passed: "Abnahme bestanden",
  inspection_failed: "Abnahme nicht bestanden",
  wall_close_planned: "Schließen geplant",
  wall_closed: "Wand geschlossen",
  finishing_done: "Spachteln fertig",
  drawing_revised: "Planänderung",
  change_acknowledged: "Änderung bestätigt",
  decision_made: "Entscheidung Bauleitung",
  question_answered: "Antwort aus dem Protokoll",
  note: "Notiz / unklar",
};

export const SOURCE_ICON: Record<Source, string> = {
  telegram: "✈️",
  mail: "✉️",
  foto: "📷",
  chat: "💬",
  ui: "🧑‍💼",
  seed: "📁",
};

export function timeLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}
