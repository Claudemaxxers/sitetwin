import type { SiteEvent, Source, Trade } from "./types";

/** Seed history: what happened on site before the demo starts. */
export function seedEvents(now = Date.now()): SiteEvent[] {
  const day = 86_400_000;
  let n = 0;
  const ev = (
    daysAgo: number,
    source: Source,
    actor: string,
    trade: Trade,
    elementId: string,
    action: SiteEvent["action"],
    drawingRev: string | null,
    rawText: string,
  ): SiteEvent => {
    n += 1;
    const id = `seed-${String(n).padStart(3, "0")}`;
    return {
      id,
      ts: new Date(now - daysAgo * day + n * 60_000).toISOString(),
      source,
      sender: `${actor} (${trade})`,
      rawText,
      messageId: id,
      actor,
      trade,
      elementId,
      action,
      drawingRev,
      confidence: 1,
      summary: rawText,
    };
  };
  return [
    ev(12, "mail", "Petra Huber", "planung", "ALL", "drawing_revised", "B", "Ausführungsplanung EG Rev B freigegeben."),
    ev(11, "chat", "Ali", "elektro", "ALL", "change_acknowledged", "B", "Rev B erhalten 👍"),
    ev(11, "chat", "Sven", "sanitaer", "ALL", "change_acknowledged", "B", "Rev B ok"),
    ev(11, "chat", "Marek", "trockenbau", "ALL", "change_acknowledged", "B", "Pläne Rev B gesehen"),
    ev(9, "chat", "Ali", "elektro", "EG-W-13", "mep_rough_in_done", "B", "Büro Wand 13 Leitungen fertig"),
    ev(9, "chat", "Ali", "elektro", "EG-W-14", "mep_rough_in_done", "B", "Büro Wand 14 Leitungen fertig"),
    ev(8, "mail", "Dr. Klein", "pruefer", "EG-W-13", "inspection_passed", null, "Abnahme Elektro Büro Wand 13 ohne Mängel"),
    ev(8, "mail", "Dr. Klein", "pruefer", "EG-W-14", "inspection_passed", null, "Abnahme Elektro Büro Wand 14 ohne Mängel"),
    ev(6, "chat", "Marek", "trockenbau", "EG-W-13", "wall_closed", "B", "Wand 13 beplankt"),
    ev(6, "chat", "Marek", "trockenbau", "EG-W-14", "wall_closed", "B", "Wand 14 beplankt"),
    ev(4, "chat", "Jana", "maler", "EG-W-13", "finishing_done", null, "Wand 13 gespachtelt"),
    ev(5, "chat", "Sven", "sanitaer", "EG-W-15", "mep_rough_in_done", "B", "Küche Wand 15 Wasser + Abfluss verlegt"),
    ev(4, "mail", "Dr. Klein", "pruefer", "EG-W-15", "inspection_passed", null, "Abnahme Küche Wand 15 ok"),
    ev(3, "chat", "Ali", "elektro", "EG-W-17", "mep_rough_in_done", "B", "Schlafzimmer Wand 17 fertig"),
    ev(2, "mail", "Dr. Klein", "pruefer", "EG-W-17", "inspection_passed", null, "Abnahme Wand 17 ok"),
    ev(1, "chat", "Marek", "trockenbau", "EG-W-17", "wall_closed", "B", "Wand 17 zu"),
    ev(2, "chat", "Sven", "sanitaer", "EG-W-16", "mep_rough_in_done", "B", "Bad Wand 16 Vorwand-Installation fertig"),
  ];
}

export interface ScenarioMessage {
  source: Source;
  sender: string;
  text: string;
  note: string;
}

/** The demo storyline, played message by message. */
export const SCENARIO: ScenarioMessage[] = [
  {
    source: "chat",
    sender: "Ali (Elektro)",
    text: "Leitungen in Bad 1.04 Wand 12 fertig, Dosen gesetzt 👍",
    note: "Installation fertig → Wand 12 wird blau",
  },
  {
    source: "mail",
    sender: "Petra Huber (Planung)",
    text: "Betreff: Rev C Bad 1.04\n\nHallo zusammen, im Bad 1.04 wird die Steckdose an Wand 12 um 40 cm versetzt. Ab sofort gilt Rev C. Bitte alle Gewerke beachten.",
    note: "Planänderung → Bad gilt jetzt Rev C",
  },
  {
    source: "chat",
    sender: "Marek (Trockenbau)",
    text: "Mache morgen früh Wand 12 im Bad zu, nach Plan Rev B",
    note: "Konflikt: keine Abnahme + veralteter Plan → Bauleiter wird alarmiert",
  },
  {
    source: "chat",
    sender: "Marek (Trockenbau)",
    text: "Darf ich Wand 12 heute zumachen?",
    note: "Crew fragt → Antwort aus dem Protokoll",
  },
  {
    source: "chat",
    sender: "Ali (Elektro)",
    text: "Rev C gesehen, versetze die Dose an Wand 12 heute noch",
    note: "Elektro bestätigt die Änderung",
  },
  {
    source: "chat",
    sender: "Tom (Polier)",
    text: "bin hinten fertig mit dem zeug, kann wer schauen",
    note: "Unklare Nachricht → Rückfrage statt Raten",
  },
];
