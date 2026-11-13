import { ROOMS, WALLS } from "./model";
import type { Action, Trade } from "./types";

export interface Extracted {
  elementId: string;
  action: Action;
  trade: Trade;
  actor: string;
  drawingRev: string | null;
  confidence: number;
  summary: string;
}

const TRADE_WORDS: [RegExp, Trade][] = [
  [/elektr/i, "elektro"],
  [/sanit|install|heizung|hls/i, "sanitaer"],
  [/trocken|ständer|rigips/i, "trockenbau"],
  [/maler|spachtel/i, "maler"],
  [/plan|archit/i, "planung"],
  [/polier|bauleit|super/i, "bauleitung"],
  [/prüf|pruef|sachverst|abnahme/i, "pruefer"],
];

export function parseSender(sender: string): { actor: string; trade: Trade } {
  const m = sender.match(/^(.*?)\s*\((.+)\)\s*$/);
  const actor = (m ? m[1] : sender).trim() || "Unbekannt";
  const hint = m ? m[2] : sender;
  const trade = TRADE_WORDS.find(([re]) => re.test(hint))?.[1] ?? "unbekannt";
  return { actor, trade };
}

/** Rule-based fallback so the demo works without an API key. */
export function heuristicExtract(text: string, sender: string): Extracted {
  const { actor, trade } = parseSender(sender);
  const t = text.toLowerCase();

  let elementId: string | null = null;
  const wallNo = t.match(/wand\s*(\d{1,2})/);
  if (wallNo) elementId = WALLS.find((w) => w.label === `Wand ${Number(wallNo[1])}`)?.id ?? null;
  if (!elementId) {
    const room = ROOMS.find((r) => {
      const [word, num] = r.name.toLowerCase().split(" ");
      return t.includes(num) || new RegExp(`\\b${word}`).test(t);
    });
    if (room) elementId = room.id;
  }

  const rev = text.match(/\brev(?:ision)?\.?\s*([A-Z])\b/i)?.[1]?.toUpperCase() ?? null;
  const future = /(morgen|heute noch|später|nachher|plane|werde|demnächst|mache .* zu)/.test(t);

  let action: Action | null = null;
  if (/(gesehen|bestätig|verstanden|zur kenntnis|erhalten)/.test(t) && rev) action = "change_acknowledged";
  else if (rev && (trade === "planung" || /(ab sofort gilt|änderung|geändert|versetzt|neue revision)/.test(t))) action = "drawing_revised";
  else if (/(abnahme.*(nicht|mängel|abgelehnt)|nicht abgenommen)/.test(t)) action = "inspection_failed";
  else if (/(abgenommen|abnahme.*(ok|ohne mängel|bestanden)|freigegeben)/.test(t)) action = "inspection_passed";
  else if (/(zu ?machen|mache .* zu|schließe|schliesse|beplanke|zumachen)/.test(t)) action = future ? "wall_close_planned" : "wall_closed";
  else if (/(geschlossen|beplankt|zugemacht|ist zu\b|\bzu$)/.test(t)) action = "wall_closed";
  else if (/(gespachtelt|gestrichen|maler.*fertig|spachtel.*fertig)/.test(t)) action = "finishing_done";
  else if (/(leitung|dose|kabel|rohr|verlegt|installation|abfluss)/.test(t) && /(fertig|verlegt|gesetzt|erledigt)/.test(t)) action = "mep_rough_in_done";

  const ok = elementId && action;
  return {
    elementId: elementId ?? "ALL",
    action: action ?? "note",
    trade,
    actor,
    drawingRev: rev,
    confidence: ok ? 0.8 : 0.35,
    summary: ok ? `${actor}: ${action} an ${elementId}${rev ? ` (Rev ${rev})` : ""}` : `${actor}: unklare Nachricht`,
  };
}
