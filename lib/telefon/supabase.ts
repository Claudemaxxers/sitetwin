import type { Person, Signal, SignalDB, VerlaufZeile } from "./types";

/**
 * Write access to `signale`, read access to `personen` and `signal_verlauf`
 * (uebersetzer/schema.sql). Use on the server only: the service key must never reach the browser.
 */
export function supabaseSignalDB(url: string, key: string, fetchFn: typeof fetch = fetch): SignalDB {
  const base = url.replace(/\/+$/, "");
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" };

  async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchFn(`${base}/rest/v1/${path}`, {
      ...init,
      headers: { ...headers, ...((init.headers as Record<string, string>) ?? {}) },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]}: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }
  const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

  return {
    offeneSignale: () => rest<Signal[]>("signale?select=*&status=eq.offen&angerufen_am=is.null&order=erstellt_am.asc"),
    personen: (projekt) => rest<Person[]>(`personen?select=*&projekt=${eq(projekt)}`),
    verlauf(signalIds) {
      if (!signalIds.length) return Promise.resolve([]);
      const liste = signalIds.map(encodeURIComponent).join(",");
      return rest<VerlaufZeile[]>(`signal_verlauf?select=signal_id,status,zeitpunkt&signal_id=in.(${liste})&order=zeitpunkt.asc`);
    },
    async signalBeanspruchen(id, angerufenAm) {
      const rows = await rest<Signal[]>(`signale?id=${eq(id)}&angerufen_am=is.null`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ angerufen_am: angerufenAm }),
      });
      return Array.isArray(rows) && rows.length > 0;
    },
    async signalAendern(id, felder) {
      await rest<unknown>(`signale?id=${eq(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(felder),
      });
    },
    async signalZuAnruf(conversationId) {
      const rows = await rest<Signal[]>(`signale?select=*&anruf_id=${eq(conversationId)}&limit=1`);
      return rows[0] ?? null;
    },
  };
}
