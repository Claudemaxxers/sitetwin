"use client";

import type { Signal } from "@/lib/twin-model";
import { signalStand } from "@/lib/vm";
import type { Modell, Nav } from "./modell";
import { Avatar, I, Pill, tagZeit } from "./ui";

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

/** Where a signal leads: the change it belongs to, else the message that triggered it. */
export function oeffneSignal(s: Signal, m: Modell, nav: Nav) {
  const a = m.abw.find((x) => x.s.id === s.id);
  if (a?.change) return nav.aenderung(a.change);
  if (a?.quelle) return nav.nachricht(a.quelle);
  nav.zu("benachrichtigungen");
}
