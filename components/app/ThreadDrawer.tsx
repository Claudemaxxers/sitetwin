"use client";

import { useEffect } from "react";
import { istAudio, istFoto, tagKey } from "@/lib/vm";
import { Sprachnachricht } from "./InboxView";
import { anhangUrl, type Modell } from "./modell";
import { Avatar, I, tagLang, zeit } from "./ui";

const NAMENSFARBEN = ["#3b63a8", "#2f7a46", "#b5521f", "#8a4fa8", "#a63a2b", "#1f7a7a"];

/** "See thread": the source conversation, shown like the phone in Talona's demo. */
export function ThreadDrawer({ m, hash, onClose }: { m: Modell; hash: string; onClose: () => void }) {
  const ziel = m.d.quellen.find((q) => q.content_hash === hash) ?? null;
  const typ = ziel?.typ ?? m.msgs.find((n) => n.hash === hash)?.typ ?? "whatsapp";
  const verlauf = m.d.quellen
    .filter((q) => q.typ === typ && q.zeitpunkt && (typ !== "whatsapp" || q.kanal === ziel?.kanal) && (typ !== "email" || !q.anhang_pfad))
    .sort((a, b) => (a.zeitpunkt ?? "").localeCompare(b.zeitpunkt ?? ""));
  const mitglieder = [...new Set(verlauf.map((q) => m.pers(q.absender).vorname))];

  useEffect(() => {
    document.getElementById(`q-${hash}`)?.scrollIntoView({ block: "center" });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [hash, onClose]);

  let letzterTag = "";
  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-[rgba(12,10,8,.18)]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="m-4 flex w-[420px] flex-col overflow-hidden rounded-[34px] border-[6px] border-[#1f1c19] bg-[#f4f2ef] shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-3 text-[13px]">
          <span>{zeit(Date.now())}</span>
          <span className="h-5 w-24 rounded-full bg-[#1f1c19]" />
          <button onClick={onClose} aria-label="Schließen">
            <I.X className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-3 border-b border-[var(--line)] bg-white px-4 py-3">
          <button onClick={onClose} className="flex items-center text-[#2f7a46]" aria-label="Zurück">
            <I.ChevronLeft className="size-5" />
          </button>
          {m.projektFoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={anhangUrl(m.projektFoto)} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span className="h-10 w-10 rounded-full bg-[#d2cecb]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px]">{typ === "whatsapp" ? ziel?.kanal ?? "Baustellen-Gruppe" : typ === "email" ? "Mails zum Projekt" : "Anruf"}</div>
            <div className="truncate text-[12px] text-[rgba(12,10,8,.55)]">{[...mitglieder, "SiteTwin"].join(", ")}</div>
          </div>
          {typ === "whatsapp" && <I.Phone className="size-5 text-[#2f7a46]" />}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {verlauf.map((q) => {
            const tag = tagKey(q.zeitpunkt);
            const neuerTag = tag !== letzterTag;
            letzterTag = tag;
            const p = m.pers(q.absender);
            const farbe = NAMENSFARBEN[[...p.name].reduce((a, c) => a + c.charCodeAt(0), 0) % NAMENSFARBEN.length];
            const markiert = q.content_hash === hash;
            const betreff = q.text.match(/Betreff:\s*(.+)/)?.[1];
            return (
              <div key={q.content_hash}>
                {neuerTag && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-[6px] bg-white px-3 py-1 text-[11px] uppercase tracking-wide text-[rgba(12,10,8,.55)] shadow-sm">{tagLang(q.zeitpunkt)}</span>
                  </div>
                )}
                <div id={`q-${q.content_hash}`} className={`max-w-[88%] rounded-[10px] bg-white px-3 py-2 shadow-[0_1px_1px_rgba(12,10,8,.08)] ${markiert ? "ring-2 ring-[var(--accent)]" : ""}`}>
                  <div className="mb-0.5 flex items-center gap-2 text-[13px]" style={{ color: farbe }}>
                    {typ !== "whatsapp" && <Avatar p={p} size={18} />}
                    {p.name}
                  </div>
                  {istFoto(q.anhang_pfad) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={anhangUrl(q.anhang_pfad!)} alt="" className="mb-1 max-h-48 w-full rounded-[6px] object-cover" />
                  )}
                  {istAudio(q.anhang_pfad) && <Sprachnachricht pfad={q.anhang_pfad!} klein />}
                  {betreff && <div className="text-[13px]">{betreff}</div>}
                  {q.text && !istAudio(q.anhang_pfad) && <div className="whitespace-pre-line text-[14px] leading-snug">{(betreff ? q.text.replace(/Betreff:.*\n?/, "") : q.text).trim().slice(0, typ === "whatsapp" ? 600 : 420)}</div>}
                  {q.text && istAudio(q.anhang_pfad) && <div className="mt-1 text-[12px] italic text-[rgba(12,10,8,.6)]">Transkript: {q.text.slice(0, 280)}</div>}
                  <div className="mt-0.5 text-right text-[11px] text-[rgba(12,10,8,.45)]">{zeit(q.zeitpunkt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
