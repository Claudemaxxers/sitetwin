/** Konfiguration des Telefon-Agenten aus .env.local (nur Server, nie NEXT_PUBLIC_). */

export interface TelefonConfig {
  apiKey: string;
  agentId: string;
  phoneNumberId: string;
  baseUrl: string;
  webhookSecret: string;
  /** Hackathon-Sicherung: wenn gesetzt, gehen ALLE Anrufe an diese Nummer, nie an die aus der DB. */
  testnummer: string | null;
  /** TELEFON_TROCKEN=1: Signale werden ausgewählt und protokolliert, aber nicht angerufen. */
  trocken: boolean;
  /** Schützt POST /api/telefon/anrufen (Header X-Telefon-Token). Leer = keine Prüfung. */
  token: string;
  /** Ablage (FastAPI), bekommt das Transkript per POST /import/call. Leer = nicht weiterleiten. */
  ablageUrl: string;
  ablageToken: string;
  projektName: string;
  laendervorwahl: string;
  /** Wie oft ein nicht erreichtes Signal höchstens angerufen wird. */
  maxVersuche: number;
  /** Mindestabstand zwischen zwei Versuchen in Minuten. */
  wartezeitMin: number;
}

export function telefonConfig(env: Record<string, string | undefined> = process.env): TelefonConfig {
  const s = (k: string) => (env[k] ?? "").trim();
  const n = (k: string, standard: number) => {
    const v = Number(s(k));
    return Number.isFinite(v) && s(k) !== "" ? v : standard;
  };
  return {
    apiKey: s("ELEVENLABS_API_KEY"),
    agentId: s("ELEVENLABS_AGENT_ID"),
    phoneNumberId: s("ELEVENLABS_PHONE_NUMBER_ID"),
    baseUrl: s("ELEVENLABS_BASE_URL") || "https://api.elevenlabs.io",
    webhookSecret: s("ELEVENLABS_WEBHOOK_SECRET"),
    testnummer: s("TELEFON_TESTNUMMER") || null,
    trocken: ["1", "true", "ja"].includes(s("TELEFON_TROCKEN").toLowerCase()),
    token: s("TELEFON_TOKEN"),
    ablageUrl: s("ABLAGE_URL").replace(/\/+$/, ""),
    ablageToken: s("ABLAGE_IMPORT_TOKEN"),
    projektName: s("DEFAULT_PROJEKT") || "BV Simmering",
    laendervorwahl: s("TELEFON_LAENDERVORWAHL") || "+43",
    maxVersuche: n("TELEFON_MAX_VERSUCHE", 3),
    wartezeitMin: n("TELEFON_WARTEZEIT_MIN", 10),
  };
}

export function telefonKonfiguriert(cfg: TelefonConfig): boolean {
  return Boolean(cfg.apiKey && cfg.agentId && cfg.phoneNumberId);
}
