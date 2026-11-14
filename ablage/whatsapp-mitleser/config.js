import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { parseAllowlist } from './mapping.js';
import { warnKonfig } from './melder.js';

export const ORDNER = import.meta.dirname;
export const AUTH_ORDNER = join(ORDNER, 'auth');
export const QR_DATEI = join(AUTH_ORDNER, 'qr.png');
export const ZUSTAND_DATEI = join(ORDNER, 'zustand', 'melder.json'); // nicht in auth/, git-ignoriert
const ABLAGE_ENV = join(ORDNER, '..', '.env');

/** Liest optional ./.env (Node >= 20.12), echte Umgebungsvariablen haben Vorrang. */
export function ladeEnv(env = process.env) {
  const datei = join(ORDNER, '.env');
  if (existsSync(datei) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(datei);
    } catch (e) {
      console.warn(`.env nicht lesbar: ${e.message}`);
    }
  }
  const cfg = konfig(env);
  cfg.supabase = supabaseZugang(env);
  return cfg;
}

/**
 * SUPABASE_URL und SUPABASE_SERVICE_KEY: aus der Umgebung (inkl. eigener .env), sonst aus ../.env.
 * Aus der Ablage-.env werden nur diese zwei Werte uebernommen, nichts sonst.
 */
export function supabaseZugang(env = process.env, ablageEnv = ABLAGE_ENV) {
  let url = (env.SUPABASE_URL || '').trim();
  let key = (env.SUPABASE_SERVICE_KEY || '').trim();
  if ((!url || !key) && existsSync(ablageEnv)) {
    try {
      const w = parseEnv(readFileSync(ablageEnv, 'utf8'));
      url = url || (w.SUPABASE_URL || '').trim();
      key = key || (w.SUPABASE_SERVICE_KEY || '').trim();
    } catch {
      /* unlesbar: gilt als nicht gesetzt */
    }
  }
  return url && key ? { url, key } : null;
}

export function konfig(env) {
  const maxMb = Number(env.WHATSAPP_MAX_MB);
  return {
    ablageUrl: (env.ABLAGE_URL || 'http://localhost:8000').trim(),
    projekt: (env.ABLAGE_PROJEKT || 'Test Santino').trim(),
    allowlist: parseAllowlist(env.WHATSAPP_CHATS),
    nummer: (env.WHATSAPP_NUMMER || '').replace(/\D/g, '') || null,
    warnen: warnKonfig(env, parseAllowlist(env.WHATSAPP_CHATS)),
    maxBytes: (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 20) * 1024 * 1024,
  };
}
