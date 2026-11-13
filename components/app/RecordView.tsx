"use client";

import { useState } from "react";
import type { Eintrag } from "@/lib/twin-model";
import { alterLabel, alterTon, gewerkLabel, istAudio, istFoto, tagKey, type Ton } from "@/lib/vm";
import type { Modell, Nav } from "./modell";
import { Avatar, Card, PageHead, Pill, QuelleChip, Tabs, tagLang, tagZeit, zeit } from "./ui";

type Tab = "protokoll" | "anfragen" | "geprueft";

/** Talona's tag palette for record entries. */
export function tagFuer(e: Eintrag): { label: string; ton: Ton } {
  switch (e.art) {
    case "lieferung":
      return { label: "Lieferung", ton: "blau" };
    case "arbeit_erledigt":
      return { label: "Erledigt gemeldet", ton: "amber" };
    case "problem_behoben":
      return { label: "Behoben", ton: "amber" };
    case "abnahme":
      return { label: "Geprüft", ton: "gruen" };
    case "bestaetigung":
      return { label: "Bestätigt", ton: "gruen" };
    case "behinderung":
      return { label: "Behinderung", ton: "rot" };
    case "planaenderung":
      return { label: "Planänderung", ton: "orange" };
    case "soll_aenderung":
      return { label: "Änderung", ton: "orange" };
    case "frage":
      return { label: "Anfrage", ton: "grau" };
    case "anweisung":
      return { label: "Anweisung", ton: "grau" };
    case "arbeit_geplant":
      return { label: "Geplant", ton: "grau" };
    default:
      return { label: "Notiz", ton: "grau" };
  }
}

export function RecordView({ m, nav, neu }: { m: Modell; nav: Nav; neu: Set<string> }) {
  const [tab, setTab] = useState<Tab>("protokoll");
  const offen = m.req.filter((r) => !r.beantwortet).length;
  const pruefen = m.leist.filter((l) => l.pruefenVor).length;
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-12 pt-10">
        <PageHead title="Protokoll" eyebrow={`${m.d.projekt.name ?? m.d.projekt.projekt} · ${m.d.eintraege.length} Einträge aus ${m.msgs.length} Nachrichten`} />
        <div className="mt-8">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { key: "protokoll", label: "Protokoll" },
              { key: "anfragen", label: `Anfragen${offen ? ` · ${offen}` : ""}` },
              { key: "geprueft", label: `Erledigt vs. geprüft${pruefen ? ` · ${pruefen}` : ""}` },
            ]}
          />
        </div>
      </div>
      <div className="px-12 pb-12 pt-6">
        {tab === "protokoll" && <Protokoll m={m} nav={nav} neu={neu} />}
        {tab === "anfragen" && <Anfragen m={m} nav={nav} />}
        {tab === "geprueft" && <Geprueft m={m} nav={nav} />}
      </div>
    </div>
  );
}

function Protokoll({ m, nav, neu }: { m: Modell; nav: Nav; neu: Set<string> }) {
  const liste = m.d.eintraege.filter((e) => e.zeitpunkt && (e.art !== "sonstiges" || e.top));
  const tage = [...new Set(liste.map((e) => tagKey(e.zeitpunkt)))].sort().reverse();
  return (
    <div className="max-w-[920px] space-y-5">
      {tage.map((t) => {
        const items = liste.filter((e) => tagKey(e.zeitpunkt) === t).sort((a, b) => (a.zeitpunkt ?? "").localeCompare(b.zeitpunkt ?? ""));
        return (
          <Card key={t} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
              <span className="text-[17px]">{tagLang(items[0].zeitpunkt)}</span>
              <Pill>
                {items.length} {items.length === 1 ? "Eintrag" : "Einträge"}
              </Pill>
            </div>
            {items.map((e) => {
              const tag = tagFuer(e);
              return (
                <button
                  key={e.id}
                  onClick={() => nav.nachricht(e.quelle_hash)}
                  className={`grid w-full grid-cols-[64px_minmax(0,1fr)_auto] items-start gap-4 border-b border-[var(--line)] px-6 py-3.5 text-left last:border-0 hover:bg-[var(--wash)] ${neu.has(e.id) ? "flash" : ""}`}
                >
                  <span className="mono pt-0.5 text-[11px] text-[rgba(12,10,8,.6)]">{zeit(e.zeitpunkt)}</span>
                  <span className="min-w-0">
                    <span className="block text-[15px] leading-snug">{e.zusammenfassung}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-[rgba(12,10,8,.55)]">
                      {[e.top, e.raum].filter(Boolean).join(" · ") || "Baustelle"} · {gewerkLabel(e.gewerk)}
                      <QuelleChip typ={e.quelle_typ} foto={istFoto(e.quelle_anhang_pfad)} audio={istAudio(e.quelle_anhang_pfad)}>
                        {m.pers(e.person).vorname}
                      </QuelleChip>
                    </span>
                  </span>
                  <Pill ton={tag.ton}>{tag.label}</Pill>
                </button>
              );
            })}
          </Card>
        );
      })}
    </div>
  );
}

