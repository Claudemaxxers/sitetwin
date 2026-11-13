import Link from "next/link";
import { getProjektDaten, getProjekte, supabaseConfigured } from "@/lib/sb";
import { eur, pct, slug, zwilling } from "@/lib/twin-model";
import { Brand, Firma } from "@/components/Brand";
import SketchClient from "@/components/SketchClient";
import type { BauTyp } from "@/components/BuildingSketch";

export const dynamic = "force-dynamic";

interface Karte {
  key: string;
  name: string;
  adresse: string | null;
  typ: BauTyp;
  geschosse?: number;
  href: string | null; // null = demo without live data
  fortschritt: number | null;
  auftrag: number | null;
  mehrkosten: number | null;
}

/** Demo projects for the overview. They have no data in Supabase and do not open a twin. */
const DEMO: Karte[] = [
  { key: "oper", name: "Wiener Staatsoper", adresse: "Opernring 2, 1010 Wien", typ: "oper", href: null, fortschritt: null, auftrag: null, mehrkosten: null },
  { key: "turm", name: "Holzhybrid Seestadt (fiktiv)", adresse: "Seestadt Aspern, 1220 Wien", typ: "turm", href: null, fortschritt: null, auftrag: null, mehrkosten: null },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ ansicht?: string }> }) {
  const { ansicht } = await searchParams;
  const liste = ansicht === "liste";

  const echte: Karte[] = [];
  if (supabaseConfigured()) {
    const projekte = await getProjekte();
    for (const p of projekte) {
      const d = await getProjektDaten(p.projekt);
      if (!d) continue;
      const z = zwilling(d);
      echte.push({
        key: p.projekt,
        name: p.name ?? p.projekt,
        adresse: p.adresse,
        typ: "wohnbau",
        geschosse: z.geschosse.length,
        href: `/projekt/${slug(p.projekt)}`,
        fortschritt: z.fortschritt,
        auftrag: z.auftragssumme,
        mehrkosten: z.mehrkostenSumme,
      });
    }
  }
  const karten = [...echte, ...DEMO];

  return (
    <main className="min-h-screen">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-white/85 px-8 py-4 backdrop-blur">
        <Brand />
        <Firma />
      </header>

      <section className="mx-auto max-w-6xl px-8 py-8">
        <div className="mb-6 flex justify-end">
          <div className="flex rounded border border-[var(--line)] bg-white p-0.5 text-sm">
            <Link href="/" className={`rounded-sm px-3 py-1 ${!liste ? "bg-[var(--text)] text-white" : "muted hover:text-[var(--text)]"}`}>
              Vorschau
            </Link>
            <Link href="/?ansicht=liste" className={`rounded-sm px-3 py-1 ${liste ? "bg-[var(--text)] text-white" : "muted hover:text-[var(--text)]"}`}>
              Liste
            </Link>
          </div>
        </div>

        {liste ? (
          <ul className="panel divide-y divide-[var(--line)]">
            {karten.map((k) => (
              <li key={k.key}>
                <Wrap href={k.href} className="flex items-center justify-between px-5 py-4 hover:bg-[var(--panel-2)]">
                  <span>{k.name}</span>
                  <span className="muted text-sm">{k.href ? "→" : "Demo"}</span>
                </Wrap>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {karten.map((k) => (
              <Wrap key={k.key} href={k.href} className="group block">
                <div className="aspect-[4/3] overflow-hidden rounded border border-[var(--line)] bg-white transition group-hover:border-[var(--text)]">
                  <SketchClient typ={k.typ} geschosse={k.geschosse} />
                </div>
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <div className="truncate">{k.name}</div>
                  {!k.href && <span className="label">Demo</span>}
                </div>
                <div className="muted mt-1 flex gap-4 text-xs">
                  {k.fortschritt === null ? (
                    <span>Keine Live-Daten</span>
                  ) : (
                    <>
                      <span>{pct(k.fortschritt)} fertig</span>
                      <span>{eur(k.auftrag ?? 0)} Auftrag</span>
                      <span className="accent">+{eur(k.mehrkosten ?? 0)} Mehrkosten</span>
                    </>
                  )}
                </div>
              </Wrap>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Wrap({ href, className, children }: { href: string | null; className?: string; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className} title="Demo, keine Live-Daten">
      {children}
    </div>
  );
}
