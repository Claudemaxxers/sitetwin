"use client";

import { useMemo, useState } from "react";
import { eur, SIGNAL_ART_LABEL, type ProjektDaten, type Zwilling } from "@/lib/twin-model";
import { aenderungen, kostenVerlauf, quelleLabel, SIGNAL_STATUS, TRADE_COLORS, zeitKurz, type Aenderung } from "@/lib/talona";
import type { Nav } from "./AppShell";
import { Card, Kuerzel, Label, PageTitle, Pill, Tabs } from "./ui";

type Tab = "uebersicht" | "gewerk" | "top";

export function ChangesView({ daten, z, detail, setDetail, nav }: { daten: ProjektDaten; z: Zwilling; detail: string | null; setDetail: (id: string | null) => void; nav: Nav }) {
  const [tab, setTab] = useState<Tab>("uebersicht");
  const [q, setQ] = useState("");
  const liste = useMemo(() => aenderungen(daten, z), [daten, z]);
  const gefiltert = liste.filter((a) => !q || `${a.titel} ${a.ort} ${a.gewerk} ${a.von}`.toLowerCase().includes(q.toLowerCase()));
  const sel = detail ? liste.find((a) => a.id === detail) : null;
  if (sel) return <ChangeDetail a={sel} liste={liste} daten={daten} setDetail={setDetail} nav={nav} />;

  const ohnePreis = liste.filter((a) => a.kind === "mehrkosten" && a.betrag === null).length;
  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <PageTitle
        title="Änderungen"
        right={
          <button className="btn" onClick={() => nav.zuTop(liste.find((a) => a.top)?.top ?? "")}>
            Im Zwilling ansehen
          </button>
        }
      />
      <div className="mt-5">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "uebersicht", label: "Übersicht" },
            { key: "gewerk", label: "Nach Gewerk" },
            { key: "top", label: "Nach Top" },
          ]}
        />
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen oder filtern…" className="input mt-4 !w-64 !rounded-full !px-4" />

      {tab === "uebersicht" && (
        <>
          <Card className="mt-4 p-5">
            <div className="muted text-[12px]">Seit Baubeginn</div>
            <div className="mt-0.5 text-[17px]">Erfasste Änderungen ›</div>
            <div className="mt-4 flex gap-12">
              <Zahl label="Wert erfasst" wert={eur(z.mehrkostenSumme, 2)} />
              <Zahl label="Noch ohne Preis" wert={`${ohnePreis} ${ohnePreis === 1 ? "Position" : "Positionen"}`} />
              <Zahl label="Offene Themen" wert={String(z.signale.length)} accent={z.signale.length > 0} />
            </div>
            <Flaeche z={z} />
          </Card>
          <Tabelle liste={gefiltert} onOpen={setDetail} />
        </>
      )}
      {tab === "gewerk" && <Gruppiert liste={gefiltert} by={(a) => a.gewerk} kopf="Gewerk" onOpen={setDetail} />}
      {tab === "top" && <Gruppiert liste={gefiltert} by={(a) => a.top ?? "Allgemein"} kopf="Top" onOpen={setDetail} />}
    </div>
  );
}

function Zahl({ label, wert, accent }: { label: string; wert: string; accent?: boolean }) {
  return (
    <div>
      <div className="muted text-[12px]">{label}</div>
      <div className={`mt-0.5 text-[20px] tracking-[-0.01em] ${accent ? "accent" : ""}`}>{wert}</div>
    </div>
  );
}

