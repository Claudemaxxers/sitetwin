"use client";

import { raeume } from "@/lib/twin-model";
import { istFoto, thema, type Aenderung } from "@/lib/vm";
import type { Modell } from "./modell";
import { Avatar, eur, tagKurz } from "./ui";

/**
 * Talona's analysis board from the hero demo ("Reading Rev D", "Matching…",
 * "Searching site chat…", "Checking contract", "Routed to the PM"), filled with what
 * SiteTwin actually did for this change.
 */
export function Erkennung({ c, m }: { c: Aenderung; m: Modell }) {
  const plaene = m.d.plaene.filter((p) => p.top === c.top).sort((a, b) => a.plan_index.localeCompare(b.plan_index));
  const top = m.d.tops.find((t) => t.top === c.top);
  const rooms = top ? raeume(top) : [];
  const thema0 = c.key.split("|")[1];
  const andere = m.ch.filter((x) => x.key !== c.key).slice(0, 3);
  const chat = m.msgs.filter((n) => n.typ === "whatsapp" && n.text).slice(0, 40);
  const treffer = new Set(c.eintraege.map((e) => e.quelle_hash));
  const chatListe = [...chat.filter((n) => treffer.has(n.hash)).slice(0, 2), ...chat.filter((n) => !treffer.has(n.hash)).slice(0, 3)].sort(() => 0);
  const lv = [...new Set(c.eintraege.map((e) => e.lv_pos_nr).filter(Boolean))].map((nr) => m.d.lv.find((p) => p.pos_nr === nr)).filter(Boolean);
  const signal = c.signale[0];
  const an = signal ? m.pers(signal.zustaendig) : m.digest.empfaenger;

  return (
    <div className="tw-board relative h-[580px] overflow-hidden rounded-[8px] bg-[#f1efec]">
      {/* tablet with the unit's plan */}
      <div className="tw-step absolute left-1/2 top-[120px] w-[280px] -translate-x-1/2 rounded-[22px] border border-[#d9d4ce] bg-white p-3 shadow-[0_10px_30px_rgba(12,10,8,.08)]" style={{ animationDelay: "0ms" }}>
        <div className="flex items-center justify-between px-1 pb-2 text-[11px]">
          <span>
            {c.plan?.plan_nr ?? "Plan"} · {c.top ?? "Baustelle"}
          </span>
          {c.plan && <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] text-white">Index {c.plan.plan_index}</span>}
        </div>
        <div className="grid h-[190px] grid-cols-3 gap-[3px] border-[3px] border-[#1f1c19] bg-[#1f1c19]">
          {[...(rooms.length ? rooms : ["Raum"]).slice(0, 9), ...Array(Math.max(0, 9 - Math.min(9, rooms.length || 1))).fill("")].map((r, i) => {
            if (!r) return <div key={`leer${i}`} className="bg-white" />;
            const hit = c.raum && c.raum.toLowerCase().includes(r.toLowerCase());
            return (
              <div key={r} className={`relative flex items-end p-1 text-[8px] uppercase tracking-wide ${hit ? "bg-[#fff4ec]" : "bg-white"}`}>
                {hit && <span className="tw-cloud absolute inset-1 rounded-[10px] border-2 border-dashed border-[var(--accent)]" />}
                <span className={hit ? "text-[var(--accent)]" : "text-[#6e6a68]"}>{r}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-2 rounded-[6px] border border-[var(--line)] px-2 py-1.5 text-[11px]">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-[#fbe6d8] text-[10px] text-[#b45624]">{c.plan?.plan_index ?? "!"}</span>
          <span className="min-w-0 flex-1 truncate">{c.titel}</span>
          {plaene.length > 1 && (
            <span className="rounded-full border border-[var(--line)] px-1.5 text-[10px]">
              {plaene[plaene.length - 2].plan_index} ↔ {plaene[plaene.length - 1].plan_index}
            </span>
          )}
        </div>
      </div>

      <Karte titel={c.plan ? `Plan gelesen · Index ${c.plan.plan_index}` : "Plan gesucht"} style={{ left: 24, top: 24, width: 230 }} delay={300}>
        {plaene.length ? (
          <div className="mono space-y-1 text-[10px]">
            {plaene.map((p) => (
              <div key={p.plan_index} className={`flex justify-between ${p.plan_index === c.plan?.plan_index ? "text-[var(--text)]" : "text-[rgba(12,10,8,.55)]"}`}>
                <span>
                  {p.plan_index} {p.plan_nr}
                </span>
                <span>{p.gueltig_ab ? tagKurz(p.gueltig_ab) : "–"}</span>
              </div>
            ))}
            {c.plan?.aenderung && <div className="pt-1 font-sans text-[11px] leading-snug text-[rgba(12,10,8,.7)]">{c.plan.aenderung}</div>}
          </div>
        ) : (
          <div className="text-[11px] text-[rgba(12,10,8,.55)]">Für {c.top ?? "diesen Ort"} liegt kein Plan vor.</div>
        )}
      </Karte>

      <Karte titel="Abgleich…" style={{ right: 24, top: 24, width: 220 }} delay={700}>
        {[c, ...andere].slice(0, 4).map((x, i) => (
          <div key={x.key} className="mb-2">
            <div className="truncate text-[11px]">{x.ort || x.titel}</div>
            <div className="mt-1 h-1 rounded bg-[#ebe8e5]">
              <div className={`h-1 rounded ${i === 0 ? "bg-[#5683d2]" : "bg-[#d2cecb]"}`} style={{ width: i === 0 ? "70%" : `${30 + i * 12}%` }} />
            </div>
          </div>
        ))}
      </Karte>

      <Karte titel="Baustellen-Chat durchsucht…" style={{ right: 24, top: 236, width: 250 }} delay={1100}>
        {chatListe.map((n) => (
          <div key={n.hash} className={`flex items-center gap-2 py-1 text-[11px] ${treffer.has(n.hash) ? "" : "text-[rgba(12,10,8,.45)]"}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${treffer.has(n.hash) ? "bg-[#4caf6a]" : "bg-[#d2cecb]"}`} />
            <span className="truncate">
              {istFoto(n.anhang) ? "Foto" : n.typ === "call" ? "Anruf" : n.text.slice(0, 28)} · {n.person.vorname}
            </span>
          </div>
        ))}
      </Karte>

      <Karte titel="Leistungsverzeichnis geprüft" style={{ left: 24, top: 340, width: 250 }} delay={1500}>
        <div className="space-y-1 text-[11px]">
          {lv.length ? (
            lv.map((p) => (
              <div key={p!.pos_nr} className="flex justify-between gap-2">
                <span className="truncate">
                  {p!.pos_nr} {p!.kurztext}
                </span>
                <span className="text-[rgba(12,10,8,.55)]">{eur(p!.einheitspreis_eur, 0)}</span>
              </div>
            ))
          ) : (
            <div className="text-[rgba(12,10,8,.6)]">Keine LV-Position für {thema(c.eintraege[0]) ?? thema0} gefunden</div>
          )}
          <div className="border-t border-[var(--line)] pt-1">{c.schaetzung ? `Schätzung ${eur(c.schaetzung.betrag)}` : "Preis fehlt"}</div>
        </div>
      </Karte>

      <div className="tw-step absolute bottom-6 right-[180px] flex items-center gap-3 rounded-[4px] border border-[var(--line)] bg-white px-4 py-3 shadow-[0_4px_14px_rgba(12,10,8,.06)]" style={{ animationDelay: "1900ms" }}>
        <Ecken />
        <Avatar p={an} size={28} />
        <span className="mono text-[11px] uppercase tracking-[0.06em]">{signal ? `${an.vorname} angerufen` : `An ${an.rolle ?? "Bauleitung"} weitergeleitet`}</span>
      </div>
    </div>
  );
}

function Karte({ titel, children, style, delay }: { titel: string; children: React.ReactNode; style: React.CSSProperties; delay: number }) {
  return (
    <div className="tw-step absolute rounded-[2px] border border-[var(--line)] bg-white p-4 shadow-[0_4px_14px_rgba(12,10,8,.05)]" style={{ ...style, animationDelay: `${delay}ms` }}>
      <Ecken />
      <div className="mono mb-3 text-[11px] uppercase tracking-[0.06em]">{titel}</div>
      {children}
    </div>
  );
}

/** The black corner handles Talona draws around each card. */
function Ecken() {
  const s = "absolute h-1.5 w-1.5 bg-[var(--text)]";
  return (
    <>
      <span className={`${s} -left-[3px] -top-[3px]`} />
      <span className={`${s} -right-[3px] -top-[3px]`} />
      <span className={`${s} -bottom-[3px] -left-[3px]`} />
      <span className={`${s} -bottom-[3px] -right-[3px]`} />
    </>
  );
}
