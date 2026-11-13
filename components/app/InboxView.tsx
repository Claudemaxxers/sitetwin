"use client";

import { useMemo, useState } from "react";
import { ts, type ProjektDaten, type Zwilling } from "@/lib/twin-model";
import { gewerkLabel, initials, istAudio, istFoto, kurzName, nachrichten, ort, SIGNAL_STATUS, zeitKurz, type Nachricht } from "@/lib/talona";
import type { Nav } from "./AppShell";
import { Kuerzel, Label, Pill } from "./ui";

/** Talona's inbox: messages grouped by person, one message opened on the right. */
export function InboxView({ daten, z, sel, setSel, nav, neu }: { daten: ProjektDaten; z: Zwilling; sel: string | null; setSel: (h: string) => void; nav: Nav; neu: Set<string> }) {
  const [q, setQ] = useState("");
  const alle = useMemo(() => nachrichten(daten.eintraege), [daten.eintraege]);
  const liste = alle.filter((n) => !q || `${n.person} ${n.eintraege.map((e) => e.zusammenfassung).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const personen = [...new Set(liste.map((n) => n.person))];
  const aktiv = alle.find((n) => n.hash === sel) ?? liste[0] ?? null;

  return (
    <div className="grid h-full grid-cols-[320px_minmax(0,1fr)]">
      <aside className="overflow-y-auto border-r border-[var(--line)] px-3 py-5">
        <div className="px-2 text-[15px]">Inbox</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Baustellen-Chat durchsuchen" className="input mt-3 !rounded-full !px-4" />
        {personen.map((p) => (
          <div key={p} className="mt-4">
            <div className="muted px-2 pb-1 text-[12px]">{kurzName(p)}</div>
            {liste
              .filter((n) => n.person === p)
              .map((n) => (
                <button key={n.hash} onClick={() => setSel(n.hash)} className={`flex w-full items-center gap-2.5 rounded-[4px] px-2 py-2 text-left ${aktiv?.hash === n.hash ? "bg-[var(--panel-2)]" : "hover:bg-[var(--wash)]"} ${n.eintraege.some((e) => neu.has(e.id)) ? "flash" : ""}`}>
                  <Kuerzel tone={n.typ === "email" ? "info" : "plain"}>{initials(n.person)}</Kuerzel>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{titelKurz(n)}</span>
                    <span className="muted block truncate text-[11px]">
                      {art(n)} · {zeitKurz(n.zeit)}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        ))}
      </aside>

      <div className="overflow-y-auto px-10 py-6">{aktiv ? <Detail n={aktiv} daten={daten} z={z} nav={nav} /> : <div className="muted">Keine Nachrichten.</div>}</div>
    </div>
  );
}

function art(n: Nachricht) {
  if (istAudio(n.anhang)) return "Sprachnachricht";
  if (istFoto(n.anhang)) return "Foto";
  return { whatsapp: "WhatsApp", email: "E-Mail", call: "Anruf", drive: "Datei" }[n.typ ?? "whatsapp"] ?? "Nachricht";
}

function titelKurz(n: Nachricht) {
  const e = n.eintraege[0];
  return [e.top, e.element ?? e.taetigkeit].filter(Boolean).join(" · ") || e.zusammenfassung;
}

function Detail({ n, daten, z, nav }: { n: Nachricht; daten: ProjektDaten; z: Zwilling; nav: Nav }) {
  const ids = new Set(n.eintraege.map((e) => e.id));
  const themen = z.signale.concat(z.geloest).filter((s) => s.eintrag_ids.some((id) => ids.has(id)));
  const e = n.eintraege[0];
  const plan = daten.plaene.find((p) => p.top && p.top === e.top);
  const wartet = n.eintraege.find((x) => x.wartet_auf)?.wartet_auf;

  return (
    <div className="max-w-[760px]">
      <Kuerzel size={44}>{initials(n.person)}</Kuerzel>
      <h1 className="mt-3 text-[28px] leading-8 tracking-[-0.02em]">
        {art(n)} von {n.person.split(" ")[0]}
      </h1>
      <div className="muted mt-1.5 text-[13px]">
        <span className="underline underline-offset-2">{kurzName(n.person)}</span> · <span className="underline underline-offset-2">{daten.projekt.name ?? daten.projekt.projekt}</span> · {zeitKurz(n.zeit)}
      </div>

      {themen.map((s) => (
        <div key={s.id} className="mt-6 rounded-[4px] border border-[var(--accent)] bg-[#fffaf6] p-4">
          <div className="flex items-center gap-3 text-[13px]">
            <span className="accent">Thema erkannt</span>
            <Pill tone={SIGNAL_STATUS[s.status].tone}>{SIGNAL_STATUS[s.status].label}</Pill>
            <button onClick={() => nav.zuAenderung(s.id)} className="ml-auto underline underline-offset-2">
              Öffnen
            </button>
          </div>
          <div className="mt-2 text-[14px]">{s.titel}</div>
        </div>
      ))}

      <div className="mt-6 rounded-[4px] border border-[#9cc8a8] p-4">
        <div className="text-[13px] text-[#2f7a46]">Erfasst</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed">
          {n.eintraege.map((x) => (
            <li key={x.id}>{x.zusammenfassung}</li>
          ))}
        </ul>
      </div>

      {(n.text || n.anhang) && (
        <>
          <Label className="mt-6">Original</Label>
          {n.text && <blockquote className="mt-2 border-l-2 border-[var(--line)] pl-4 text-[14px] leading-relaxed text-[var(--muted)]">{n.text.length > 600 ? n.text.slice(0, 600) + "…" : n.text}</blockquote>}
          {istFoto(n.anhang) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/anhang?pfad=${encodeURIComponent(n.anhang!)}`} alt="Foto von der Baustelle" className="mt-3 max-h-72 rounded-[4px] border border-[var(--line)] object-cover" />
          )}
        </>
      )}

      <div className="mt-6 flex items-center gap-2 text-[15px]">
        <span>Protokoll-Eintrag</span>
        <Pill tone="ok">Erfasst</Pill>
      </div>
      <div className="mt-3 divide-y divide-[var(--line)] text-[14px]">
        <Zeile k="Ort" v={ort(e.top, e.raum)} />
        <Zeile k="Element" v={e.element ?? "–"} />
        <Zeile k="Gewerk" v={gewerkLabel(e.gewerk)} />
        <Zeile k="Plan" v={plan ? `${plan.plan_nr} Index ${plan.plan_index}${e.plan_index && e.plan_index !== plan.plan_index ? ` (genannt: Index ${e.plan_index})` : ""}` : e.plan_index ? `Index ${e.plan_index}` : "–"} />
        <Zeile k="Wartet auf" v={wartet ?? "–"} />
      </div>
      {e.top && (
        <button className="btn mt-5" onClick={() => nav.zuTop(e.top!)}>
          {e.top} im Zwilling zeigen
        </button>
      )}
      <div className="muted mt-8 text-[11px]">{n.eintraege.length} Einträge aus dieser Nachricht · zuletzt verarbeitet {zeitKurz(Math.max(...n.eintraege.map((x) => ts(x.zeitpunkt))))}</div>
    </div>
  );
}

function Zeile({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] py-2.5">
      <span className="muted">{k}</span>
      <span>{v}</span>
    </div>
  );
}
