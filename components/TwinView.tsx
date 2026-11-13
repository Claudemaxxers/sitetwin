"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ART_LABEL,
  eur,
  pct,
  SIGNAL_ART_LABEL,
  STUFEN,
  ts,
  zeitLabel,
  zwilling,
  type Eintrag,
  type ProjektDaten,
  type Signal,
  type TopZustand,
  type Zwilling,
} from "@/lib/twin-model";
import { Brand, Firma } from "./Brand";

const Building3D = dynamic(() => import("./Building3D"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <span className="label">Gebäude wird aufgebaut…</span>
    </div>
  ),
});

const SLICE_MS = 650;

export default function TwinView({ initial }: { initial: ProjektDaten }) {
  const [daten, setDaten] = useState(initial);
  const [cursor, setCursor] = useState<number | null>(null); // null = live
  const [floorSel, setFloorSel] = useState<string | null>(null);
  const [topSel, setTopSel] = useState<string | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [neu, setNeu] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // live: poll Hendrik's tables
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/projekt/${encodeURIComponent(initial.projekt.projekt)}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as ProjektDaten;
        setDaten((prev) => {
          const known = new Set(prev.eintraege.map((e) => e.id));
          const fresh = next.eintraege.filter((e) => !known.has(e.id)).map((e) => e.id);
          if (fresh.length) setNeu(new Set(fresh));
          return next;
        });
      } catch {
        /* offline: keep last state */
      }
    }, 6000);
    return () => clearInterval(id);
  }, [initial.projekt.projekt]);

  const z = useMemo(() => zwilling(daten, cursor ?? undefined), [daten, cursor]);
  const zLive = useMemo(() => zwilling(daten), [daten]);

  const goHouse = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setTopSel(null);
    setIsolated(false);
    setFloorSel(null);
  }, []);
  const goFloor = useCallback(
    (name: string, top: string | null = null) => {
      if (timer.current) clearTimeout(timer.current);
      if (floorSel === name && isolated) {
        setTopSel(top);
        return;
      }
      setTopSel(null);
      setIsolated(false);
      setFloorSel(name);
      timer.current = setTimeout(() => {
        setIsolated(true);
        setTopSel(top);
      }, SLICE_MS);
    },
    [floorSel, isolated],
  );

  const geschoss = z.geschosse.find((g) => g.name === floorSel) ?? null;
  const top = topSel ? z.tops[topSel] : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-[var(--line)] bg-white/90 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-6">
          <Brand />
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/" className="muted hover:text-[var(--text)]">
              Projekte
            </Link>
            <span className="muted">/</span>
            <button onClick={goHouse} className={floorSel ? "muted hover:text-[var(--text)]" : ""}>
              {daten.projekt.name ?? daten.projekt.projekt}
            </button>
            {floorSel && (
              <>
                <span className="muted">/</span>
                <button onClick={() => goFloor(floorSel)} className={topSel ? "muted hover:text-[var(--text)]" : ""}>
                  {floorSel}
                </button>
              </>
            )}
            {topSel && (
              <>
                <span className="muted">/</span>
                <span>{topSel}</span>
              </>
            )}
          </nav>
        </div>
        <Firma />
      </header>

      <Kpis z={z} />

      <div className="grid min-h-0 flex-1 grid-cols-[400px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r border-[var(--line)] bg-white">
          {top ? (
            <TopPanel zs={top} z={z} neu={neu} />
          ) : geschoss ? (
            <GeschossPanel name={geschoss.name} z={z} onTop={(t) => goFloor(geschoss.name, t)} neu={neu} />
          ) : (
            <HausPanel daten={daten} z={z} onFloor={(g) => goFloor(g)} neu={neu} />
          )}
        </aside>

        <section className="relative min-h-0">
          <Building3D z={z} floorSel={floorSel} topSel={topSel} isolated={isolated} onFloor={(g) => goFloor(g)} onTop={(g, t) => goFloor(g, t)} />
          <div className="pointer-events-none absolute left-5 top-4 flex items-center gap-2">
            {cursor === null ? (
              <>
                <span className="live-dot" />
                <span className="label">Live aus Supabase</span>
              </>
            ) : (
              <span className="label rounded bg-[var(--text)] px-2 py-1 !text-white">Stand {zeitLabel(cursor)}</span>
            )}
          </div>
          {floorSel && (
            <button onClick={topSel ? () => goFloor(floorSel) : goHouse} className="btn absolute right-5 top-4 bg-white/90">
              ← {topSel ? floorSel : "Ganzes Gebäude"}
            </button>
          )}
          {!floorSel && <div className="label pointer-events-none absolute bottom-4 right-5">Geschoss anklicken, um es herauszuziehen</div>}
        </section>
      </div>

      <Timeline daten={daten} z={zLive} cursor={cursor} setCursor={setCursor} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Kpis({ z }: { z: Zwilling }) {
  const offen = z.signale.filter((s) => s.status === "offen").length;
  const inArbeit = z.signale.filter((s) => s.status === "in_bearbeitung").length;
  const ohnePreis = z.mehrkosten.filter((m) => m.betrag === null).length;
  return (
    <div className="grid grid-cols-5 border-b border-[var(--line)] bg-white">
      <Kpi label="Fortschritt Elektro" value={pct(z.fortschritt)} sub="laut Meldungen von der Baustelle">
        <div className="mt-2 h-1.5 rounded bg-[var(--line)]">
          <div className="h-1.5 rounded bg-[var(--ok)] transition-all" style={{ width: `${Math.max(2, z.fortschritt * 100)}%` }} />
        </div>
      </Kpi>
      <Kpi label="Auftragssumme" value={eur(z.auftragssumme)} sub="Leistungsverzeichnis Elektro" />
      <details className="group relative border-l border-[var(--line)]">
        <summary className="block cursor-pointer list-none px-5 py-3 hover:bg-[var(--panel-2)]">
          <div className="label">Mehrkosten ▾</div>
          <div className="accent mt-1 text-2xl">+{eur(z.mehrkostenSumme)}</div>
          <div className="muted text-xs">
            {z.mehrkosten.length} Positionen{ohnePreis ? `, ${ohnePreis} ohne Preis` : ""}
          </div>
        </summary>
        <div className="panel absolute left-0 top-full z-20 mt-1 w-[420px] p-3 shadow-xl">
          {z.mehrkosten.map((m, i) => (
            <div key={i} className="flex items-start justify-between gap-3 border-b border-[var(--line)] py-2 text-sm last:border-0">
              <div>
                <div>
                  {m.top && <span className="chip mr-1">{m.top}</span>}
                  {m.titel}
                </div>
                <div className="muted text-xs">{m.grundlage}</div>
              </div>
              <div className="whitespace-nowrap">{m.betrag === null ? <span className="muted">offen</span> : eur(m.betrag, 2)}</div>
            </div>
          ))}
          {!z.mehrkosten.length && <div className="muted text-sm">Keine Mehrkosten gemeldet.</div>}
        </div>
      </details>
      <Kpi label="Wartet auf andere" value={`${z.behinderungen.length} ${z.behinderungen.length === 1 ? "Top" : "Tops"}`} sub={z.behinderungen.map((b) => `${b.top.top}: ${kurz(b.wartetAuf?.wartet_auf ?? "")}`).join(" · ") || "keine Behinderung"} />
      <Kpi
        label="Themen in Klärung"
        value={String(z.signale.length)}
        sub={z.signale.length ? `${offen} offen · ${inArbeit} beim Vorarbeiter${z.geloest.length ? ` · ${z.geloest.length} gelöst` : ""}` : `alles geklärt${z.geloest.length ? ` · ${z.geloest.length} gelöst` : ""}`}
        tone={z.signale.length ? "accent" : undefined}
      />
    </div>
  );
}

