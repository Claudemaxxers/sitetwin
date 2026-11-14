"use client";

import { useMemo, useState } from "react";
import { ts } from "@/lib/twin-model";
import { exposure as exposureTabelle, istAudio, istFoto, tagKey, type Aenderung } from "@/lib/vm";
import { anhangUrl, type Modell, type Nav } from "./modell";
import { Avatar, Btn, Card, eur, eurK, Feld, H2, I, Kuerzel, MonoLabel, PageHead, Pill, QuelleChip, Suche, tagKurz, tagZeit, Tabs, zeit } from "./ui";
import { Erkennung } from "./Erkennung";

type Tab = "uebersicht" | "gewerk" | "top";
const FARBEN = ["#EE783B", "#5683D2", "#6FA77F", "#9A86C9", "#B8B2AB", "#D9B04C", "#7FB3B8"];

export function ChangesView({ m, detail, exposure, nav }: { m: Modell; detail: string | null; exposure: boolean; nav: Nav }) {
  const sel = detail ? m.ch.find((c) => c.key === detail) : null;
  if (sel) return <ChangeDetail c={sel} m={m} nav={nav} />;
  if (exposure) return <Exposure m={m} nav={nav} />;
  return <Uebersicht m={m} nav={nav} />;
}

/* ------------------------------------------------------------------ */
/* Overview (Talona: Changes · Overview · By trade · By unit)          */
/* ------------------------------------------------------------------ */

function Uebersicht({ m, nav }: { m: Modell; nav: Nav }) {
  const [tab, setTab] = useState<Tab>("uebersicht");
  const [q, setQ] = useState("");
  const liste = m.ch.filter((c) => !q || `${c.titel} ${c.ort} ${c.gewerk} ${c.von.name} ${c.nr}`.toLowerCase().includes(q.toLowerCase()));
  const wert = m.ch.reduce((a, c) => a + (c.schaetzung?.betrag ?? 0), 0);
  const offen = m.ch.filter((c) => !c.bereit).reduce((a, c) => a + (c.schaetzung?.betrag ?? 0), 0);
  const ersteOffene = m.ch.find((c) => !c.bereit) ?? m.ch[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-12 pt-10">
        <PageHead
          title="Änderungen"
          right={
            <>
              <Btn onClick={() => nav.fragen()}>SiteTwin fragen</Btn>
              {ersteOffene && (
                <Btn primary onClick={() => nav.entwurf(ersteOffene)}>
                  + Änderung aufschreiben
                </Btn>
              )}
            </>
          }
        />
        <div className="mt-8">
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
      </div>
      <div className="px-12 pb-12 pt-6">
        <Suche value={q} onChange={setQ} placeholder="Suchen oder filtern…" />

        {tab === "uebersicht" && (
          <>
            <Card className="mt-6 px-8 py-7">
              <div className="text-[14px] text-[rgba(12,10,8,.6)]">Seit Baubeginn</div>
              <button onClick={nav.exposure} className="mt-1 flex items-center gap-1 text-[22px] tracking-[-0.01em] hover:underline">
                Erfasste Änderungen <I.ChevronRight className="size-5" />
              </button>
              <div className="mt-5 flex gap-16">
                <Zahl label="Wert erfasst" wert={eur(wert)} />
                <Zahl label="Noch nicht freigegeben" wert={eur(offen)} />
              </div>
              <Flaeche m={m} />
            </Card>
            <Tabelle titel={`${m.d.projekt.name ?? m.d.projekt.projekt} · Mögliche Änderungen`} liste={liste} nav={nav} jetzt={m.jetzt} />
          </>
        )}
        {tab === "gewerk" && <Gruppiert liste={liste} by={(c) => c.gewerk} nav={nav} jetzt={m.jetzt} />}
        {tab === "top" && <Gruppiert liste={liste} by={(c) => c.top ?? "Allgemein"} nav={nav} jetzt={m.jetzt} />}
      </div>
    </div>
  );
}