/** Stacked area per trade, Talona style, with a hover tooltip. */
function Flaeche({ z }: { z: Zwilling }) {
  const { punkte, serien } = useMemo(() => kostenVerlauf(z), [z]);
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = 190;
  const max = Math.max(1, ...punkte.map((_, i) => serien.reduce((a, s) => a + s.werte[i], 0))) * 1.15;
  const x = (i: number) => (i / (punkte.length - 1)) * W;
  const y = (v: number) => H - (v / max) * H;
  let unten = punkte.map(() => 0);
  const flaechen = serien.map((s, k) => {
    const oben = unten.map((u, i) => u + s.werte[i]);
    const d = `M${oben.map((v, i) => `${x(i)},${y(v)}`).join("L")}L${[...unten].reverse().map((v, i) => `${x(punkte.length - 1 - i)},${y(v)}`).join("L")}Z`;
    unten = oben;
    return { d, color: TRADE_COLORS[k % TRADE_COLORS.length], gewerk: s.gewerk };
  });
  if (!serien.length) return <div className="muted mt-6 text-sm">Noch keine Mehrkosten erfasst.</div>;
  const i = hover;
  return (
    <div className="relative mt-6" onMouseLeave={() => setHover(null)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[190px] w-full"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (punkte.length - 1)));
        }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="rgba(33,33,33,.06)" />
        ))}
        {flaechen.map((f) => (
          <path key={f.gewerk} d={f.d} fill={f.color} fillOpacity={0.22} stroke={f.color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        ))}
        {i !== null && <line x1={x(i)} x2={x(i)} y1={0} y2={H} stroke="#0c0a08" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {i !== null && (
        <div className="pointer-events-none absolute top-2 z-10 w-56 overflow-hidden rounded-[4px] border border-[var(--line)] bg-white text-[12px] shadow-lg" style={{ left: `min(calc(${(i / (punkte.length - 1)) * 100}% + 12px), calc(100% - 230px))` }}>
          <div className="flex justify-between bg-[var(--text)] px-2.5 py-1.5 text-white">
            <span>{zeitKurz(punkte[i])}</span>
            <span>{eur(serien.reduce((a, s) => a + s.werte[i], 0))}</span>
          </div>
          {serien.map((s, k) => (
            <div key={s.gewerk} className="flex items-center justify-between px-2.5 py-1">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: TRADE_COLORS[k % TRADE_COLORS.length] }} />
                {s.gewerk}
              </span>
              <span>{eur(s.werte[i])}</span>
            </div>
          ))}
        </div>
      )}
      <div className="muted mt-2 flex justify-between text-[11px]">
        <span>{zeitKurz(z.von)}</span>
        <span>{zeitKurz(z.bis)}</span>
      </div>
    </div>
  );
}

