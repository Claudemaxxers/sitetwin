// Dry run of the notifier: reads Supabase (GET only) and shows what WOULD be sent. No WhatsApp, no socket.
import { supabaseZugang, ladeEnv } from './config.js';
import { alleSignale, baueText, neuesteOffene, offeneSignale } from './melder.js';

const cfg = ladeEnv();
const sb = supabaseZugang();
if (!sb) {
  console.error('SUPABASE_URL und SUPABASE_SERVICE_KEY fehlen (weder in whatsapp-mitleser/.env noch in ablage/.env).');
  process.exit(1);
}
const projekt = cfg.projekt;
console.log(`Projekt: ${projekt} (nur lesen, es wird nichts gesendet)`);
try {
  const offen = await offeneSignale(sb, projekt);
  const neueste = await neuesteOffene(sb, projekt, 5);
  console.log(`Offene Signale: ${offen.length}`);
  const alle = await alleSignale(sb, projekt);
  const nachStatus = {};
  for (const s of alle) nachStatus[s.status] = (nachStatus[s.status] ?? 0) + 1;
  console.log(`Signale insgesamt (bis 200): ${alle.length} ${JSON.stringify(nachStatus)}`);
  const bewertet = alle.filter((s) => s.bewertung);
  const nachUrteil = {};
  for (const s of bewertet) nachUrteil[s.bewertung] = (nachUrteil[s.bewertung] ?? 0) + 1;
  console.log(`Signale mit bewertung: ${bewertet.length} von ${alle.length} ${JSON.stringify(nachUrteil)} | Rueckmeldung per WhatsApp (WHATSAPP_BEWERTEN): ${cfg.bewerten.an ? 'AN' : 'AUS'}${cfg.bewerten.fehler ? ` | Problem: ${cfg.bewerten.fehler}` : ''}`);
  const spalten = new Set();
  for (const s of [...neueste, ...alle.slice(0, 1)]) Object.keys(s).forEach((k) => spalten.add(k));
  console.log(`Spalten: ${[...spalten].join(', ') || '(keine Zeilen, Spalten unbekannt)'}`);
  console.log(`Warn-Chat: ${cfg.warnen.chat || '(nicht gesetzt)'} | Melder ${cfg.warnen.an ? 'AN' : 'AUS'}${cfg.warnen.fehler ? ` | Problem: ${cfg.warnen.fehler}` : ''}`);
  neueste.forEach((s, i) => {
    console.log(`\n--- ${i + 1}/${neueste.length} (${String(s.id).slice(0, 8)}, erstellt ${s.erstellt_am}) ---\n${baueText(s)}`);
  });
  if (!neueste.length && alle.length) {
    console.log(`
--- Keine offenen Signale. Beispiel nur zur Textform, aus einem Signal mit Status ${alle[0].status} (${String(alle[0].id).slice(0, 8)}) ---
${baueText(alle[0])}`);
  }
} catch (e) {
  console.error(`Abruf fehlgeschlagen: ${e.message}`);
  process.exit(1);
}
