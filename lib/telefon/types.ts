import type { Signal } from "@/lib/twin-model";

export type { Signal };

/** Row from `personen` (uebersetzer/schema.sql). */
export interface Person {
  id?: string;
  projekt: string;
  name: string;
  aliase: string[] | null;
  firma?: string | null;
  rolle: string;
  telefon: string | null;
}

/** Row from `signal_verlauf`: every status change, written by a trigger. */
export interface VerlaufZeile {
  signal_id: string;
  status: string;
  zeitpunkt: string;
}

/** What the phone agent needs from the database. Real implementation: supabase.ts, tests: fake. */
export interface SignalDB {
  /** status = 'offen' and angerufen_am is null, oldest first. */
  offeneSignale(): Promise<Signal[]>;
  personen(projekt: string): Promise<Person[]>;
  /** Status changes of the given signals (for counting call attempts). */
  verlauf(signalIds: string[]): Promise<VerlaufZeile[]>;
  /** Sets angerufen_am atomically, only if it is still null. false = another run was faster. */
  signalBeanspruchen(id: string, angerufenAm: string): Promise<boolean>;
  signalAendern(id: string, felder: Partial<Signal>): Promise<void>;
  signalZuAnruf(conversationId: string): Promise<Signal | null>;
}

/** Ablage contract v1 for calls (ablage/ablage/adapters/call.py). */
export interface AblageCall {
  call_id: string;
  gestartet_um: string;
  transkript: { rolle: "agent" | "person"; text: string }[];
  projekt?: string | null;
  angerufene_person?: string | null;
  telefon?: string | null;
  richtung?: string | null;
  beendet_um?: string | null;
  zusammenfassung?: string | null;
}