function Tabelle({ liste, onOpen }: { liste: Aenderung[]; onOpen: (id: string) => void }) {
  return (
    <Card className="mt-5 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3">
        <div className="text-[15px]">Mögliche Änderungen</div>
        <span className="muted text-[12px]">{liste.length} gesamt</span>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="muted border-y border-[var(--line)] text-left text-[11px]">
            <th className="px-5 py-2 font-normal">Änderung</th>
            <th className="py-2 font-normal">Ort</th>
            <th className="py-2 font-normal">Gewerk</th>
            <th className="py-2 font-normal">Von</th>
            <th className="py-2 font-normal">Belege</th>
            <th className="py-2 font-normal">Wert</th>
            <th className="px-5 py-2 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {liste.map((a) => (
            <tr key={a.id} onClick={() => onOpen(a.id)} className="cursor-pointer border-b border-[var(--line)] last:border-0 hover:bg-[var(--wash)]">
              <td className="max-w-[320px] truncate px-5 py-2.5">{a.titel}</td>
              <td className="muted py-2.5">{a.ort}</td>
              <td className="muted py-2.5">{a.gewerk}</td>
              <td className="muted py-2.5">{a.von}</td>
              <td className="muted py-2.5">{a.belege}</td>
              <td className="py-2.5">{a.betrag === null ? <span className="muted">–</span> : eur(a.betrag, 2)}</td>
              <td className="px-5 py-2.5">
                <Pill tone={a.status.tone}>{a.status.label}</Pill>
              </td>
            </tr>
          ))}
          {!liste.length && (
            <tr>
              <td colSpan={7} className="muted px-5 py-6">
                Keine Änderungen gefunden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function Gruppiert({ liste, by, kopf, onOpen }: { liste: Aenderung[]; by: (a: Aenderung) => string; kopf: string; onOpen: (id: string) => void }) {
  const gruppen = [...new Set(liste.map(by))].map((g) => ({ g, items: liste.filter((a) => by(a) === g) }));
  return (
    <div className="mt-5 space-y-4">
      {gruppen.map(({ g, items }) => (
        <Card key={g} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
            <div>
              <span className="muted mr-2 text-[11px]">{kopf}</span>
              <span className="text-[15px]">{g}</span>
            </div>
            <span className="text-[13px]">
              {eur(items.reduce((a, x) => a + (x.betrag ?? 0), 0), 2)} <span className="muted">· {items.length}</span>
            </span>
          </div>
          {items.map((a) => (
            <button key={a.id} onClick={() => onOpen(a.id)} className="flex w-full items-center justify-between border-b border-[var(--line)] px-5 py-2.5 text-left text-[13px] last:border-0 hover:bg-[var(--wash)]">
              <span className="truncate">{a.titel}</span>
              <Pill tone={a.status.tone}>{a.status.label}</Pill>
            </button>
          ))}
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail (Talona: "Draft · CN-014 · Kitchen wall move")               */
/* ------------------------------------------------------------------ */

function kuerzel(a: Aenderung) {
  const t = (a.top ?? a.ort).replace(/[^A-Za-z0-9 ]/g, "");
  const m = t.match(/(\w)\w*\s*(\d+)/);
  return m ? `${m[1]}${m[2]}`.toUpperCase().slice(0, 3) : t.slice(0, 2).toUpperCase();
}

function ChangeDetail({ a, liste, daten, setDetail, nav }: { a: Aenderung; liste: Aenderung[]; daten: ProjektDaten; setDetail: (id: string | null) => void; nav: Nav }) {
  const [tab, setTab] = useState<"uebersicht" | "verlauf">("uebersicht");
  const pruefen = liste.filter((x) => x.status.tone === "accent" || x.status.tone === "info");
  const bereit = liste.filter((x) => !pruefen.includes(x));
  const s = a.signal;
  const quelle = a.eintraege[0];
  const arten = [...new Set(a.eintraege.map(quelleLabel))];
  const plan = daten.plaene.find((p) => p.top && p.top === a.top);
  const gemeldetIndex = a.eintraege.find((e) => e.plan_index)?.plan_index;
  const verlauf = s ? daten.verlauf.filter((v) => v.signal_id === s.id) : [];

  return (
    <div className="grid h-full grid-cols-[300px_minmax(0,1fr)]">
      <aside className="overflow-y-auto border-r border-[var(--line)] px-3 py-5">
        <button onClick={() => setDetail(null)} className="muted mb-4 px-2 text-[13px] hover:text-[var(--text)]">
          ‹ Zurück zu Änderungen
        </button>
        {[
          { titel: "Prüfen", items: pruefen },
          { titel: "Erfasst", items: bereit },
        ].map(({ titel, items }) =>
          items.length ? (
            <div key={titel} className="mb-4">
              <div className="muted px-2 pb-1 text-[12px]">{titel}</div>
              {items.map((x) => (
                <button key={x.id} onClick={() => setDetail(x.id)} className={`flex w-full items-center gap-2.5 rounded-[4px] px-2 py-2 text-left ${x.id === a.id ? "bg-[var(--panel-2)]" : "hover:bg-[var(--wash)]"}`}>
                  <Kuerzel>{kuerzel(x)}</Kuerzel>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{x.titel}</span>
                    <span className="muted block truncate text-[11px]">{x.betrag !== null ? eur(x.betrag, 2) : x.status.label}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null,
        )}
      </aside>

      <div className="overflow-y-auto px-10 py-6">
        <PageTitle
          eyebrow={`${s ? `Thema · ${SIGNAL_ART_LABEL[s.art]}` : "Mehrkosten"} · ${a.status.label}`}
          title={a.titel}
          right={
            a.top ? (
              <button className="btn btn-accent" onClick={() => nav.zuTop(a.top!)}>
                Im Zwilling zeigen
              </button>
            ) : undefined
          }
        />
        <div className="mt-5">
          <Tabs value={tab} onChange={setTab} tabs={[{ key: "uebersicht", label: "Übersicht" }, { key: "verlauf", label: "Verlauf" }]} />
        </div>

        {tab === "uebersicht" ? (
          <div className="max-w-[720px]">
            <Label className="mt-6">Quelle</Label>
            <Card className="mt-2 flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-3">
                <Kuerzel size={32}>BV</Kuerzel>
                <div>
                  <div className="text-[14px]">{daten.projekt.name ?? daten.projekt.projekt}</div>
                  <div className="muted text-[12px]">
                    {arten.join(" und ")} von {quelle?.person ?? a.von} · {zeitKurz(quelle?.zeitpunkt ?? null)}
                  </div>
                </div>
              </div>
              {quelle && (
                <button onClick={() => nav.zuNachricht(quelle.quelle_hash)} className="text-[13px] underline underline-offset-2">
                  Nachrichten ansehen
                </button>
              )}
            </Card>

            <Label className="mt-6">Details</Label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Feld label="Erkannt am" wert={zeitKurz(a.zeit)} />
              <Feld label="Ort" wert={a.ort} />
            </div>
            {plan && (
              <div className="muted mt-2 text-[12px]">
                Gültiger Plan ist {plan.plan_nr} Index {plan.plan_index}
                {gemeldetIndex && gemeldetIndex !== plan.plan_index ? <span className="accent"> · gearbeitet nach Index {gemeldetIndex}</span> : null}
              </div>
            )}
            <div className="mt-3">
              <Feld label="Beschreibung" wert={s?.begruendung ?? a.mehrkosten?.grundlage ?? a.titel} mehrzeilig />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Feld label="Schätzung" wert={a.betrag === null ? "Preis fehlt" : eur(a.betrag, 2)} />
              <Feld label="Gewerk" wert={a.gewerk} />
            </div>

            {s && (
              <>
                <Label className="mt-6">Klärung vor Ort</Label>
                <Card className="mt-2 p-4">
                  <div className="flex gap-1">
                    {(["offen", "in_bearbeitung", "geloest"] as const).map((k, i) => {
                      const idx = ["offen", "in_bearbeitung", "geloest"].indexOf(s.status);
                      return (
                        <div key={k} className="flex-1">
                          <div className={`h-1 rounded ${i <= idx ? "bg-[var(--accent)]" : "bg-[var(--line)]"}`} />
                          <div className={`mt-1 text-[11px] ${i <= idx ? "" : "muted"}`}>{k === "offen" ? "Erkannt" : k === "in_bearbeitung" ? "Vorarbeiter angerufen" : "Gelöst"}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 text-[13px]">
                    <span className="muted">Zuständig:</span> {s.zustaendig ?? "–"}
                    {s.angerufen_am ? <span className="muted"> · angerufen {zeitKurz(s.angerufen_am)}</span> : <span className="muted"> · Anruf folgt</span>}
                  </div>
                  {s.anruf_text && <div className="mt-3 rounded-[4px] bg-[var(--panel-2)] p-3 text-[13px] italic leading-relaxed">„{s.anruf_text}“</div>}
                </Card>
              </>
            )}
          </div>
        ) : (
          <div className="mt-6 max-w-[720px]">
            {[
              ...verlauf.map((v) => ({ t: v.zeitpunkt, titel: `Status: ${SIGNAL_STATUS[v.status].label}`, sub: "SiteTwin" })),
              ...a.eintraege.map((e) => ({ t: e.zeitpunkt ?? "", titel: e.zusammenfassung, sub: `${e.person ?? ""} · ${quelleLabel(e)}` })),
            ]
              .sort((x, y) => new Date(y.t).getTime() - new Date(x.t).getTime())
              .map((r, i) => (
                <div key={i} className="flex gap-4 border-b border-[var(--line)] py-3 text-[13px]">
                  <span className="mono muted w-24 shrink-0 text-[11px]">{zeitKurz(r.t)}</span>
                  <div>
                    <div>{r.titel}</div>
                    <div className="muted text-[12px]">{r.sub}</div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Feld({ label, wert, mehrzeilig }: { label: string; wert: string; mehrzeilig?: boolean }) {
  return (
    <div className="rounded-[4px] border border-[var(--line)] px-3 py-2">
      <div className="muted text-[11px]">{label}</div>
      <div className={`mt-0.5 text-[14px] ${mehrzeilig ? "leading-relaxed" : "truncate"}`}>{wert}</div>
    </div>
  );
}
