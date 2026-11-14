import { createHmac, timingSafeEqual } from "node:crypto";
import type { TelefonConfig } from "./config";
import type { Signal } from "./types";

/**
 * ElevenLabs Agents: ausgehender Anruf über die Twilio-Nummer des Agenten.
 * Doku: POST /v1/convai/twilio/outbound-call; Post-Call-Webhooks mit Header ElevenLabs-Signature.
 *
 * Die Variablennamen sind mit dem System-Prompt des Agenten "Construction Site checkin Agent"
 * abgestimmt. Bewusst KEINE conversation_config_override (erste Nachricht, Prompt): die lehnt die
 * API im Free-Plan ab. Die erste Nachricht ist im Agenten fest hinterlegt, der Prompt nennt bei
 * anruf_modus=ausgehend sofort Ort und Konflikt aus den Variablen.
 */

export interface OutboundBody {
  agent_id: string;
  agent_phone_number_id: string;
  to_number: string;
  conversation_initiation_client_data: {
    dynamic_variables: Record<string, string>;
  };
}

export interface OutboundAntwort {
  success: boolean;
  message: string;
  conversation_id: string | null;
  callSid: string | null;
}

export function vorname(name: string | null | undefined): string {
  const n = (name ?? "").replace(/\(.*?\)/g, "").trim();
  return n.split(/\s+/)[0] || "";
}

/** "Top 5, Abstellraum" bzw. was vom Ort bekannt ist. */
export function signalOrt(s: Pick<Signal, "top" | "raum" | "element">): string {
  const ort = [s.top, s.raum].filter((x): x is string => Boolean(x && x.trim())).join(", ");
  return ort || (s.element ?? "").trim() || "der Baustelle";
}

export function anrufBody(s: Signal, toNumber: string, cfg: TelefonConfig): OutboundBody {
  return {
    agent_id: cfg.agentId,
    agent_phone_number_id: cfg.phoneNumberId,
    to_number: toNumber,
    conversation_initiation_client_data: {
      dynamic_variables: {
        anruf_modus: "ausgehend",
        zustaendig_name: s.zustaendig ?? "",
        zustaendig_vorname: vorname(s.zustaendig),
        signal_id: s.id,
        signal_filter: `eq.${s.id}`,
        signal_titel: s.titel,
        anruf_text: s.anruf_text ?? s.titel,
        signal_begruendung: s.begruendung ?? "",
        signal_ort: signalOrt(s),
        signal_schwere: s.schwere,
        signal_art: s.art,
        projekt_name: s.projekt || cfg.projektName,
      },
    },
  };
}

export type AnrufStarter = (body: OutboundBody, cfg: TelefonConfig) => Promise<OutboundAntwort>;

export const anrufStarten: AnrufStarter = async (body, cfg) => {
  const res = await fetch(`${cfg.baseUrl}/v1/convai/twilio/outbound-call`, {
    method: "POST",
    headers: { "xi-api-key": cfg.apiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs outbound-call: ${res.status} ${text.slice(0, 300)}`);
  const out = JSON.parse(text) as OutboundAntwort;
  if (!out.success || !out.conversation_id) {
    throw new Error(`ElevenLabs outbound-call: ${out.message || "kein conversation_id in der Antwort"}`);
  }
  return out;
};

/**
 * Prüft `ElevenLabs-Signature: t=<unix s>,v0=<hex>`. Signiert wird `<t>.<rohdaten>` mit HMAC-SHA256
 * (wie constructEvent im ElevenLabs-SDK). Älter als 30 Minuten wird abgelehnt.
 */
export function signaturGueltig(rawBody: string, header: string | null, secret: string, jetztMs = Date.now()): boolean {
  if (!header || !secret) return false;
  const teile = header.split(",").map((x) => x.trim());
  const t = teile.find((x) => x.startsWith("t="))?.slice(2);
  const v0 = teile.find((x) => x.startsWith("v0="))?.slice(3);
  if (!t || !v0 || !/^\d+$/.test(t)) return false;
  if (Number(t) * 1000 < jetztMs - 30 * 60 * 1000) return false;
  const erwartet = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(erwartet, "utf8");
  const b = Buffer.from(v0.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Für Tests und Probeläufe: so signiert ElevenLabs. */
export function signieren(rawBody: string, secret: string, unixSekunden: number): string {
  const hex = createHmac("sha256", secret).update(`${unixSekunden}.${rawBody}`).digest("hex");
  return `t=${unixSekunden},v0=${hex}`;
}
