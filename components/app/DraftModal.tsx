"use client";

import { useState } from "react";
import { istAudio, istFoto, type Aenderung } from "@/lib/vm";
import type { Modell } from "./modell";
import { Btn, eur, I, Pill, QuelleChip, tagLang, tagZeit } from "./ui";

/**
 * Talona's drafts: the confirmation is written from the record, a person sends it.
 * Amounts stay as estimated or blank; nothing is sent from here except via the user's mail app.
 */
export function DraftModal({ m, c, onClose }: { m: Modell; c: Aenderung; onClose: () => void }) {
  const auftraggeber = c.imAuftrag?.name ?? c.von.name;
  const betreff = `${m.d.projekt.projekt} · ${c.top ?? ""} · Bestätigung einer Änderung (${c.nr})`.replace(" ·  ·", " ·");
  const start = [
    `Sehr geehrte Damen und Herren,`,
    ``,
    `hiermit bestätigen wir die Anordnung vom ${tagLang(c.erhoben)}${c.imAuftrag ? ` (${auftraggeber}, übermittelt von ${c.von.name})` : ` durch ${c.von.name}`}:`,
    ``,
    `${c.titel}${c.ort ? `, ${c.ort}` : ""}.`,
    c.beschreibung,
    c.plan ? `Grundlage ist Plan ${c.plan.plan_nr} Index ${c.plan.plan_index}.` : ``,
    ``,
    `Kosten der Änderung: ${c.schaetzung ? `${eur(c.schaetzung.betrag)} netto (${c.schaetzung.grundlage})` : "[Preis bitte ergänzen]"}`,
    `Auswirkung auf den Termin: [Tage bitte ergänzen]`,
    ``,
    `Wir bitten um schriftliche Freigabe bis ${tagLang(c.antwortBis).replace(/\.$/, "")}.`,
    ``,
    `Mit freundlichen Grüßen`,
    `${m.digest.empfaenger.name}, ${m.digest.empfaenger.firma ?? ""}`.replace(/, $/, ""),
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  const [text, setText] = useState(start);
  const [kopiert, setKopiert] = useState(false);

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[rgba(12,10,8,.25)] py-12" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[760px] overflow-hidden rounded-[8px] border border-[var(--line)] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[var(--line)] px-7 py-5">
          <div>
            <div className="text-[13px] text-[rgba(12,10,8,.55)]">Bestätigung einer Änderung</div>
            <div className="mt-0.5 flex items-center gap-2 text-[22px] tracking-[-0.01em]">
              {c.titel} <Pill ton="amber">Entwurf</Pill>
            </div>
            <div className="mt-1 text-[14px] text-[rgba(12,10,8,.6)]">An {m.bauherr}, Bauherr · über {m.digest.empfaenger.firma ?? "die Bauleitung"}</div>
          </div>
          <button onClick={onClose} aria-label="Schließen" className="text-[rgba(12,10,8,.55)] hover:text-[var(--text)]">
            <I.X />
          </button>
        </div>
        <div className="px-7 py-5">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} className="w-full resize-none rounded-[4px] border border-[var(--line)] p-4 text-[15px] leading-relaxed outline-none focus:border-[rgba(12,10,8,.35)]" />
          <div className="mt-4 grid grid-cols-[140px_1fr] gap-y-3 text-[14px]">
            <span className="text-[rgba(12,10,8,.55)]">Geschrieben, weil</span>
            <span>{c.fehlend.length ? c.fehlend.join(", ") : "Änderung ist bewertet und bereit für den Bauherrn"}</span>
            <span className="text-[rgba(12,10,8,.55)]">Aus dem Protokoll</span>
            <span className="flex flex-wrap gap-1.5">
              {c.eintraege.slice(0, 6).map((e) => (
                <QuelleChip key={e.id} typ={e.quelle_typ} foto={istFoto(e.quelle_anhang_pfad)} audio={istAudio(e.quelle_anhang_pfad)}>
                  {m.pers(e.person).vorname} · {tagZeit(e.zeitpunkt)}
                </QuelleChip>
              ))}
            </span>
            <span className="text-[rgba(12,10,8,.55)]">Wird gesendet von</span>
            <span>Ihnen, aus Ihrem eigenen Mailprogramm. SiteTwin schreibt nur den Entwurf.</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] bg-[#faf9f7] px-7 py-4">
          <Btn
            onClick={async () => {
              await navigator.clipboard.writeText(text).catch(() => undefined);
              setKopiert(true);
            }}
          >
            {kopiert ? "Kopiert" : "Text kopieren"}
          </Btn>
          <a href={`mailto:?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`}>
            <Btn primary>In Mail öffnen</Btn>
          </a>
        </div>
      </div>
    </div>
  );
}
