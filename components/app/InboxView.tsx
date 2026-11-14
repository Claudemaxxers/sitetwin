"use client";

import { useState } from "react";
import { gewerkLabel, istAudio, istFoto, nachrichtTitel, type Nachricht } from "@/lib/vm";
import { anhangUrl, type Modell, type Nav } from "./modell";
import { SignalPill } from "./Signal";
import { Avatar, I, Pill, Welle, tagZeit, zeit } from "./ui";

/** Talona's inbox: messages grouped by person, one opened on the right with its write-up. */
export function InboxView({ m, sel, setSel, nav, neu }: { m: Modell; sel: string | null; setSel: (h: string | null) => void; nav: Nav; neu: Set<string> }) {
  const [q, setQ] = useState("");
  const liste = m.msgs.filter((n) => !q || `${n.person.name} ${n.text} ${n.eintraege.map((e) => e.zusammenfassung).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const personen = [...new Set(liste.map((n) => n.person.name))];
  const aktiv = m.msgs.find((n) => n.hash === sel) ?? null;

  return (
    <div className="grid h-full grid-cols-[340px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-[var(--line)]">
        <div className="border-b border-[var(--line)] px-7 py-5">
          {aktiv ? (
            <button onClick={() => setSel(null)} className="flex items-center gap-2 text-[17px]">
              <I.ChevronLeft className="size-4" />
              <span className="underline underline-offset-4">Inbox</span>
            </button>
          ) : (
            <div className="text-[17px]">Inbox</div>
          )}
        </div>
        <label className="flex items-center gap-2.5 border-b border-[var(--line)] px-7 py-4 text-[15px]">
          <I.Search className="size-4 text-[rgba(12,10,8,.5)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Baustellen-Chat durchsuchen" className="w-full bg-transparent outline-none placeholder:text-[rgba(12,10,8,.5)]" />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          {personen.map((p) => (
            <div key={p}>
              <div className="px-4 pb-2 pt-6 text-[16px] text-[rgba(12,10,8,.6)]">{m.pers(p).kurz}</div>
              {liste
                .filter((n) => n.person.name === p)
                .map((n) => (
                  <button
                    key={n.hash}
                    onClick={() => setSel(n.hash)}
                    className={`flex w-full items-center gap-3 rounded-[6px] px-3 py-3 text-left ${aktiv?.hash === n.hash ? "bg-[#f1efec]" : "hover:bg-[var(--wash)]"} ${n.eintraege.some((e) => neu.has(e.id)) ? "flash" : ""}`}
                  >
                    <Avatar p={n.person} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate text-[16px]">{nachrichtTitel(n)}</span>
                      <span className="block truncate text-[14px] text-[rgba(12,10,8,.55)]">
                        {art(n)} · {zeit(n.zeit)}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      </aside>

      <div className="min-h-0 overflow-y-auto">{aktiv ? <Detail n={aktiv} m={m} nav={nav} /> : <Leer m={m} onOpen={setSel} />}</div>
    </div>
  );
}

const art = (n: Nachricht) => (istAudio(n.anhang) ? "Sprache" : istFoto(n.anhang) ? "Foto" : n.typ === "email" ? "Mail" : n.typ === "call" ? "Anruf" : "Text");
const titelLang = (n: Nachricht) =>
  istAudio(n.anhang) ? `Sprachnachricht von ${n.person.vorname}` : istFoto(n.anhang) ? `Foto von ${n.person.vorname}` : n.typ === "email" ? `Mail von ${n.person.vorname}` : n.typ === "call" ? `Anruf mit ${n.person.vorname}` : `Nachricht von ${n.person.vorname}`;

function Leer({ m, onOpen }: { m: Modell; onOpen: (h: string) => void }) {
  const wichtig = m.msgs.filter((n) => m.ch.some((c) => c.eintraege.some((e) => e.quelle_hash === n.hash))).slice(0, 5);
  return (
    <div className="max-w-[760px] px-16 py-12">
      <h1 className="text-[40px] leading-[46px] tracking-[-0.02em]">Inbox</h1>
      <p className="mt-2 text-[16px] text-[rgba(12,10,8,.6)]">Alles, was die Baustelle geschickt hat. SiteTwin hat jede Nachricht gelesen und ins Protokoll eingetragen.</p>
      <div className="mt-10 text-[15px] text-[rgba(12,10,8,.6)]">Nachrichten mit einer möglichen Änderung</div>
      {wichtig.map((n) => (
        <button key={n.hash} onClick={() => onOpen(n.hash)} className="mt-2 flex w-full items-center gap-3 rounded-[6px] border border-[var(--line)] px-4 py-3 text-left hover:bg-[var(--wash)]">
          <Avatar p={n.person} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px]">{n.eintraege[0]?.zusammenfassung}</span>
            <span className="text-[13px] text-[rgba(12,10,8,.55)]">
              {n.person.kurz} · {tagZeit(n.zeit)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Detail({ n, m, nav }: { n: Nachricht; m: Modell; nav: Nav }) {
  const [offen, setOffen] = useState(true);
  const ids = new Set(n.eintraege.map((e) => e.id));
  const change = m.ch.find((c) => c.eintraege.some((e) => ids.has(e.id)));
  const signale = m.d.signale.filter((s) => s.eintrag_ids.some((id) => ids.has(id)));
  const e = n.eintraege[0];
  const plan = change?.plan ?? m.d.plaene.find((p) => p.top && p.top === e?.top) ?? null;
  const punkte = [...new Set(n.eintraege.map((x) => x.zusammenfassung))].slice(0, 2);
  if (change && change.fehlend.length) {
    punkte.push(
      `${plan ? `${plan.plan_nr} Index ${plan.plan_index} ${change.art === "planaenderung" ? "zeigt die Änderung" : "ist der gültige Plan"}, ` : ""}${change.fehlend.length === 1 ? `es fehlt noch: ${change.fehlend[0].toLowerCase()}.` : `es fehlen noch ${change.fehlend.map((f) => f.toLowerCase()).join(" und ")}.`}`,
    );
  }

  return (
    <div className="max-w-[900px] px-16 py-10">
      <Avatar p={n.person} size={64} />
      <h1 className="mt-5 text-[40px] leading-[46px] tracking-[-0.02em]">{titelLang(n)}</h1>
      <div className="mt-2 text-[16px] text-[rgba(12,10,8,.6)]">
        <span className="underline underline-offset-4">{n.person.kurz}</span> · <span className="underline underline-offset-4">{m.d.projekt.name ?? m.d.projekt.projekt}</span> · {tagZeit(n.zeit)}
      </div>

      {signale.map((s) => (
        <div key={s.id} className="mt-7 rounded-[6px] border border-[#f0b48f] bg-[#fff8f3] px-7 py-5">
          <div className="flex items-center gap-4 text-[16px]">
            <span className="text-[#b45624]">Abweichung erkannt · {s.status === "geloest" ? "inzwischen gelöst" : `${m.pers(s.zustaendig).vorname} wird angerufen`}</span>
            <SignalPill s={s} />
          </div>
          <div className="mt-2 text-[15px]">{s.titel}</div>
        </div>
      ))}

      <div className={`mt-7 rounded-[6px] border px-7 py-5 ${change ? "border-[#9cc8a8]" : "border-[var(--line)]"}`}>
        <div className="flex items-center gap-4 text-[17px]">
          <span className={change ? "text-[#2f7a46]" : ""}>{change ? (change.bereit ? "Änderung erfasst" : "Aufschreiben empfohlen") : "Ins Protokoll eingetragen"}</span>
          <button onClick={() => nav.fragen(`Was ist der Stand zu: ${punkte[0] ?? ""}`)} className="flex items-center gap-1.5 text-[15px] underline underline-offset-4">
            <I.Sparkle className="size-4" /> SiteTwin fragen
          </button>
        </div>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[16px] leading-relaxed">
          {punkte.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>

      {(istAudio(n.anhang) || istFoto(n.anhang) || n.text) && (
        <div className="mt-7">
          {istAudio(n.anhang) && <Sprachnachricht pfad={n.anhang!} />}
          {istFoto(n.anhang) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={anhangUrl(n.anhang!)} alt="Foto von der Baustelle" className="max-h-80 rounded-[6px] border border-[var(--line)] object-cover" />
          )}
          {n.text && (
            <blockquote className="mt-3 border-l-2 border-[var(--line)] pl-4 text-[15px] leading-relaxed text-[rgba(12,10,8,.65)]">
              {n.typ === "call" ? n.text.slice(0, 700) : n.text.slice(0, 500)}
              {n.text.length > 500 && "…"}
            </blockquote>
          )}
          <button onClick={() => nav.thread(n.hash)} className="mt-3 text-[14px] underline underline-offset-4">
            {n.typ === "whatsapp" ? "Im Chat-Verlauf ansehen" : n.typ === "email" ? "Mailverlauf ansehen" : "Gesprächsprotokoll ansehen"}
          </button>
        </div>
      )}

      {e && (
        <>
          <button onClick={() => setOffen(!offen)} className="mt-9 flex items-center gap-3 text-[22px] tracking-[-0.01em]">
            <I.ChevronDown className={`size-5 transition ${offen ? "" : "-rotate-90"}`} />
            {change ? `Änderung ${change.nr}` : "Protokoll-Eintrag"}
            <Pill ton="gruen" className="!h-6 !text-[13px]">
              {change ? (change.bereit ? "Bereit" : "Entwurf") : "Erfasst"}
            </Pill>
          </button>
          {offen && (
            <div className="mt-4 space-y-4 pl-8 text-[17px]">
              <Zeile icon={<I.Layers />} k="Top" v={[e.top, e.raum].filter(Boolean).join(" · ") || "–"} />
              <Zeile icon={<I.Tag />} k="Gewerk" v={gewerkLabel(change ? change.eintraege.find((x) => x.gewerk && x.gewerk !== "planung")?.gewerk : e.gewerk)} />
              <Zeile icon={<I.Book />} k="Plan" v={plan ? `${plan.plan_nr} Index ${plan.plan_index}` : "–"} />
              <Zeile
                icon={<I.Users />}
                k="Freigabe"
                v={
                  change?.freigabe ? (
                    `${change.freigabe.von.name} ${change.freigabe.wie}`
                  ) : change ? (
                    <button onClick={() => nav.entwurf(change)} className="underline underline-offset-4">
                      Beim Bauherrn anfragen
                    </button>
                  ) : (
                    "–"
                  )
                }
              />
              {change && (
                <button onClick={() => nav.aenderung(change.key)} className="text-[15px] underline underline-offset-4">
                  {change.nr} öffnen
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Zeile({ icon, k, v }: { icon: React.ReactNode; k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[220px_1fr] items-center">
      <span className="flex items-center gap-3 text-[rgba(12,10,8,.75)]">
        <span className="text-[rgba(12,10,8,.55)]">{icon}</span>
        {k}
      </span>
      <span>{v}</span>
    </div>
  );
}

export function Sprachnachricht({ pfad, klein }: { pfad: string; klein?: boolean }) {
  const [spielt, setSpielt] = useState(false);
  const id = `a-${pfad.slice(-12)}`;
  return (
    <div className={`inline-flex items-center gap-3 rounded-[8px] bg-[#f4f2f0] ${klein ? "px-2.5 py-2" : "px-4 py-3"}`}>
      <button
        aria-label={spielt ? "Pause" : "Abspielen"}
        onClick={() => {
          const a = document.getElementById(id) as HTMLAudioElement | null;
          if (!a) return;
          if (a.paused) a.play().catch(() => setSpielt(false));
          else a.pause();
        }}
      >
        {spielt ? <I.Pause className="size-4" /> : <I.Play className="size-4" />}
      </button>
      <Welle n={klein ? 16 : 26} className="text-[rgba(12,10,8,.55)]" />
      <audio id={id} src={anhangUrl(pfad)} onPlay={() => setSpielt(true)} onPause={() => setSpielt(false)} onEnded={() => setSpielt(false)} preload="none" />
    </div>
  );
}
