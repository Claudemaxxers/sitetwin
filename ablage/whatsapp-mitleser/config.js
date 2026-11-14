import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAllowlist } from './mapping.js';

export const ORDNER = import.meta.dirname;
export const AUTH_ORDNER = join(ORDNER, 'auth');
export const QR_DATEI = join(AUTH_ORDNER, 'qr.png');

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
  return konfig(env);
}

export function konfig(env) {
  const maxMb = Number(env.WHATSAPP_MAX_MB);
  return {
    ablageUrl: (env.ABLAGE_URL || 'http://localhost:8000').trim(),
    projekt: (env.ABLAGE_PROJEKT || 'Test Santino').trim(),
    allowlist: parseAllowlist(env.WHATSAPP_CHATS),
    nummer: (env.WHATSAPP_NUMMER || '').replace(/\D/g, '') || null,
    maxBytes: (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 20) * 1024 * 1024,
  };
}
