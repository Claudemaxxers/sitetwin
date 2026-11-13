import Link from "next/link";
import { getProjektDaten, getProjekte, supabaseConfigured } from "@/lib/sb";
import { eur, pct, slug, zeitLabel, zwilling } from "@/lib/twin-model";
import { Brand, Firma } from "@/components/Brand";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!supabaseConfigured()) {
    return (
      <main className="mx-auto max-w-3xl p-10">
        <Brand />
        <p className="mt-8">
          Setze <code className="chip">SUPABASE_URL</code> und <code className="chip">SUPABASE_SERVICE_KEY</code> in <code className="chip">.env.local</code>.
        </p>
      </main>
    );
  }
  const projekte = await getProjekte();
  const daten = await Promise.all(projekte.map((p) => getProjektDaten(p.projekt)));

  return (
    <main className="min-h-screen">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-white/85 px-8 py-4 backdrop-blur">
        <Brand />
        <Firma />
      </header>

      <section className="mx-auto max-w-6xl px-8 py-12">
        <div className="label">Ihre Projekte</div>
        <h1 className="mt-2 text-4xl">Guten Abend. {projekte.length === 1 ? "Ein Projekt läuft" : `${projekte.length} Projekte laufen`}.</h1>
        <p className="muted mt-2 max-w-xl">
          Was auf der Baustelle per WhatsApp, Mail und Telefon passiert, landet hier als aktueller Stand. Themen werden direkt mit dem Vorarbeiter geklärt.
        </p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {daten.map((d) => {
            if (!d) return null;
            const z = zwilling(d);
            const themen = z.signale.length;
            return (
              <Link key={d.projekt.projekt} href={`/projekt/${slug(d.projekt.projekt)}`} className="panel group block overflow-hidden transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(12,10,8,.35)]">
                <div className="relative h-44 overflow-hidden bg-[var(--panel-2)]">
                  <HausSkizze geschosse={z.geschosse.length} />
                  <div className="absolute left-4 top-4 flex items-center gap-2">
                    <span className="live-dot" />
                    <span className="label">Live · {zeitLabel(z.bis)}</span>
                  </div>
                  {themen > 0 && (
                    <div className="absolute right-4 top-4 rounded-full bg-[var(--accent)] px-3 py-1 text-xs text-white">
                      {themen} {themen === 1 ? "Thema" : "Themen"} in Klärung
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="text-xl">{d.projekt.name ?? d.projekt.projekt}</h2>
                    <span className="muted text-sm transition group-hover:text-[var(--text)]">Öffnen →</span>
                  </div>
                  <div className="muted text-sm">{d.projekt.adresse}</div>
                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <Mini label="Fortschritt" value={pct(z.fortschritt)} bar={z.fortschritt} />
                    <Mini label="Auftrag" value={eur(z.auftragssumme)} />
                    <Mini label="Mehrkosten" value={`+${eur(z.mehrkostenSumme)}`} accent />
                  </div>
                </div>
              </Link>
            );
          })}
          <div className="flex min-h-[18rem] flex-col items-center justify-center rounded border border-dashed border-[var(--line)] bg-white/60 p-8 text-center">
            <div className="label">Neues Projekt</div>
            <p className="muted mt-2 max-w-xs text-sm">WhatsApp-Gruppe, Postfach und Planordner verbinden, der Zwilling baut sich aus den Nachrichten auf.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function Mini({ label, value, bar, accent }: { label: string; value: string; bar?: number; accent?: boolean }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`mt-1 text-lg ${accent ? "accent" : ""}`}>{value}</div>
      {bar !== undefined && (
        <div className="mt-1 h-1 rounded bg-[var(--line)]">
          <div className="h-1 rounded bg-[var(--text)]" style={{ width: `${Math.max(3, bar * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Small isometric house drawing for the project card. */
function HausSkizze({ geschosse }: { geschosse: number }) {
  const h = 26;
  return (
    <svg viewBox="0 0 400 176" className="absolute inset-0 h-full w-full">
      <g transform="translate(200 150)">
        {Array.from({ length: geschosse }, (_, i) => {
          const y = -i * h;
          return (
            <g key={i} transform={`translate(0 ${y})`}>
              <polygon points="-110,0 0,32 0,6 -110,-26" fill={i === 0 ? "#cfc9c1" : "#ece8e2"} stroke="#c8c1b8" strokeWidth=".8" />
              <polygon points="0,32 110,0 110,-26 0,6" fill={i === 0 ? "#bdb6ad" : "#ddd7cf"} stroke="#c8c1b8" strokeWidth=".8" />
              {i > 0 &&
                [0.1, 0.38, 0.66].flatMap((f) => {
                  const win = (sx: number, sign: number) => {
                    const x0 = sx + f * 110 * sign;
                    const x1 = x0 + 18 * sign;
                    const y = (x: number) => (sign > 0 ? ((x + 110) / 110) * 32 : ((110 - x) / 110) * 32) - 32 * (sign > 0 ? 0 : 0);
                    return `${x0},${y(x0) - 6} ${x1},${y(x1) - 6} ${x1},${y(x1) - 19} ${x0},${y(x0) - 19}`;
                  };
                  return [
                    <polygon key={`l${f}`} points={win(-110, 1)} fill="#8fa6b8" opacity=".8" />,
                    <polygon key={`r${f}`} points={win(110, -1)} fill="#7d93a5" opacity=".8" />,
                  ];
                })}
            </g>
          );
        })}
        <polygon points={`-110,${-geschosse * h} 0,${-geschosse * h + 32 - 26} 110,${-geschosse * h} 0,${-geschosse * h - 26}`} transform={`translate(0 ${26})`} fill="#f6f4f1" stroke="#c8c1b8" strokeWidth=".8" />
      </g>
    </svg>
  );
}