const kurz = (s: string) => (s.length > 26 ? s.slice(0, 25) + "…" : s);

function Kpi({ label, value, sub, tone, children }: { label: string; value: string; sub?: string; tone?: "accent"; children?: React.ReactNode }) {
  return (
    <div className="border-l border-[var(--line)] px-5 py-3 first:border-l-0">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl ${tone === "accent" ? "accent" : ""}`}>{value}</div>
      {sub && <div className="muted truncate text-xs" title={sub}>{sub}</div>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Left panel                                                          */
/* ------------------------------------------------------------------ */

function HausPanel({ daten, z, onFloor, neu }: { daten: ProjektDaten; z: Zwilling; onFloor: (g: string) => void; neu: Set<string> }) {
  const floors = [...z.geschosse].reverse();
  return (
    <div className="p-5">
      <div className="label">Projekt</div>
      <h1 className="mt-1 text-2xl leading-tight">{daten.projekt.name ?? daten.projekt.projekt}</h1>
      <div className="muted text-sm">{daten.projekt.adresse}</div>

      <div className="label mt-6">Geschosse</div>
      <div className="mt-2 space-y-1.5">
        {floors.map((g) => {
          const zs = g.tops.map((t) => z.tops[t.top]).filter(Boolean);
          const prog = zs.reduce((a, s) => a + s.fortschritt, 0) / Math.max(1, zs.length);
          const themen = zs.reduce((a, s) => a + s.signale.length, 0);
          const wartet = zs.filter((s) => s.wartetAuf).length;
          return (
            <button key={g.name} onClick={() => onFloor(g.name)} className="panel group flex w-full items-center gap-3 px-3 py-2.5 text-left hover:border-[var(--text)]">
              <div className="w-12 text-sm">{g.name}</div>
              <div className="flex-1">
                <div className="muted text-xs">{g.tops.map((t) => t.top).join(" · ")}</div>
                <div className="mt-1.5 h-1 rounded bg-[var(--line)]">
                  <div className="h-1 rounded bg-[var(--ok)]" style={{ width: `${Math.max(2, prog * 100)}%` }} />
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {themen > 0 && <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] text-white">{themen} {themen === 1 ? "Thema" : "Themen"}</span>}
                {wartet > 0 && <span className="chip">wartet</span>}
                {!themen && !wartet && <span className="muted text-xs">{pct(prog)}</span>}
              </div>
            </button>
          );
        })}
      </div>

      <Feed title="Zuletzt auf der Baustelle" eintraege={z.eintraege} neu={neu} limit={7} />
    </div>
  );
}

function GeschossPanel({ name, z, onTop, neu }: { name: string; z: Zwilling; onTop: (t: string) => void; neu: Set<string> }) {
  const g = z.geschosse.find((x) => x.name === name)!;
  const zs = g.tops.map((t) => z.tops[t.top]).filter(Boolean);
  const names = new Set(g.tops.map((t) => t.top));
  return (
    <div className="p-5">
      <div className="label">Geschoss</div>
      <h1 className="mt-1 text-2xl">{name}</h1>
      <div className="mt-4 space-y-2">
        {zs.map((s) => (
          <button key={s.top.top} onClick={() => onTop(s.top.top)} className={`panel w-full p-3 text-left hover:border-[var(--text)] ${s.signale.length ? "!border-[var(--accent)]" : ""}`}>
            <div className="flex items-center justify-between">
              <div className="text-base">{s.top.top}</div>
              <div className="muted text-sm">{pct(s.fortschritt)}</div>
            </div>
            <div className="mt-1.5 h-1 rounded bg-[var(--line)]">
              <div className="h-1 rounded bg-[var(--ok)]" style={{ width: `${Math.max(2, s.fortschritt * 100)}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {s.signale.map((sig) => (
                <span key={sig.id} className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-white">
                  {SIGNAL_ART_LABEL[sig.art]}
                </span>
              ))}
              {s.wartetAuf && <span className="chip">wartet auf {kurz(s.wartetAuf.wartet_auf ?? "Vorgewerk")}</span>}
              {s.letzte && <span className="muted">zuletzt: {zeitLabel(s.letzte.zeitpunkt)}</span>}
            </div>
          </button>
        ))}
      </div>
      <Feed title={`Meldungen ${name}`} eintraege={z.eintraege.filter((e) => e.top && names.has(e.top))} neu={neu} limit={8} />
    </div>
  );
}

