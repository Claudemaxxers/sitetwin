"use client";

import { useState } from "react";
import { SIGNAL_ART_LABEL } from "@/lib/twin-model";
import { alterLabel, alterTon, REGELN, type Regel } from "@/lib/vm";
import type { Modell, Nav } from "./modell";
import { Avatar, Card, I, Logo, MonoLabel, PageHead, Pill, tagKurz, tagZeit, zeit } from "./ui";

/**
 * Talona's alert rules ("When someone mentions a change · If … · Alert … · Log to …")
 * plus what fired and the morning digest. Our alert is a phone call to the foreman.
 */
export function AlertsView({ m, nav }: { m: Modell; nav: Nav }) {
  const [laut, setLaut] = useState<"alles" | "wichtig">("wichtig");
  const signale = [...m.d.signale].sort((a, b) => (b.erstellt_am ?? "").localeCompare(a.erstellt_am ?? ""));
  return (
    <div className="h-full overflow-y-auto px-12 py-10">
      <PageHead
        title="Benachrichtigungen"
        right={
          <div className="flex rounded-[3px] border border-[var(--line)] p-0.5 text-[14px]">
            {(["wichtig", "alles"] as const).map((k) => (
              <button key={k} onClick={() => setLaut(k)} className={`rounded-[2px] px-3 py-1.5 ${laut === k ? "bg-[var(--text)] text-white" : "text-[rgba(12,10,8,.6)]"}`}>
                {k === "wichtig" ? "Nur Wichtiges" : "Alles"}
              </button>
            ))}
          </div>
        }
      />
      <p className="mt-2 max-w-[640px] text-[16px] text-[rgba(12,10,8,.6)]">Die Baustelle schreibt wie immer. Wenn etwas nicht zum gültigen Stand passt, ruft SiteTwin den Vorarbeiter an und trägt es in die Akte ein.</p>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)_420px] gap-8">
        <div className="space-y-5">
          {REGELN.filter((r) => laut === "alles" || r.arten[0] !== "unklar").map((r) => (
            <RegelKarte key={r.wenn} r={r} n={m.d.signale.filter((s) => r.arten.includes(s.art)).length} />
          ))}

          <div className="pt-4 text-[15px] text-[rgba(12,10,8,.6)]">Zuletzt ausgelöst</div>
          <Card className="overflow-hidden">
            {signale.map((s) => {
              const change = m.ch.find((c) => c.signale.some((x) => x.id === s.id));
              const p = m.pers(s.zustaendig);
              return (
                <button key={s.id} onClick={() => (change ? nav.aenderung(change.key) : s.top && nav.top(s.top))} className="block w-full border-b border-[var(--line)] px-6 py-5 text-left last:border-0 hover:bg-[var(--wash)]">
                  <div className="flex items-center gap-3">
                    <Pill ton={s.status === "geloest" ? "gruen" : s.status === "in_bearbeitung" ? "blau" : "orange"}>{s.status === "offen" ? "Offen" : s.status === "in_bearbeitung" ? "Beim Vorarbeiter" : "Gelöst"}</Pill>
                    <span className="text-[13px] text-[rgba(12,10,8,.55)]">
                      {SIGNAL_ART_LABEL[s.art]} · {s.schwere}
                    </span>
                    <span className="ml-auto mono text-[11px] text-[rgba(12,10,8,.5)]">{tagZeit(s.erstellt_am)}</span>
                  </div>
                  <div className="mt-2 text-[16px] leading-snug">{s.titel}</div>
                  <div className="mt-3 flex items-center gap-2 text-[14px]">
                    <I.Phone className="size-4 text-[rgba(12,10,8,.55)]" />
                    <Avatar p={p} size={22} />
                    {p.name}
                    <span className="text-[rgba(12,10,8,.5)]">· {s.angerufen_am ? `angerufen ${tagZeit(s.angerufen_am)}` : s.status === "geloest" ? `gelöst ${s.geloest_am ? tagZeit(s.geloest_am) : ""}` : "Anruf folgt"}</span>
                  </div>
                  {s.anruf_text && <div className="mt-3 rounded-[4px] bg-[#f4f2f0] p-3 text-[14px] italic leading-relaxed text-[rgba(12,10,8,.8)]">„{s.anruf_text}“</div>}
                </button>
              );
            })}
            {!signale.length && <div className="px-6 py-6 text-[14px] text-[rgba(12,10,8,.55)]">Noch nichts ausgelöst.</div>}
          </Card>
        </div>

        <div>
          <Morgen m={m} nav={nav} />
        </div>
      </div>
    </div>
  );
}

