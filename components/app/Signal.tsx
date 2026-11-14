"use client";

import { SIGNAL_ART_LABEL, type Signal } from "@/lib/twin-model";
import { signalStand } from "@/lib/vm";
import type { Modell, Nav } from "./modell";
import { Avatar, Card, I, Pill, tagZeit } from "./ui";

/**
 * One way to show a signal everywhere (KONZEPT.md, Lebenszyklus eines Signals):
 * detected → foreman called (in Bearbeitung) → solved. Every signal triggers the call.
 */
export function SignalPill({ s }: { s: Signal }) {
  const st = signalStand(s);
  return <Pill ton={st.ton}>{st.label}</Pill>;
}

export function anrufZeile(s: Signal) {
  if (s.status === "geloest") return s.geloest_am ? `gelöst ${tagZeit(s.geloest_am)}` : "gelöst";
  return s.angerufen_am ? `angerufen ${tagZeit(s.angerufen_am)}` : "Anruf ausgelöst";
}

export function SignalSchritte({ s, m }: { s: Signal; m: Modell }) {
  const st = signalStand(s);
  const p = m.pers(s.zustaendig);
  return (
    <div>
      <div className="flex gap-1.5">
        {["Erkannt", "Vorarbeiter angerufen", "Gelöst"].map((label, i) => (
          <div key={label} className="flex-1">
            <div className={`h-1 rounded ${i < st.schritt ? "bg-[var(--accent)]" : i === st.schritt ? (st.aktiv ? "tw-pulse bg-[#5683d2]" : "bg-[#6FA77F]") : "bg-[#ebe8e5]"}`} />
            <div className={`mt-1.5 text-[12px] ${i <= st.schritt ? "" : "text-[rgba(12,10,8,.45)]"}`}>{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 text-[14px]">
        <I.Phone className="size-4 text-[rgba(12,10,8,.55)]" />
        <Avatar p={p} size={22} />
        {p.name}
        <span className="text-[rgba(12,10,8,.5)]">
          · {p.rolle ?? "Vorarbeiter"} · {anrufZeile(s)}
        </span>
      </div>
      {s.anruf_text && <div className="mt-3 rounded-[4px] bg-[#f4f2f0] p-3 text-[14px] italic leading-relaxed text-[rgba(12,10,8,.8)]">„{s.anruf_text}“</div>}
    </div>
  );
}

/** Talona-style block on top of the changes page: the deviations the checking agent found. */
export function Abweichungen({ m, nav }: { m: Modell; nav: Nav }) {
  const alle = [...m.d.signale].sort((a, b) => Number(b.status !== "geloest") - Number(a.status !== "geloest") || (b.erstellt_am ?? "").localeCompare(a.erstellt_am ?? ""));
  if (!alle.length) return null;
  const aktiv = alle.filter((s) => s.status !== "geloest");
  const zeigen = aktiv.length ? aktiv : alle.slice(0, 3);
  const oeffnen = (s: Signal) => {
    const change = m.ch.find((c) => c.signale.some((x) => x.id === s.id));
    if (change) return nav.aenderung(change.key);
    const hash = s.quelle_hashes[0] ?? m.d.eintraege.find((e) => s.eintrag_ids.includes(e.id))?.quelle_hash;
    if (hash) return nav.nachricht(hash);
    nav.zu("benachrichtigungen");
  };
  return (
    <Card className="mt-6 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
        <div className="flex items-center gap-3 text-[15px]">
          Abweichungen vom gültigen Stand
          {aktiv.length ? <Pill ton="blau">{aktiv.length} in Bearbeitung</Pill> : <Pill ton="gruen">alles geklärt</Pill>}
        </div>
        <button onClick={() => nav.zu("benachrichtigungen")} className="text-[13px] text-[rgba(12,10,8,.6)] underline underline-offset-4">
          Regeln und Anrufe
        </button>
      </div>
      {zeigen.map((s) => {
        const p = m.pers(s.zustaendig);
        return (
          <button key={s.id} onClick={() => oeffnen(s)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-6 border-b border-[var(--line)] px-6 py-4 text-left last:border-0 hover:bg-[var(--wash)]">
            <span className="min-w-0">
              <span className="block truncate text-[15px]">{s.titel}</span>
              <span className="mt-1 flex items-center gap-2 text-[13px] text-[rgba(12,10,8,.55)]">
                {SIGNAL_ART_LABEL[s.art]} · {[s.top, s.raum].filter(Boolean).join(" · ") || "Baustelle"} ·
                <Avatar p={p} size={18} /> {p.vorname} {anrufZeile(s)}
              </span>
            </span>
            <SignalPill s={s} />
          </button>
        );
      })}
      {!aktiv.length && <div className="px-6 py-3 text-[13px] text-[rgba(12,10,8,.55)]">Keine offene Abweichung. Zuletzt gelöst ist oben gelistet.</div>}
    </Card>
  );
}
