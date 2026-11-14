import type { Signal } from "@/lib/twin-model";

export type { Signal };

/** Zeile aus `personen` (uebersetzer/schema.sql). */
export interface Person {
  id?: string;
  projekt: string;
  name: string;
  aliase: string[] | null;
  firma?: string | null;
  rolle: string;
  telefon: string | null;
}

/** Zeile aus `signal_verlauf`: jeder Statuswechsel, per Trigger geschrieben. */
export interface VerlaufZeile {
  signal_id: string;
  status: string;
  zeitpunkt: string;
}

/** Was der Telefon-Agent an der Datenbank braucht. Echte Implementierung: supabase.ts, Tests: Fake. */
export interface SignalDB {
  /** status = 'offen' und angerufen_am is null, älteste zuerst. */
  offeneSignale(): Promise<Signal[]>;
  personen(projekt: string): Promise<Person[]>;
  /** Statuswechsel der genannten Signale (für die Zählung der Anrufversuche). */
  verlauf(signalIds: string[]): Promise<VerlaufZeile[]>;
  /** Setzt angerufen_am atomar, nur wenn es noch null ist. false = ein anderer Lauf war schneller. */
  signalBeanspruchen(id: string, angerufenAm: string): Promise<boolean>;
  signalAendern(id: string, felder: Partial<Signal>): Promise<void>;
  signalZuAnruf(conversationId: string): Promise<Signal | null>;
}

/** Vertrag v1 der Ablage für Anrufe (ablage/ablage/adapters/call.py). */
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
