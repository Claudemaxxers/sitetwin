// Schickt eine Anfrage an die Ablage. Wiederholt bei Netz- und 5xx-Fehlern, gibt bei 4xx sofort auf.

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

export function endpunkt(basis) {
  return `${String(basis).replace(/\/+$/, '')}/import/whatsapp/nachricht`;
}

/**
 * @returns {Promise<{ok: boolean, antwort?: object, fehler?: string}>}
 * Wirft nie. `fetchImpl` und `wartezeiten` sind austauschbar, damit Tests ohne Netz laufen.
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
        // 4xx: die Anfrage selbst ist falsch, Wiederholen hilft nicht
        return { ok: false, fehler: letzter };
      }
    } catch (e) {
      letzter = `${e?.name ?? 'Fehler'}: ${e?.message ?? e}`;
    }
    if (versuch < wartezeiten.length) await schlafen(wartezeiten[versuch]);
  }
  return { ok: false, fehler: letzter };
}
