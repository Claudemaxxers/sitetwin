import { telefonConfig } from "@/lib/telefon/config";
import { signaturGueltig } from "@/lib/telefon/elevenlabs";
import { supabaseSignalDB } from "@/lib/telefon/supabase";
import { ereignisVerarbeiten, type ElevenEvent } from "@/lib/telefon/webhook";

export const dynamic = "force-dynamic";

/**
 * Post-Call-Webhook von ElevenLabs. In ElevenLabs eintragen: https://<host>/api/telefon/webhook,
 * Ereignisse post_call_transcription und call_initiation_failure, Secret in ELEVENLABS_WEBHOOK_SECRET.
 * Antwortet 200 bei Erfolg, 401 bei falscher Signatur, 500 bei Fehlern (dann wiederholt ElevenLabs).
 */
export async function POST(req: Request) {
  const cfg = telefonConfig();
  const raw = await req.text();
  if (!cfg.webhookSecret) return new Response("ELEVENLABS_WEBHOOK_SECRET nicht gesetzt", { status: 503 });
  if (!signaturGueltig(raw, req.headers.get("elevenlabs-signature"), cfg.webhookSecret)) {
    return new Response("Signatur ungültig", { status: 401 });
  }
  let ev: ElevenEvent;
  try {
    ev = JSON.parse(raw) as ElevenEvent;
  } catch {
    return new Response("kein JSON", { status: 400 });
  }
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) return new Response("SUPABASE_URL / SUPABASE_SERVICE_KEY fehlen", { status: 503 });
  try {
    const ergebnis = await ereignisVerarbeiten(ev, supabaseSignalDB(url, key), cfg);
    console.log(`[telefon] ${ev.type} ${ev.data?.conversation_id}: ${ergebnis.aktion}${ergebnis.details ? ` (${ergebnis.details})` : ""}`);
    return Response.json(ergebnis);
  } catch (err) {
    console.error(`[telefon] Webhook-Fehler: ${(err as Error).message}`);
    return Response.json({ fehler: (err as Error).message }, { status: 500 });
  }
}