function RegelKarte({ r, n }: { r: Regel; n: number }) {
  const node = "inline-flex items-center gap-2 rounded-[4px] border border-[var(--line)] bg-white px-3 py-2 text-[14px] shadow-[0_1px_2px_rgba(12,10,8,.04)]";
  return (
    <div className="tw-dots relative rounded-[8px] bg-[#f4f2f0] px-7 py-6">
      <span className="absolute right-5 top-5 text-[12px] text-[rgba(12,10,8,.5)]">{n}× ausgelöst</span>
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[#5683d2] text-white">
          <I.Users className="size-4" />
        </span>
        <span className={node}>{r.wenn}</span>
      </div>
      <div className="ml-3.5 border-l border-[#d2cecb] pl-6 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[#ebe8e5] text-[rgba(12,10,8,.6)]">
            <I.Branch className="size-4" />
          </span>
          Wenn <span className={node}>{r.bedingung[0]}</span> ist <span className={node}>{r.bedingung[1]}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[#ebe8e5] text-[rgba(12,10,8,.6)]">
            <I.Phone className="size-4" />
          </span>
          Anrufen
          {r.anrufen.map((a, i) => (
            <span key={a.kuerzel} className="inline-flex items-center gap-2">
              {i > 0 && "+"}
              <span className={node}>
                <span className="rounded-[3px] bg-[#e3efe5] px-1.5 text-[11px] text-[#2f6b40]">{a.kuerzel}</span>
                {a.label}
              </span>
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[#ebe8e5] text-[rgba(12,10,8,.6)]">
            <I.Bell className="size-4" />
          </span>
          Eintragen in
          <span className={node}>
            <span className="rounded-[3px] bg-[#e4ebf6] px-1.5 text-[11px] text-[#3b63a8]">T</span>
            {r.protokoll}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Talona's morning digest card. */
function Morgen({ m, nav }: { m: Modell; nav: Nav }) {
  const g = m.digest;
  const [neu, setNeu] = useState<Record<string, string>>({});
  return (
    <div className="sticky top-0 space-y-4">
      <div className="text-[15px] text-[rgba(12,10,8,.6)]">Morgenübersicht, wie sie per WhatsApp kommt</div>
      <Card className="overflow-hidden">
        <div className="flex items-start justify-between border-b border-[var(--line)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f4f2f0]">
              <Logo size={18} />
            </span>
            <div>
              <div className="text-[16px]">Guten Morgen, {g.empfaenger.vorname}</div>
              <div className="text-[12px] text-[rgba(12,10,8,.55)]">
                {m.d.projekt.projekt} · {tagKurz(g.heute + "T06:30:00")} · 06:30
              </div>
            </div>
          </div>
          <Pill>Morgenübersicht</Pill>
        </div>
        <div className="space-y-5 px-5 py-4">
          <Abschnitt titel="Braucht Sie" n={g.braucht.length}>
            {g.braucht.map((b) => (
              <div key={b.text} className="flex items-center justify-between gap-3 py-1 text-[14px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgba(12,10,8,.4)]" />
                  <span className="truncate">{b.text}</span>
                </span>
                <Pill ton={b.pill.ton}>{b.pill.label}</Pill>
              </div>
            ))}
          </Abschnitt>
          <Abschnitt titel="Wartet auf andere" n={g.wartet.length}>
            {g.wartet.map((r) => (
              <button key={r.id} onClick={() => nav.nachricht(r.eintrag.quelle_hash)} className="flex w-full items-center justify-between gap-3 py-1 text-left text-[14px]">
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar p={r.gefragtVon} size={20} />
                  <span className="truncate">{r.titel}</span>
                </span>
                <Pill ton={alterTon(r.alterTage)}>{alterLabel(r.alterTage, r.seit, m.jetzt)}</Pill>
              </button>
            ))}
          </Abschnitt>
          <Abschnitt titel="Gestern entschieden">
            {g.entschieden.map((e) => (
              <div key={e.id} className="flex items-center gap-2 py-1 text-[14px]">
                <Avatar p={m.pers(e.person)} size={20} />
                <span className="line-clamp-1">{e.zusammenfassung}</span>
              </div>
            ))}
          </Abschnitt>
        </div>
      </Card>

      {g.heuteGeplant.length > 0 && (
        <Card className="px-5 py-4">
          <MonoLabel>Heute auf der Baustelle</MonoLabel>
          {g.heuteGeplant.map((e) => (
            <div key={e.id} className="mt-2 flex gap-3 text-[14px]">
              <span className="mono text-[12px] text-[rgba(12,10,8,.55)]">{zeit(e.zeitpunkt)}</span>
              <span className="line-clamp-1">{e.zusammenfassung}</span>
            </div>
          ))}
        </Card>
      )}

      {g.neu.map((p) => (
        <Card key={p.name} className="px-5 py-4">
          <MonoLabel>Neu auf der Baustelle</MonoLabel>
          <div className="mt-3 flex items-center gap-3">
            <Avatar p={p} size={32} />
            <div>
              <div className="text-[15px]">{p.name}</div>
              <div className="text-[12px] text-[rgba(12,10,8,.55)]">{p.firma ?? "Firma unbekannt"}</div>
            </div>
          </div>
          {neu[p.name] ? (
            <div className="mt-3 text-[13px] text-[rgba(12,10,8,.6)]">{neu[p.name]}</div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button onClick={() => setNeu({ ...neu, [p.name]: "Bestätigt" })} className="rounded-[3px] bg-[var(--text)] px-3 py-1.5 text-[13px] text-white">
                Bestätigen
              </button>
              <button onClick={() => setNeu({ ...neu, [p.name]: "Nicht unsere Baustelle" })} className="rounded-[3px] bg-[#ebe8e5] px-3 py-1.5 text-[13px]">
                Nicht unsere
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Abschnitt({ titel, n, children }: { titel: string; n?: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <MonoLabel>{titel}</MonoLabel>
        {n !== undefined && <span className="rounded-[3px] bg-[#ebe8e5] px-1.5 text-[10px]">{n}</span>}
      </div>
      {children}
    </div>
  );
}
