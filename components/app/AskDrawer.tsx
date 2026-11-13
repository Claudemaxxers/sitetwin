"use client";

import { useEffect, useRef, useState } from "react";
import { istAudio, istFoto } from "@/lib/vm";
import type { Modell, Nav } from "./modell";
import { I, Logo, QuelleChip, tagZeit } from "./ui";

interface Turn {
  frage: string;
  antwort?: string;
  quellen?: string[];
  engine?: string;
  fehler?: boolean;
}

/** Talona's "Ask Talona": ask the job anything, the answer shows who said it and when. */
export function AskDrawer({ m, start, nav, onClose }: { m: Modell; start: string; nav: Nav; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState(start);
  const ende = useRef<HTMLDivElement>(null);
  const vorschlaege = [
    m.ch[0]?.top ? `Was ist offen in ${m.ch[0].top}?` : "Was ist offen?",
    "Worauf warten wir gerade?",
    `Was hat ${m.msgs[0]?.person.vorname ?? "Stefan"} diese Woche gesagt?`,
    "Welche Änderungen sind noch nicht freigegeben?",
  ];

  const fragen = async (frage: string) => {
    if (!frage.trim()) return;
    setQ("");
    setTurns((t) => [...t, { frage }]);
    try {
      const res = await fetch("/api/fragen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projekt: m.d.projekt.projekt, frage }) });
      const j = await res.json();
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, antwort: j.antwort ?? "Keine Antwort.", quellen: j.quellen ?? [], engine: j.engine } : x)));
    } catch {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, antwort: "Keine Verbindung.", fehler: true } : x)));
    }
  };

  useEffect(() => {
    if (start) fragen(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    ende.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-[rgba(12,10,8,.18)]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-[480px] flex-col border-l border-[var(--line)] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f4f2f0]">
              <Logo size={18} />
            </span>
            <div>
              <div className="text-[16px]">SiteTwin fragen</div>
              <div className="text-[12px] text-[rgba(12,10,8,.55)]">Antwortet nur aus dem Protokoll, mit Quellen</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Schließen" className="text-[rgba(12,10,8,.55)] hover:text-[var(--text)]">
            <I.X />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-[#faf9f7] px-5 py-5">
          {!turns.length && (
            <div>
              <div className="text-[14px] text-[rgba(12,10,8,.6)]">Fragen Sie so, wie Sie Ihren Polier fragen würden.</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {vorschlaege.map((v) => (
                  <button key={v} onClick={() => fragen(v)} className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[13px] hover:border-[rgba(12,10,8,.35)]">
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <div className="ml-auto w-fit max-w-[85%] rounded-[10px] bg-[#dcf2d6] px-3.5 py-2 text-[14px]">{t.frage}</div>
              <div className="max-w-[92%] rounded-[10px] bg-white px-3.5 py-3 text-[14px] leading-relaxed shadow-[0_1px_2px_rgba(12,10,8,.06)]">
                {t.antwort ?? <span className="text-[rgba(12,10,8,.5)]">Liest das Protokoll…</span>}
                {!!t.quellen?.length && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-2.5">
                    {t.quellen.map((id) => {
                      const e = m.d.eintraege.find((x) => x.id === id);
                      if (!e) return null;
                      return (
                        <button key={id} onClick={() => nav.nachricht(e.quelle_hash)}>
                          <QuelleChip typ={e.quelle_typ} foto={istFoto(e.quelle_anhang_pfad)} audio={istAudio(e.quelle_anhang_pfad)}>
                            {m.pers(e.person).vorname} · {tagZeit(e.zeitpunkt)}
                          </QuelleChip>
                        </button>
                      );
                    })}
                  </div>
                )}
                {t.engine === "suche" && <div className="mt-2 text-[11px] text-[rgba(12,10,8,.45)]">Suche im Protokoll (kein Claude-Schlüssel gesetzt)</div>}
              </div>
            </div>
          ))}
          <div ref={ende} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            fragen(q);
          }}
          className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-3"
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Frage zur Baustelle…" className="h-10 flex-1 rounded-full border border-[var(--line)] px-4 text-[14px] outline-none focus:border-[rgba(12,10,8,.35)]" />
          <button type="submit" className="h-10 rounded-full bg-[var(--accent)] px-4 text-[14px] text-white">
            Fragen
          </button>
        </form>
      </div>
    </div>
  );
}
