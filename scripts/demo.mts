// Plays the demo storyline against a running SiteTwin: node scripts/demo.mts [baseUrl] [delayMs]
import { SCENARIO } from "../lib/scenario.ts";

const base = process.argv[2] ?? "http://localhost:3000";
const delay = Number(process.argv[3] ?? 4000);

await fetch(`${base}/api/reset`, { method: "POST" });
for (const [i, m] of SCENARIO.entries()) {
  console.log(`\n[${i + 1}/${SCENARIO.length}] ${m.sender}: ${m.text.split("\n")[0]}`);
  const res = await fetch(`${base}/api/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(m),
  });
  const out = (await res.json()) as { engine: string; events: { action: string; elementId: string; drawingRev: string | null }[]; flags: { severity: string; title: string }[] };
  for (const e of out.events) console.log(`   → ${e.action} @ ${e.elementId}${e.drawingRev ? ` (Rev ${e.drawingRev})` : ""}  [${out.engine}]`);
  for (const f of out.flags) console.log(`   ⚠ ${f.severity.toUpperCase()}: ${f.title}`);
  await new Promise((r) => setTimeout(r, delay));
}
