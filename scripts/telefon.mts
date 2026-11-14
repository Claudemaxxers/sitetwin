// Telefon-Agent, Poller: ruft alle N Sekunden POST /api/telefon/anrufen des laufenden SiteTwin auf.
//   node scripts/telefon.mts [baseUrl] [intervallSekunden]      (Standard: http://localhost:3000, 30)
//   node scripts/telefon.mts --einmal                            (ein Durchlauf, dann Ende)
// Liest TELEFON_TOKEN aus .env.local, falls gesetzt.

try {
  process.loadEnvFile(".env.local");
} catch {
  /* keine .env.local: dann ohne Token */
}

const args = process.argv.slice(2);
const einmal = args.includes("--einmal");
const rest = args.filter((a) => a !== "--einmal");
const base = rest[0] ?? "http://localhost:3000";
const intervall = Number(rest[1] ?? 30);
const token = process.env.TELEFON_TOKEN ?? "";

interface Bericht {
  zeitpunkt: string;
  trocken: boolean;
  gefunden: number;
  angerufen: { signal_id: string; titel: string; zustaendig: string | null; telefon: string; conversation_id: string | null; versuch: number }[];
  uebersprungen: { signal_id: string; titel: string; grund: string }[];
}

async function durchlauf(): Promise<void> {
  const res = await fetch(`${base}/api/telefon/anrufen`, { method: "POST", headers: token ? { "x-telefon-token": token } : {} });
  if (!res.ok) {
    console.error(`${new Date().toLocaleTimeString()}  Fehler ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const b = (await res.json()) as Bericht;
  const kopf = `${new Date().toLocaleTimeString()}  ${b.gefunden} offen${b.trocken ? " (TROCKEN, kein echter Anruf)" : ""}`;
  if (!b.angerufen.length && !b.uebersprungen.length) {
    console.log(kopf);
    return;
  }
  console.log(kopf);
  for (const a of b.angerufen) {
    console.log(`   📞 ${a.zustaendig ?? "?"} ${a.telefon}  "${a.titel}"  Versuch ${a.versuch}${a.conversation_id ? `  ${a.conversation_id}` : ""}`);
  }
  for (const u of b.uebersprungen) console.log(`   – "${u.titel}": ${u.grund}`);
}

const zustand = await fetch(`${base}/api/telefon/anrufen`).then((r) => r.json()).catch(() => null);
if (!zustand) {
  console.error(`SiteTwin unter ${base} nicht erreichbar. Erst "npm run dev" starten.`);
  process.exit(1);
}
console.log(`Telefon-Agent gegen ${base}: konfiguriert=${zustand.konfiguriert} trocken=${zustand.trocken} testnummer=${zustand.testnummer_gesetzt} ablage=${zustand.ablage}`);
if (!zustand.testnummer_gesetzt && !zustand.trocken) {
  console.log("ACHTUNG: TELEFON_TESTNUMMER ist nicht gesetzt, Anrufe gehen an die Nummern aus der Datenbank.");
}

do {
  await durchlauf().catch((e) => console.error(`Fehler: ${(e as Error).message}`));
  if (!einmal) await new Promise((r) => setTimeout(r, intervall * 1000));
} while (!einmal);
