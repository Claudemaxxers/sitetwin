import { ts, zwilling, type ProjektDaten, type Zwilling } from "@/lib/twin-model";
import {
  aenderungen,
  anfragen,
  firmaFuerRolle,
  leistungen,
  morgen,
  nachrichten,
  personenVerzeichnis,
  tagesberichte,
  type Aenderung,
  type Anfrage,
  type Leistung,
  type Nachricht,
  type Personen,
  type Tagesbericht,
} from "@/lib/vm";

export type Ansicht = "aenderungen" | "inbox" | "bautagebuch" | "protokoll" | "benachrichtigungen";

export interface Modell {
  d: ProjektDaten;
  z: Zwilling;
  pers: Personen;
  ch: Aenderung[];
  req: Anfrage[];
  leist: Leistung[];
  logs: Tagesbericht[];
  msgs: Nachricht[];
  digest: ReturnType<typeof morgen>;
  jetzt: number;
  bauherr: string;
  projektFoto: string | null;
}

export function baueModell(d: ProjektDaten): Modell {
  const z = zwilling(d);
  const pers = personenVerzeichnis(d);
  const jetzt = Math.max(0, ...d.eintraege.map((e) => ts(e.zeitpunkt)), ...d.quellen.map((q) => ts(q.zeitpunkt)));
  const ch = aenderungen(d, pers, d.signale);
  const req = anfragen(d, pers, jetzt);
  return {
    d,
    z,
    pers,
    ch,
    req,
    leist: leistungen(d, pers),
    logs: tagesberichte(d, pers),
    msgs: nachrichten(d, pers),
    digest: morgen(d, pers, ch, req, d.signale, jetzt),
    jetzt,
    bauherr: firmaFuerRolle(d, /bauherr|bauträger/i) ?? "Bauherr",
    projektFoto: d.quellen.find((q) => q.anhang_pfad && /\.(jpe?g|png)$/i.test(q.anhang_pfad))?.anhang_pfad ?? null,
  };
}

export interface Nav {
  zu: (a: Ansicht) => void;
  aenderung: (key: string | null) => void;
  exposure: () => void;
  nachricht: (hash: string) => void;
  thread: (hash: string) => void;
  entwurf: (c: Aenderung) => void;
  fragen: (frage?: string) => void;
}

export const anhangUrl = (pfad: string) => `/api/anhang?pfad=${encodeURIComponent(pfad)}`;