function Anfragen({ m, nav }: { m: Modell; nav: Nav }) {
  const offen = m.req.filter((r) => !r.beantwortet);
  const erledigt = m.req.filter((r) => r.beantwortet);
  return (
    <div className="max-w-[760px]">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <span className="text-[17px]">Worauf Sie warten</span>
          <Pill>{offen.length} offen</Pill>
        </div>
        {offen.map((r) => (
          <button key={r.id} onClick={() => nav.nachricht(r.eintrag.quelle_hash)} className="flex w-full items-center gap-4 border-b border-[var(--line)] px-6 py-4 text-left last:border-0 hover:bg-[var(--wash)]">
            <Avatar p={r.gefragtVon} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]">{r.titel}</span>
              <span className="text-[13px] text-[rgba(12,10,8,.55)]">Angefragt von {r.gefragtVon.name}</span>
            </span>
            <Pill ton={alterTon(r.alterTage)}>{alterLabel(r.alterTage, r.seit, m.jetzt)}</Pill>
          </button>
        ))}
        {!offen.length && <div className="px-6 py-6 text-[14px] text-[rgba(12,10,8,.55)]">Nichts offen.</div>}
      </Card>
      {erledigt.length > 0 && (
        <>
          <div className="mt-8 text-[15px] text-[rgba(12,10,8,.6)]">Beantwortet</div>
          <Card className="mt-2 overflow-hidden">
            {erledigt.map((r) => (
              <button key={r.id} onClick={() => nav.nachricht(r.beantwortet!.quelle_hash)} className="flex w-full items-center gap-4 border-b border-[var(--line)] px-6 py-3.5 text-left last:border-0 hover:bg-[var(--wash)]">
                <Avatar p={r.gefragtVon} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{r.titel}</span>
                  <span className="block truncate text-[12px] text-[rgba(12,10,8,.55)]">
                    {m.pers(r.beantwortet!.person).vorname}: {r.beantwortet!.zusammenfassung}
                  </span>
                </span>
                <Pill ton="gruen">Beantwortet</Pill>
              </button>
            ))}
          </Card>
        </>
      )}
      <p className="mt-4 text-[13px] text-[rgba(12,10,8,.5)]">Anfragen werden im Gespräch erkannt und schließen sich selbst, sobald die Antwort irgendwo eintrifft.</p>
    </div>
  );
}

function Geprueft({ m, nav }: { m: Modell; nav: Nav }) {
  const tops = [...new Set(m.leist.map((l) => l.top))];
  return (
    <div className="grid max-w-[1100px] grid-cols-2 gap-5">
      {tops.map((top) => {
        const items = m.leist.filter((l) => l.top === top);
        const warn = items.find((l) => l.pruefenVor);
        return (
          <Card key={top} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
              <span className="text-[17px]">{top} · gemeldet und geprüft</span>
              <button onClick={() => nav.top(top)} className="text-[13px] underline underline-offset-2">
                Im Zwilling
              </button>
            </div>
            {warn && (
              <div className="border-b border-[var(--line)] bg-[#fff8f3] px-6 py-3 text-[13px] text-[#a4562a]">
                {m.pers(warn.pruefenVor!.person).vorname} will {tagZeit(warn.pruefenVor!.zeitpunkt)} zumachen. Vorher prüfen, sonst ist es hinter der Platte.
              </div>
            )}
            {items.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-6 py-3.5 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-[15px]">{l.titel}</div>
                  <div className="text-[13px] text-[rgba(12,10,8,.55)]">
                    {l.gemeldet.von.name} · {tagZeit(l.gemeldet.zeit)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {l.pruefenVor && <Pill ton="orange">Vorher prüfen</Pill>}
                  {l.geprueft ? <Pill ton="gruen">✓ Geprüft · {l.geprueft.von.vorname}</Pill> : <Pill ton="amber">Erledigt gemeldet</Pill>}
                </div>
              </div>
            ))}
          </Card>
        );
      })}
    </div>
  );
}
