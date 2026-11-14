import { timingSafeEqual } from "node:crypto";
import { telefonConfig, telefonKonfiguriert } from "@/lib/telefon/config";
import { offeneSignaleAnrufen } from "@/lib/telefon/dispatcher";
import { supabaseSignalDB } from "@/lib/telefon/supabase";

export const dynamic = "force-dynamic";

/**
 * Phone agent, step 5 in KONZEPT.md.
 * GET  → state (configured? dry run? test number? open signals)
 * POST → one pass: call open signals (npm run telefon triggers this every 30 s)
 */

function db() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) return null;
  return supabaseSignalDB(url, key);
}

function tokenOk(req: Request, token: string): boolean {
  if (!token) return true;
  const mitgeschickt = req.headers.get("x-telefon-token") ?? "";
  const a = Buffer.from(mitgeschickt);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET() {
  const cfg = telefonConfig();
  const sb = db();
  let offen: number | null = null;
  if (sb) offen = await sb.offeneSignale().then((s) => s.length).catch(() => null);
  return Response.json({
    konfiguriert: telefonKonfiguriert(cfg),
    supabase: Boolean(sb),
    trocken: cfg.trocken,
    testnummer_gesetzt: Boolean(cfg.testnummer),
    ablage: Boolean(cfg.ablageUrl),
    webhook_secret_gesetzt: Boolean(cfg.webhookSecret),
    offene_signale_ohne_anruf: offen,
  });
}

export async function POST(req: Request) {
  const cfg = telefonConfig();
  if (!tokenOk(req, cfg.token)) return new Response("X-Telefon-Token fehlt oder ist falsch", { status: 401 });
  const sb = db();
  if (!sb) return Response.json({ fehler: "SUPABASE_URL / SUPABASE_SERVICE_KEY fehlen" }, { status: 503 });
  try {
    const bericht = await offeneSignaleAnrufen(sb, cfg);
    return Response.json(bericht);
  } catch (err) {
    return Response.json({ fehler: (err as Error).message }, { status: 500 });
  }
}
