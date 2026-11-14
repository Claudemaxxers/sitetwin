import type { TelefonConfig } from "./config";
import type { AblageCall, Signal, SignalDB } from "./types";

/** Post-Call-Webhooks von ElevenLabs (Typ post_call_transcription, call_initiation_failure). */
export interface ElevenEvent {
  type: string;
  event_timestamp?: number;
  data: {
    agent_id?: string;
    conversation_id: string;
    status?: string;
    transcript?: { role: string; message: string | null; time_in_call_secs?: number }[];
    metadata?: { start_time_unix_secs?: number; call_duration_secs?: number; termination_reason?: string };
    analysis?: { transcript_summary?: string; call_successful?: string };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
    failure_reason?: string;
  };
}

export interface WebhookErgebnis {
  aktion: "transkript_weitergeleitet" | "transkript_ohne_ablage" | "anruf_fehlgeschlagen" | "ignoriert";
  signal_id: string | null;
  details?: string;
}

const iso = (unixS: number) => new Date(unixS * 1000).toISOString();
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Transkript im Vertrag v1 der Ablage (ablage/adapters/call.py). */
export function ablagePayload(ev: ElevenEvent, signal: Signal | null, fallbackJetztMs = Date.now()): AblageCall {
  const d = ev.data;
  const vars = d.conversation_initiation_client_data?.dynamic_variables ?? {};
  const dauer = d.metadata?.call_duration_secs;
  const start = d.metadata?.start_time_unix_secs ?? (ev.event_timestamp ?? Math.floor(fallbackJetztMs / 1000)) - (dauer ?? 0);
  return {
    call_id: d.conversation_id,
    gestartet_um: iso(start),
    beendet_um: dauer != null ? iso(start + dauer) : null,
    transkript: (d.transcript ?? [])
      .filter((t) => typeof t.message === "string" && t.message.trim())
      .map((t) => ({ rolle: t.role === "agent" ? "agent" : "person", text: (t.message as string).trim() })),
    projekt: signal?.projekt ?? str(vars.projekt_name),
    angerufene_person: signal?.zustaendig ?? str(vars.zustaendig_name),
    telefon: signal?.telefon ?? null,
    richtung: "outbound",
    zusammenfassung: str(d.analysis?.transcript_summary),
  };
}

/**
 * post_call_transcription: Transkript an die Ablage (/import/call), damit es wie jede andere Quelle
 * durch Übersetzer und Prüf-Agent läuft. status und bewertung_notiz setzt der ElevenLabs-Agent
 * selbst (Tool signal_abschliessen), hier wird daran nichts geändert.
 * call_initiation_failure: nicht erreicht → zurück auf offen, angerufen_am leer, damit der nächste
 * Lauf es erneut versucht (begrenzt über TELEFON_MAX_VERSUCHE und TELEFON_WARTEZEIT_MIN).
 */
export async function ereignisVerarbeiten(ev: ElevenEvent, db: SignalDB, cfg: TelefonConfig, fetchFn: typeof fetch = fetch): Promise<WebhookErgebnis> {
  const convId = ev.data?.conversation_id;
  if (!convId) return { aktion: "ignoriert", signal_id: null, details: "kein conversation_id" };
  const signal = await db.signalZuAnruf(convId);

  if (ev.type === "post_call_transcription") {
    const payload = ablagePayload(ev, signal);
    if (!cfg.ablageUrl) {
      return { aktion: "transkript_ohne_ablage", signal_id: signal?.id ?? null, details: "ABLAGE_URL nicht gesetzt" };
    }
    const res = await fetchFn(`${cfg.ablageUrl.replace(/\/+$/, "")}/import/call`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.ablageToken ? { "X-Ablage-Token": cfg.ablageToken } : {}) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Ablage /import/call: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return { aktion: "transkript_weitergeleitet", signal_id: signal?.id ?? null, details: `${payload.transkript.length} Gesprächsbeiträge` };
  }

  if (ev.type === "call_initiation_failure") {
    if (signal) await db.signalAendern(signal.id, { status: "offen", angerufen_am: null });
    return { aktion: "anruf_fehlgeschlagen", signal_id: signal?.id ?? null, details: ev.data.failure_reason ?? "unbekannt" };
  }

  return { aktion: "ignoriert", signal_id: signal?.id ?? null, details: ev.type };
}
