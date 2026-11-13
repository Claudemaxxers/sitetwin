"use client";

import { useState } from "react";
import { anhangUrl, type Modell, type Nav } from "./modell";
import { Avatar, Btn, Card, I, MonoLabel, PageHead, Pill, tagLang, zeit } from "./ui";

/** Talona's daily log: the day written from what the site said. Draft → approved. */
export function DailyLogView({ m, nav }: { m: Modell; nav: Nav }) {
  const [idx, setIdx] = useState(m.logs.length - 1);
  const [freigegeben, setFreigegeben] = useState<Record<string, string>>({});
  const log = m.logs[Math.max(0, Math.min(idx, m.logs.length - 1))];
  if (!log) return <div className="p-12 text-[rgba(12,10,8,.6)]">Noch keine Meldungen.</div>;
  const ok = freigegeben[log.tag];
  const leiter = m.digest.empfaenger;

  return (
    <div className="h-full overflow-y-auto px-12 py-10">
      <PageHead
        title="Bautagebuch"
        right={
          <>
            <div className="flex items-center rounded-[3px] border border-[var(--line)]">
              <button disabled={idx <= 0} onClick={() => setIdx(idx - 1)} className="px-2.5 py-2 disabled:opacity-30" aria-label="Vorheriger Tag">
                <I.ChevronLeft className="size-4" />
              </button>
              <span className="min-w-[160px] text-center text-[15px]">{tagLang(log.datum)}</span>
              <button disabled={idx >= m.logs.length - 1} onClick={() => setIdx(idx + 1)} className="px-2.5 py-2 disabled:opacity-30" aria-label="Nächster Tag">
                <I.ChevronRight className="size-4" />
              </button>
            </div>
            {ok ? (
              <Btn>
                <I.Check className="size-4" /> Freigegeben
              </Btn>
            ) : (
              <Btn primary onClick={() => setFreigegeben({ ...freigegeben, [log.tag]: new Date().toISOString() })}>
                Passt, freigeben
              </Btn>
            )}
          </>
        }
      />
      <p className="mt-2 text-[16px] text-[rgba(12,10,8,.6)]">Aus {log.anzahl} Meldungen des Tages geschrieben. Lesen, eine Zeile korrigieren, freigeben.</p>

      <Card className="mt-8 overflow-hidden">
        <div className="flex items-start justify-between border-b border-[var(--line)] px-7 py-5">
          <div>
            <div className="text-[19px]">Bautagebuch · {tagLang(log.datum)}</div>
            <div className="text-[13px] text-[rgba(12,10,8,.55)]">
              {m.d.projekt.name ?? m.d.projekt.projekt} · {leiter.name}, {leiter.rolle ?? "Bauleitung"}
            </div>
          </div>
          {ok ? <Pill ton="gruen">Freigegeben · {zeit(ok)}</Pill> : <Pill ton="amber">Entwurf</Pill>}
        </div>
        <div className="grid grid-cols-2">
          <div className="border-r border-[var(--line)] px-7 py-6">
            <MonoLabel>Arbeiten</MonoLabel>
            <div className="mt-3 space-y-4">
              {log.arbeiten.map((a) => (
                <div key={a.titel} className="flex items-start gap-3">
                  <Avatar p={a.person} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px]">{a.titel}</div>
                    <div className="text-[13px] leading-snug text-[rgba(12,10,8,.55)]">{a.text}</div>
                  </div>
                  <Pill ton={a.status.ton}>{a.status.label}</Pill>
                </div>
              ))}
              {!log.arbeiten.length && <div className="text-[14px] text-[rgba(12,10,8,.5)]">Keine Arbeiten gemeldet.</div>}
            </div>
            <MonoLabel className="mt-8">Personal laut Meldungen</MonoLabel>
            <table className="mt-3 w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] text-[rgba(12,10,8,.55)]">
                  <th className="pb-2 font-normal">Firma</th>
                  <th className="pb-2 text-right font-normal">Personen</th>
                </tr>
              </thead>
              <tbody>
                {log.personal.map((p) => (
                  <tr key={p.firma}>
                    <td className="py-1">{p.firma}</td>
                    <td className="py-1 text-right" title={p.personen.join(", ")}>
                      {p.personen.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-7 py-6">
            <MonoLabel>Fotos</MonoLabel>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {log.fotos.slice(0, 6).map((f) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={f} src={anhangUrl(f)} alt="" className="aspect-[4/3] w-full rounded-[4px] object-cover" />
              ))}
              {!log.fotos.length && <div className="col-span-3 text-[14px] text-[rgba(12,10,8,.5)]">Keine Fotos.</div>}
            </div>
            <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6">
              <Block titel="Behinderungen" list={log.behinderungen.map((e) => `${e.top ? `${e.top}: ` : ""}${e.wartet_auf ?? e.zusammenfassung}`)} />
              <Block titel="Lieferungen" list={log.lieferungen.map((e) => e.element ?? e.zusammenfassung)} />
              <Block titel="Änderungen" list={log.aenderungen.map((e) => e.zusammenfassung)} onClick={() => nav.zu("aenderungen")} />
              <Block titel="Entschieden" list={log.entscheidungen.map((e) => `${m.pers(e.person).vorname}: ${e.zusammenfassung}`)} />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Block({ titel, list, onClick }: { titel: string; list: string[]; onClick?: () => void }) {
  const unique = [...new Set(list)];
  return (
    <div>
      <MonoLabel>{titel}</MonoLabel>
      <div className="mt-2 space-y-1.5 text-[14px] leading-snug">
        {unique.slice(0, 3).map((t) => (
          <div key={t} className="line-clamp-2">
            {t}
          </div>
        ))}
        {unique.length > 3 && (
          <button onClick={onClick} className="text-[13px] text-[rgba(12,10,8,.55)] underline underline-offset-2">
            +{unique.length - 3} weitere
          </button>
        )}
        {!unique.length && <div className="text-[rgba(12,10,8,.45)]">Keine</div>}
      </div>
    </div>
  );
}