function Zahl({ label, wert }: { label: string; wert: string }) {
  return (
    <div>
      <div className="text-[14px] text-[rgba(12,10,8,.6)]">{label}</div>
      <div className="mt-1 text-[22px] tracking-[-0.01em]">{wert}</div>
    </div>
  );
}

/** Stacked areas per unit with Talona's black-pill tooltip. */
function Flaeche({ m }: { m: Modell }) {
  const { punkte, serien } = useMemo(() => {
    const von = Math.min(...m.ch.map((c) => ts(c.erhoben)), m.jetzt) - 3600000 * 6;
    const bis = m.jetzt + 3600000;
    const tops = [...new Set(m.ch.filter((c) => c.schaetzung).map((c) => c.top ?? "Allgemein"))];
    const p = Array.from({ length: 21 }, (_, i) => von + ((bis - von) * i) / 20);
    return { punkte: p, serien: tops.map((t) => ({ name: t, werte: p.map((x) => m.ch.filter((c) => (c.top ?? "Allgemein") === t && ts(c.erhoben) <= x).reduce((a, c) => a + (c.schaetzung?.betrag ?? 0), 0)) })) };
  }, [m]);
  const [hover, setHover] = useState<number | null>(null);
  if (!serien.length) return <div className="mt-8 text-[14px] text-[rgba(12,10,8,.6)]">Noch keine bewerteten Änderungen.</div>;
  const W = 1000;
  const H = 230;
  const summe = (i: number) => serien.reduce((a, s) => a + s.werte[i], 0);
  const max = Math.max(1, ...punkte.map((_, i) => summe(i))) * 1.12;
  const x = (i: number) => (i / (punkte.length - 1)) * W;
  const y = (v: number) => H - (v / max) * H;
  let unten = punkte.map(() => 0);
  const flaechen = serien.map((s, k) => {
    const oben = unten.map((u, i) => u + s.werte[i]);
    const linie = oben.map((v, i) => `${x(i)},${y(v)}`).join("L");
    const d = `M${linie}L${[...unten].reverse().map((v, i) => `${x(punkte.length - 1 - i)},${y(v)}`).join("L")}Z`;
    unten = oben;
    return { d, linie: `M${linie}`, farbe: FARBEN[k % FARBEN.length], name: s.name };
  });
  const i = hover;
  return (
    <div className="relative mt-8" onMouseLeave={() => setHover(null)}>
      <div className="mb-2 text-[12px] text-[rgba(12,10,8,.5)]">{eurK(max)}</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[230px] w-full"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          setHover(Math.max(0, Math.min(punkte.length - 1, Math.round(((e.clientX - r.left) / r.width) * (punkte.length - 1)))));
        }}
      >
        {flaechen.map((f) => (
          <g key={f.name}>
            <path d={f.d} fill={f.farbe} fillOpacity={0.14} />
            <path d={f.linie} fill="none" stroke={f.farbe} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {i !== null && <line x1={x(i)} x2={x(i)} y1={0} y2={H} stroke="#0c0a08" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {i !== null && (
        <div className="pointer-events-none absolute top-6 z-10 w-64 rounded-[6px] border border-[var(--line)] bg-white p-2.5 text-[13px] shadow-[0_8px_24px_rgba(12,10,8,.12)]" style={{ left: `min(calc(${(i / (punkte.length - 1)) * 100}% + 14px), calc(100% - 270px))` }}>
          <div className="flex items-center justify-between">
            <span className="rounded-[3px] bg-[var(--text)] px-2 py-0.5 text-white">bis {tagKurz(punkte[i])}</span>
            <span>{eur(summe(i), 0)} erfasst</span>
          </div>
          {serien.map((s, k) => (
            <div key={s.name} className="mt-1.5 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: FARBEN[k % FARBEN.length] }} />
                {s.name}
              </span>
              <span>{eur(s.werte[i], 0)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex justify-between text-[12px] text-[rgba(12,10,8,.5)]">
        <span>{tagKurz(punkte[0])}</span>
        <span>{tagKurz(punkte[punkte.length - 1])}</span>
      </div>
    </div>
  );
}

/** Talona's "Potential changes" table. */
function Tabelle({ titel, liste, nav, jetzt }: { titel: string; liste: Aenderung[]; nav: Nav; jetzt: number }) {
  const woche = liste.filter((c) => jetzt - ts(c.erhoben) < 7 * 86400000).length;
  return (
    <Card className="mt-6 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5 text-[15px]">
          <Logo16 />
          {titel}
        </div>
        <Pill>{woche} diese Woche</Pill>
      </div>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-y border-[var(--line)] text-left">
            {["Mögliche Änderung", "Ort", "Gewerk", "Von", "Belege", "Wert", "Status"].map((h, i) => (
              <th key={h} className={`py-3 font-normal ${i === 0 ? "pl-6" : ""} ${i === 6 ? "pr-6" : ""}`}>
                <MonoLabel>{h}</MonoLabel>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {liste.map((c) => (
            <tr key={c.key} onClick={() => nav.aenderung(c.key)} className="cursor-pointer border-b border-[var(--line)] last:border-0 hover:bg-[var(--wash)]">
              <td className="py-4 pl-6 pr-4">
                <div>{c.titel}</div>
                <div className="mono text-[11px] text-[rgba(12,10,8,.45)]">{c.nr}</div>
              </td>
              <td className="pr-4 text-[rgba(12,10,8,.65)]">{c.ort}</td>
              <td className="pr-4 text-[rgba(12,10,8,.65)]">{c.gewerk}</td>
              <td className="pr-4 text-[rgba(12,10,8,.65)]">
                {c.von.vorname}
                {c.imAuftrag ? <span className="text-[rgba(12,10,8,.45)]">, für {c.imAuftrag.vorname}</span> : null}
              </td>
              <td className="pr-4 text-[#a4562a]">{c.belege.text}</td>
              <td className="pr-4">{c.schaetzung ? eur(c.schaetzung.betrag) : <span className="text-[rgba(12,10,8,.4)]">–</span>}</td>
              <td className="pr-6">
                <Pill ton={c.status.ton}>{c.status.label}</Pill>
              </td>
            </tr>
          ))}
          {!liste.length && (
            <tr>
              <td colSpan={7} className="px-6 py-8 text-[rgba(12,10,8,.55)]">
                Keine Änderungen gefunden.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function Gruppiert({ liste, by, nav, jetzt }: { liste: Aenderung[]; by: (c: Aenderung) => string; nav: Nav; jetzt: number }) {
  const gruppen = [...new Set(liste.map(by))].sort((a, b) => a.localeCompare(b, "de", { numeric: true }));
  return (
    <div>
      {gruppen.map((g) => {
        const items = liste.filter((c) => by(c) === g);
        const summe = items.reduce((a, c) => a + (c.schaetzung?.betrag ?? 0), 0);
        return <Tabelle key={g} titel={`${g} · ${eur(summe)} · ${items.length} ${items.length === 1 ? "Änderung" : "Änderungen"}`} liste={items} nav={nav} jetzt={jetzt} />;
      })}
    </div>
  );
}

function Logo16() {
  return (
    <svg width="18" height="18" viewBox="0 0 26 26" aria-hidden>
      <rect x="3" y="15" width="20" height="7" rx="1.5" fill="#0c0a08" />
      <rect x="3" y="9.5" width="20" height="4.5" rx="1.2" fill="#0c0a08" opacity=".55" />
      <rect x="3" y="4" width="20" height="4.5" rx="1.2" fill="#ee783b" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Exposure (Talona: caught this quarter, written up, trade × day)     */
/* ------------------------------------------------------------------ */

function Exposure({ m, nav }: { m: Modell; nav: Nav }) {
  const [gruppe, setGruppe] = useState<"gewerk" | "top">("top");
  const tab = exposureTabelle(m.ch, gruppe);
  const wert = m.ch.reduce((a, c) => a + (c.schaetzung?.betrag ?? 0), 0);
  const frei = m.ch.filter((c) => c.bereit).reduce((a, c) => a + (c.schaetzung?.betrag ?? 0), 0);
  const nFrei = m.ch.filter((c) => c.bereit).length;
  const tage = Math.max(1, Math.round((m.jetzt - Math.min(...m.ch.map((c) => ts(c.erhoben)), m.jetzt)) / 86400000) + 1);
  const offeneReihe = useMemo(() => {
    const sorted = [...m.ch].sort((a, b) => ts(a.erhoben) - ts(b.erhoben));
    return sorted.map((_, i) => sorted.slice(0, i + 1).filter((c) => !c.bereit).reduce((a, c) => a + (c.schaetzung?.betrag ?? 0), 0));
  }, [m.ch]);
  const naechste = m.ch.find((c) => !c.bereit && c.schaetzung) ?? m.ch[0];

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-[var(--line)] px-12 pb-6 pt-8">
        <button onClick={() => nav.zu("aenderungen")} className="mb-3 flex items-center gap-1 text-[14px] underline underline-offset-4">
          <I.ChevronLeft className="size-4" /> Änderungen
        </button>
        <PageHead title="Abrechnung" right={naechste && <Btn primary onClick={() => nav.entwurf(naechste)}>An Bauherr senden</Btn>} />
      </div>
      <div className="flex flex-wrap gap-3 border-b border-[var(--line)] bg-[#faf9f7] px-12 py-4 text-[14px]">
        <Chip k="Projekt" v={m.d.projekt.projekt} />
        <Chip k="Zeitraum" v={`${tage} Tage`} />
        <button onClick={() => setGruppe(gruppe === "top" ? "gewerk" : "top")}>
          <Chip k="Gruppe" v={gruppe === "top" ? "Top ▾" : "Gewerk ▾"} />
        </button>
      </div>
      <div className="px-12 py-8">
        <div className="flex items-start gap-16">
          <div>
            <div className="text-[14px] text-[rgba(12,10,8,.6)]">Erfasst seit Baubeginn</div>
            <div className="mt-1 text-[28px] tracking-[-0.01em]">{eur(wert)}</div>
            <div className="mt-1 text-[14px] text-[rgba(12,10,8,.6)] underline underline-offset-4">{eur(frei, 0)} freigegeben</div>
          </div>
          <div>
            <div className="text-[14px] text-[rgba(12,10,8,.6)]">Status</div>
            <div className="mt-1 flex items-center gap-2 text-[28px] tracking-[-0.01em]">
              <I.Check className="size-6" /> {nFrei} von {m.ch.length} freigegeben
            </div>
            <div className="mt-1 text-[14px] text-[rgba(12,10,8,.6)]">{eur(wert - frei, 0)} noch ohne Freigabe</div>
          </div>
          <MiniFlaeche werte={offeneReihe} />
        </div>

        <Card className="mt-8 overflow-hidden">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="px-6 py-4 text-left font-normal">{gruppe === "top" ? "Top" : "Gewerk"}</th>
                {tab.spalten.map((s) => (
                  <th key={s} className="border-l border-[var(--line)] px-6 py-4 text-right font-normal">
                    {tagKurz(s + "T12:00:00")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tab.zeilen.map((z) => (
                <tr key={z} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-6 py-5">{z}</td>
                  {tab.spalten.map((s) => {
                    const v = tab.zelle(z, s);
                    return (
                      <td key={s} className={`border-l border-[var(--line)] px-6 py-5 text-right ${v === null ? "text-[rgba(12,10,8,.35)]" : v < 0 ? "text-[#a63a2b]" : "text-[#2f6b40]"}`}>
                        {v === null ? "—" : `${v < 0 ? "-" : "+"}${eur(Math.abs(v))}`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-3 text-[12px] text-[rgba(12,10,8,.5)]">Rot: erfasst, aber noch ohne Freigabe. Grün: freigegeben und bewertet. Schätzungen aus LV-Preisen und Regiesatz, teils aus der Demo-Kalkulation.</p>
      </div>
    </div>
  );
}

function Chip({ k, v }: { k: string; v: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white py-1 pl-4 pr-1">
      {k}
      <span className="rounded-full border border-[var(--line)] px-3 py-0.5">{v}</span>
    </span>
  );
}

function MiniFlaeche({ werte }: { werte: number[] }) {
  if (werte.length < 2) return null;
  const W = 520;
  const H = 110;
  const max = Math.max(1, ...werte);
  const pts = werte.map((v, i) => `${(i / (werte.length - 1)) * W},${H - (v / max) * H * 0.9}`).join(" L");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ml-auto h-[110px] w-[520px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6FA77F" stopOpacity=".35" />
          <stop offset="1" stopColor="#6FA77F" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M${pts} L${W},${H} L0,${H}Z`} fill="url(#g)" />
      <path d={`M${pts}`} fill="none" stroke="#5f8f6c" strokeWidth={1.5} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Detail (Talona: "Draft · CN-014 · Kitchen wall move")               */
/* ------------------------------------------------------------------ */

function ChangeDetail({ c, m, nav }: { c: Aenderung; m: Modell; nav: Nav }) {
  const [tab, setTab] = useState<"uebersicht" | "verlauf">("uebersicht");
  const [erhoben, setErhoben] = useState(tagKey(c.erhoben));
  const [bis, setBis] = useState(tagKey(c.antwortBis));
  const fehlt = m.ch.filter((x) => !x.bereit);
  const bereit = m.ch.filter((x) => x.bereit);
  const quelle = c.eintraege.find((e) => e.art !== "planaenderung" || e.quelle_typ !== "email") ?? c.eintraege[0];
  const arten = [...new Set(c.eintraege.slice(0, 4).map((e) => (istAudio(e.quelle_anhang_pfad) ? "Sprachnachricht" : istFoto(e.quelle_anhang_pfad) ? "Foto" : e.quelle_typ === "email" ? "Mail" : e.quelle_typ === "call" ? "Anruf" : "Nachricht")))];
  const planDatei = c.plan ? m.d.quellen.find((q) => q.content_hash === c.plan?.quelle_hash && q.anhang_pfad)?.anhang_pfad : null;
  const gemeldetIndex = c.eintraege.find((e) => e.plan_index && e.plan_index !== c.plan?.plan_index)?.plan_index;

  return (
    <div className="grid h-full grid-cols-[320px_minmax(0,1fr)]">
      <aside className="overflow-y-auto border-r border-[var(--line)]">
        <button onClick={() => nav.aenderung(null)} className="flex w-full items-center gap-2 border-b border-[var(--line)] px-7 py-5 text-[15px]">
          <I.ChevronLeft className="size-4" /> <span className="underline underline-offset-4">Zurück zu Änderungen</span>
        </button>
        {[
          { titel: "Fehlende Infos", items: fehlt },
          { titel: "Bereit zur Prüfung", items: bereit },
        ].map(({ titel, items }) =>
          items.length ? (
            <div key={titel} className="px-4 pt-6">
              <div className="px-3 pb-2 text-[15px] text-[rgba(12,10,8,.6)]">{titel}</div>
              {items.map((x) => (
                <button key={x.key} onClick={() => nav.aenderung(x.key)} className={`flex w-full items-center gap-3 rounded-[6px] px-3 py-3 text-left ${x.key === c.key ? "bg-[#f1efec]" : "hover:bg-[var(--wash)]"}`}>
                  <Kuerzel size={34}>{x.kuerzel}</Kuerzel>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px]">{x.titel}</span>
                    <span className="block truncate text-[13px] text-[rgba(12,10,8,.55)]">{x.bereit ? eur(x.schaetzung?.betrag ?? 0) : x.fehlend[0]}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null,
        )}
      </aside>

      <div className="overflow-y-auto">
        <div className="px-14 pt-9">
          <div className="text-[15px] text-[rgba(12,10,8,.6)]">
            {c.bereit ? "Bereit" : "Entwurf"} · {c.nr}
          </div>
          <div className="mt-1 flex items-start justify-between gap-6">
            <h1 className="text-[40px] leading-[46px] tracking-[-0.02em]">{c.titel}</h1>
            <Btn onClick={() => setTab("verlauf")}>
              <I.Search className="size-4" /> So wurde es erkannt
            </Btn>
          </div>
          <div className="mt-6">
            <Tabs value={tab} onChange={setTab} tabs={[{ key: "uebersicht", label: "Übersicht" }, { key: "verlauf", label: "Verlauf" }]} />
          </div>
        </div>

        {tab === "uebersicht" ? (
          <div className="max-w-[820px] px-14 pb-14">
            <H2 className="mt-9">Quelle</H2>
            <Card className="mt-3 flex items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-4">
                {m.projektFoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={anhangUrl(m.projektFoto)} alt="" className="h-11 w-11 rounded-full object-cover" />
                ) : (
                  <Kuerzel size={44}>BV</Kuerzel>
                )}
                <div>
                  <div className="text-[17px]">{m.d.projekt.name ?? m.d.projekt.projekt}</div>
                  <div className="text-[14px] text-[rgba(12,10,8,.6)]">
                    {arten.join(" und ")} von {c.von.vorname} · {tagZeit(quelle?.zeitpunkt ?? c.erhoben)}
                  </div>
                </div>
              </div>
              {quelle && (
                <button onClick={() => nav.thread(quelle.quelle_hash)} className="text-[15px] underline underline-offset-4">
                  Verlauf ansehen
                </button>
              )}
            </Card>

            <H2 className="mt-10">Änderungsdetails</H2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Feld label="Erhoben" pflicht icon={<I.Calendar className="text-[rgba(12,10,8,.6)]" />}>
                <input type="date" value={erhoben} onChange={(e) => setErhoben(e.target.value)} className="bg-transparent outline-none" />
              </Feld>
              <Feld label="Antwort bis" pflicht icon={<I.Calendar className="text-[rgba(12,10,8,.6)]" />}>
                <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} className="bg-transparent outline-none" />
              </Feld>
            </div>
            <div className="mt-3 text-[14px] text-[rgba(12,10,8,.6)]">
              {c.plan ? (
                <>
                  Plan ist <span className="text-[var(--text)]">{c.plan.plan_nr} Index {c.plan.plan_index}</span>
                  {gemeldetIndex && <span className="text-[#a63a2b]"> · gearbeitet nach Index {gemeldetIndex}</span>}{" "}
                  {planDatei && (
                    <a href={anhangUrl(planDatei)} target="_blank" rel="noreferrer" className="text-[var(--text)] underline underline-offset-4">
                      Plan öffnen
                    </a>
                  )}
                </>
              ) : (
                "Kein Plan zugeordnet"
              )}
            </div>
            <div className="mt-3 space-y-3">
              <Feld label="Beschreibung">{c.beschreibung}</Feld>
              <Feld label="Schätzung">
                {c.schaetzung ? (
                  <>
                    {eur(c.schaetzung.betrag)} <span className="text-[13px] text-[rgba(12,10,8,.55)]">· {c.schaetzung.grundlage}</span>
                  </>
                ) : (
                  <span className="text-[rgba(12,10,8,.5)]">Preis fehlt</span>
                )}
              </Feld>
              <Feld label="Freigabe">
                {c.freigabe ? (
                  <span className="flex items-center gap-2">
                    <I.Check className="size-4 text-[#2f6b40]" /> {c.freigabe.von.name} {c.freigabe.wie} · {tagZeit(c.freigabe.zeit)}
                  </span>
                ) : c.art === "wartezeit" ? (
                  <span className="text-[rgba(12,10,8,.6)]">Regiebericht an den Generalunternehmer</span>
                ) : (
                  <button onClick={() => nav.entwurf(c)} className="underline underline-offset-4">
                    Schriftlich anfordern
                  </button>
                )}
              </Feld>
            </div>

            {c.fehlend.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {c.fehlend.map((f) => (
                  <Pill key={f} ton={f === "Abweichung offen" ? "rot" : f === "Preis fehlt" ? "amber" : "orange"}>
                    {f}
                  </Pill>
                ))}
              </div>
            )}

            {c.signale.length > 0 && <H2 className="mt-10">Klärung vor Ort</H2>}
            {c.signale.map((s) => (
              <div key={s.id}>
                <Card className="mt-3 p-5">
                  <div className="text-[15px]">{s.titel}</div>
                  <div className="mt-4 flex gap-1.5">
                    {(["offen", "in_bearbeitung", "geloest"] as const).map((k, i) => {
                      const idx = ["offen", "in_bearbeitung", "geloest"].indexOf(s.status);
                      return (
                        <div key={k} className="flex-1">
                          <div className={`h-1 rounded ${i <= idx ? "bg-[var(--accent)]" : "bg-[#ebe8e5]"}`} />
                          <div className={`mt-1.5 text-[12px] ${i <= idx ? "" : "text-[rgba(12,10,8,.45)]"}`}>{k === "offen" ? "Erkannt" : k === "in_bearbeitung" ? "Vorarbeiter angerufen" : "Gelöst"}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-[14px]">
                    <Avatar p={m.pers(s.zustaendig)} size={24} /> {s.zustaendig ?? "–"}
                    <span className="text-[rgba(12,10,8,.5)]">· {s.angerufen_am ? `angerufen ${tagZeit(s.angerufen_am)}` : s.status === "geloest" ? "erledigt" : "Anruf folgt"}</span>
                  </div>
                  {s.anruf_text && <div className="mt-3 rounded-[4px] bg-[#f4f2f0] p-3 text-[14px] italic leading-relaxed">„{s.anruf_text}“</div>}
                </Card>
              </div>
            ))}

            <div className="mt-10 flex gap-2">
              <Btn primary onClick={() => nav.entwurf(c)}>
                An Bauherr senden
              </Btn>
              <Btn onClick={() => nav.fragen(`Was ist der Stand bei ${c.titel}${c.top ? ` in ${c.top}` : ""}?`)}>
                <I.Sparkle className="size-4" /> SiteTwin fragen
              </Btn>
            </div>
          </div>
        ) : (
          <div className="max-w-[900px] px-14 pb-14 pt-8">
            <Erkennung c={c} m={m} />
            <H2 className="mt-10">Aktivität</H2>
            <div className="mt-3">
              {[
                ...m.d.verlauf.filter((v) => c.signale.some((s) => s.id === v.signal_id)).map((v) => ({ t: v.zeitpunkt, titel: `Klärung: ${v.status === "offen" ? "erkannt" : v.status === "in_bearbeitung" ? "Vorarbeiter angerufen" : "gelöst"}`, e: null })),
                ...c.eintraege.map((e) => ({ t: e.zeitpunkt ?? "", titel: e.zusammenfassung, e })),
              ]
                .sort((a, b) => ts(b.t) - ts(a.t))
                .map((r, i) => (
                  <div key={i} className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 border-b border-[var(--line)] py-3.5 text-[14px]">
                    <span className="mono text-[11px] text-[rgba(12,10,8,.5)]">{tagKurz(r.t)} {zeit(r.t)}</span>
                    <div>
                      <div>{r.titel}</div>
                      {r.e && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <QuelleChip typ={r.e.quelle_typ} foto={istFoto(r.e.quelle_anhang_pfad)} audio={istAudio(r.e.quelle_anhang_pfad)}>
                            {m.pers(r.e.person).vorname}
                          </QuelleChip>
                          <button onClick={() => nav.nachricht(r.e!.quelle_hash)} className="text-[12px] text-[rgba(12,10,8,.55)] underline underline-offset-2">
                            Nachricht
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
