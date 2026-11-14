import { createHmac, timingSafeEqual } from "node:crypto";
import type { TelefonConfig } from "./config";
import type { Signal } from "./types";

/**
 * ElevenLabs Agents: outbound call via the agent's Twilio number.
 * Docs: POST /v1/convai/twilio/outbound-call; post-call webhooks with header ElevenLabs-Signature.
 *
 * The variable names are aligned with the system prompt of the agent "Construction Site checkin Agent".
 * Deliberately NO conversation_config_override (first message, prompt): the API rejects it
 * on the free plan. The first message is fixed in the agent; with anruf_modus=ausgehend the prompt
 * states location and conflict from the variables right away.
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

/** "Top 5, Abstellraum", or whatever is known about the location. */
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
 * Verifies `ElevenLabs-Signature: t=<unix s>,v0=<hex>`. What gets signed is `<t>.<raw body>` with HMAC-SHA256
 * (like constructEvent in the ElevenLabs SDK). Anything older than 30 minutes is rejected.
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

/** For tests and trial runs: this is how ElevenLabs signs. */
export function signieren(rawBody: string, secret: string, unixSekunden: number): string {
  const hex = createHmac("sha256", secret).update(`${unixSekunden}.${rawBody}`).digest("hex");
  return `t=${unixSekunden},v0=${hex}`;
}
