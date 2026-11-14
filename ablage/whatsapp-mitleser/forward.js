// Sends a request to the Ablage. Retries on network and 5xx errors, gives up immediately on 4xx.

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

export function endpunkt(basis) {
  return `${String(basis).replace(/\/+$/, '')}/import/whatsapp/nachricht`;
}

/**
 * @returns {Promise<{ok: boolean, antwort?: object, fehler?: string}>}
 * Never throws. `fetchImpl` and `wartezeiten` are replaceable so that tests run without network.
 */
export async function sende(basis, body, { fetchImpl = fetch, wartezeiten = [1000, 3000, 8000], timeoutMs = 30000 } = {}) {
  const url = endpunkt(basis);
  let letzter = 'unbekannt';
  for (let versuch = 0; versuch <= wartezeiten.length; versuch++) {
    try {
      const r = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.ok) return { ok: true, antwort: await r.json() };
      letzter = `HTTP ${r.status}`;
      if (r.status >= 400 && r.status < 500) {
        // 4xx: the request itself is wrong, retrying does not help
        return { ok: false, fehler: letzter };
      }
    } catch (e) {
      letzter = `${e?.name ?? 'Fehler'}: ${e?.message ?? e}`;
    }
    if (versuch < wartezeiten.length) await schlafen(wartezeiten[versuch]);
  }
  return { ok: false, fehler: letzter };
}