function TopPanel({ zs, z, neu }: { zs: TopZustand; z: Zwilling; neu: Set<string> }) {
  const kosten = z.mehrkosten.filter((m) => m.top === zs.top.top);
  return (
    <div className="p-5">
      <div className="label">
        {zs.top.geschoss} · {zs.top.kaeufer_status === "verkauft" ? "verkauft" : zs.top.kaeufer_status === "frei" ? "frei" : "Allgemein"}
      </div>
      <h1 className="mt-1 text-2xl">{zs.top.top}</h1>
      {zs.plan && (
        <div className="muted mt-1 text-sm">
          Gültiger Plan: <span className="text-[var(--text)]">{zs.plan.plan_nr} Index {zs.plan.plan_index}</span> seit {zeitLabel(zs.plan.gueltig_ab)}
        </div>
      )}

      {zs.signale.map((s) => (
        <SignalKarte key={s.id} s={s} z={z} />
      ))}

      <div className="label mt-6">Arbeitsschritte Elektro</div>
      <div className="mt-2 space-y-1">
        {STUFEN.map((st) => {
          const e = zs.stufen[st.key];
          return (
            <div key={st.key} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${e ? "bg-[var(--ok)] text-white" : "border border-[var(--line)]"}`}>{e ? "✓" : ""}</span>
                {st.label}
              </span>
              <span className="muted text-xs">{e ? zeitLabel(e.zeitpunkt) : "offen"}</span>
            </div>
          );
        })}
      </div>

      {zs.wartetAuf && (
        <div className="mt-5 rounded border border-[var(--line)] bg-[var(--panel-2)] p-3 text-sm">
          <div className="label">Wartet auf</div>
          <div className="mt-1">{zs.wartetAuf.wartet_auf}</div>
          <div className="muted text-xs">gemeldet von {zs.wartetAuf.person} · {zeitLabel(zs.wartetAuf.zeitpunkt)}</div>
        </div>
      )}

      {kosten.length > 0 && (
        <>
          <div className="label mt-6">Mehrkosten in {zs.top.top}</div>
          {kosten.map((m, i) => (
            <div key={i} className="flex justify-between border-b border-[var(--line)] py-1.5 text-sm">
              <span>{m.titel}</span>
              <span className="accent whitespace-nowrap">{m.betrag === null ? "offen" : eur(m.betrag, 2)}</span>
            </div>
          ))}
        </>
      )}

      <Feed title="Verlauf" eintraege={zs.eintraege} neu={neu} limit={30} />
    </div>
  );
}

function SignalKarte({ s, z }: { s: Signal; z: Zwilling }) {
  const steps: { key: Signal["status"]; label: string; at: string | null }[] = [
    { key: "offen", label: "Erkannt", at: null },
    { key: "in_bearbeitung", label: "Vorarbeiter angerufen", at: s.angerufen_am },
    { key: "geloest", label: "Gelöst", at: s.geloest_am },
  ];
  const idx = steps.findIndex((x) => x.key === s.status);
  const belege = z.eintraege.filter((e) => s.eintrag_ids.includes(e.id));
  return (
    <div className="mt-4 overflow-hidden rounded border border-[var(--accent)]">
      <div className="bg-[var(--accent)] px-3 py-1.5 text-xs uppercase tracking-wide text-white">
        {SIGNAL_ART_LABEL[s.art]} · {s.schwere}
      </div>
      <div className="p-3">
        <div className="text-base leading-snug">{s.titel}</div>
        {s.begruendung && <p className="muted mt-1.5 text-sm leading-relaxed">{s.begruendung}</p>}
        <div className="mt-3 flex items-center gap-1">
          {steps.map((st, i) => (
            <div key={st.key} className="flex flex-1 flex-col">
              <div className={`h-1 rounded ${i <= idx ? "bg-[var(--accent)]" : "bg-[var(--line)]"}`} />
              <div className={`mt-1 text-[11px] ${i <= idx ? "" : "muted"}`}>{st.label}</div>
            </div>
          ))}
        </div>
        {s.zustaendig && (
          <div className="mt-2 text-xs">
            <span className="muted">Zuständig vor Ort:</span> {s.zustaendig}
            {s.angerufen_am ? ` · angerufen ${zeitLabel(s.angerufen_am)}` : " · Anruf folgt"}
          </div>
        )}
        {s.anruf_text && <div className="mt-2 rounded bg-[var(--panel-2)] p-2 text-xs italic">„{s.anruf_text}“</div>}
        {belege.length > 0 && (
          <div className="muted mt-2 text-xs">
            Belege: {belege.map((b) => `${quelle(b)} ${zeitLabel(b.zeitpunkt)}`).join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

const quelle = (e: Eintrag) => ({ whatsapp: "WhatsApp", email: "Mail", call: "Anruf", drive: "Drive" })[e.quelle_typ ?? "whatsapp"] ?? "Quelle";

function Feed({ title, eintraege, neu, limit }: { title: string; eintraege: Eintrag[]; neu: Set<string>; limit: number }) {
  const list = [...eintraege].filter((e) => e.art !== "sonstiges" || e.top).reverse().slice(0, limit);
  return (
    <>
      <div className="label mt-7">{title}</div>
      <div className="mt-2">
        {list.map((e) => (
          <div key={e.id} className={`border-b border-[var(--line)] py-2.5 ${neu.has(e.id) ? "flash" : ""}`}>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="chip">{quelle(e)}</span>
              <span className={`chip ${e.art === "behinderung" || e.art === "planaenderung" ? "!border-[var(--accent)] accent" : ""}`}>{ART_LABEL[e.art]}</span>
              {e.top && <span className="chip">{e.top}</span>}
              <span className="muted ml-auto">{zeitLabel(e.zeitpunkt)}</span>
            </div>
            <div className="mt-1.5 text-sm leading-snug">{e.zusammenfassung}</div>
            <div className="muted mt-0.5 text-xs">{e.person}</div>
            {e.quelle_anhang_pfad && /\.(jpe?g|png|webp)$/i.test(e.quelle_anhang_pfad) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/anhang?pfad=${encodeURIComponent(e.quelle_anhang_pfad)}`} alt="Foto von der Baustelle" className="mt-2 h-28 w-full rounded object-cover" loading="lazy" />
            )}
          </div>
        ))}
        {!list.length && <div className="muted py-3 text-sm">Noch keine Meldungen.</div>}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function Timeline({ daten, z, cursor, setCursor }: { daten: ProjektDaten; z: Zwilling; cursor: number | null; setCursor: (v: number | null) => void }) {
  const von = z.von;
  const bis = z.bis;
  const span = Math.max(1, bis - von);
  const pos = (t: number) => ((t - von) / span) * 100;
  const days = useMemo(() => {
    const out: number[] = [];
    const d = new Date(von);
    d.setHours(0, 0, 0, 0);
    for (let t = d.getTime() + 86400000; t < bis; t += 86400000) out.push(t);
    return out;
  }, [von, bis]);
  const value = cursor ?? bis;

  return (
    <div className="border-t border-[var(--line)] bg-white px-6 pb-3 pt-2">
      <div className="flex items-center gap-4">
        <div className="label w-24">Zeitleiste</div>
        <div className="relative h-9 flex-1">
          {days.map((t) => (
            <div key={t} className="absolute top-0 h-full border-l border-dashed border-[var(--line)]" style={{ left: `${pos(t)}%` }}>
              <span className="label absolute -top-0.5 left-1 whitespace-nowrap !text-[10px]">{new Date(t).toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
            </div>
          ))}
          {daten.eintraege.map((e) => (
            <div
              key={e.id}
              title={`${zeitLabel(e.zeitpunkt)} · ${e.zusammenfassung}`}
              className="absolute top-[22px] h-2.5 w-[3px] -translate-x-1/2 rounded-sm"
              style={{
                left: `${pos(ts(e.zeitpunkt))}%`,
                background: e.art === "arbeit_erledigt" ? "var(--ok)" : e.art === "behinderung" || e.art === "planaenderung" ? "var(--accent)" : "#c9c3bb",
                opacity: ts(e.zeitpunkt) <= value ? 1 : 0.35,
              }}
            />
          ))}
          <input
            type="range"
            min={von}
            max={bis}
            step={60000}
            value={value}
            onChange={(e) => {
              const v = Number(e.target.value);
              setCursor(v >= bis - 60000 ? null : v);
            }}
            className="tw-range absolute inset-x-0 top-[14px] w-full"
            aria-label="Zeitpunkt"
          />
        </div>
        <button onClick={() => setCursor(null)} className={`btn w-24 ${cursor === null ? "btn-ink" : ""}`}>
          {cursor === null ? "● Live" : "Zu jetzt"}
        </button>
      </div>
      <div className="muted ml-28 mt-0.5 flex gap-4 text-[11px]">
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-[var(--ok)]" /> erledigt
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-[var(--accent)]" /> Planänderung, Behinderung
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-[#c9c3bb]" /> sonstige Meldung
        </span>
        <span className="ml-auto">Zurückziehen zeigt den Stand von damals</span>
      </div>
    </div>
  );
}
