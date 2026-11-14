"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProjektDaten } from "@/lib/twin-model";
import type { Aenderung } from "@/lib/vm";
import { AlertsView } from "./AlertsView";
import { AskDrawer } from "./AskDrawer";
import { ChangesView } from "./ChangesView";
import { DailyLogView } from "./DailyLogView";
import { DraftModal } from "./DraftModal";
import { InboxView } from "./InboxView";
import { baueModell, type Ansicht, type Nav } from "./modell";
import { RecordView } from "./RecordView";
import { ThreadDrawer } from "./ThreadDrawer";
import { I, Logo } from "./ui";

export type { Ansicht } from "./modell";

/** Talona's web app frame: thin icon rail on the left, the page on the right (TALONA.md §2). */
export default function AppShell({ initial, start }: { initial: ProjektDaten; start?: Ansicht }) {
  const [daten, setDaten] = useState(initial);
  const [neu, setNeu] = useState<Set<string>>(new Set());
  const [ansicht, setAnsicht] = useState<Ansicht>(start ?? "aenderungen");
  const [aenderung, setAenderung] = useState<string | null>(null);
  const [exposure, setExposure] = useState(false);
  const [nachricht, setNachricht] = useState<string | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Aenderung | null>(null);
  const [frage, setFrage] = useState<{ q: string; key: number } | null>(null);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/projekt/${encodeURIComponent(initial.projekt.projekt)}`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as ProjektDaten;
        setDaten((prev) => {
          const known = new Set(prev.eintraege.map((e) => e.id));
          const fresh = next.eintraege.filter((e) => !known.has(e.id)).map((e) => e.id);
          if (fresh.length) setNeu(new Set(fresh));
          return next;
        });
      } catch {
        /* keep last state */
      }
    }, 6000);
    return () => clearInterval(id);
  }, [initial.projekt.projekt]);

  const m = useMemo(() => baueModell(daten), [daten]);

  const nav: Nav = {
    zu: (a) => {
      setAnsicht(a);
      if (a === "aenderungen") {
        setAenderung(null);
        setExposure(false);
      }
    },
    aenderung: (key) => {
      setAenderung(key);
      setExposure(false);
      setAnsicht("aenderungen");
    },
    exposure: () => {
      setExposure(true);
      setAenderung(null);
      setAnsicht("aenderungen");
    },
    nachricht: (hash) => {
      setNachricht(hash);
      setAnsicht("inbox");
    },
    thread: (hash) => setThread(hash),
    entwurf: (c) => setEntwurf(c),
    fragen: (q) => setFrage({ q: q ?? "", key: Date.now() }),
  };

  const offeneSignale = m.d.signale.filter((s) => s.status !== "geloest").length;
  const offeneAenderungen = m.ch.filter((c) => !c.bereit).length;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <aside className="flex w-[64px] shrink-0 flex-col items-center gap-2 border-r border-[var(--line)] bg-[#faf9f7] py-4">
        <Link href="/" title="Alle Projekte" className="mb-4 flex h-9 w-9 items-center justify-center">
          <Logo size={24} />
        </Link>
        <Rail title="Änderungen" active={ansicht === "aenderungen"} dot={offeneAenderungen > 0} onClick={() => nav.zu("aenderungen")}>
          <I.Chart />
        </Rail>
        <Rail title="Inbox" active={ansicht === "inbox"} onClick={() => nav.zu("inbox")}>
          <I.Inbox />
        </Rail>
        <Rail title="Bautagebuch" active={ansicht === "bautagebuch"} onClick={() => nav.zu("bautagebuch")}>
          <I.Calendar />
        </Rail>
        <Rail title="Protokoll" active={ansicht === "protokoll"} onClick={() => nav.zu("protokoll")}>
          <I.Layers />
        </Rail>
        <Rail title="Benachrichtigungen" active={ansicht === "benachrichtigungen"} dot={offeneSignale > 0} onClick={() => nav.zu("benachrichtigungen")}>
          <I.Bell />
        </Rail>
        <div className="flex-1" />
        <Link href="/" title="Alle Projekte" className="flex h-9 w-9 items-center justify-center rounded-[6px] text-[rgba(12,10,8,.45)] hover:bg-[var(--wash)] hover:text-[var(--text)]">
          <I.Grid />
        </Link>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-hidden">
        {ansicht === "aenderungen" && <ChangesView m={m} detail={aenderung} exposure={exposure} nav={nav} />}
        {ansicht === "inbox" && <InboxView m={m} sel={nachricht} setSel={setNachricht} nav={nav} neu={neu} />}
        {ansicht === "bautagebuch" && <DailyLogView m={m} nav={nav} />}
        {ansicht === "protokoll" && <RecordView m={m} nav={nav} neu={neu} />}
        {ansicht === "benachrichtigungen" && <AlertsView m={m} nav={nav} />}

        {thread && <ThreadDrawer m={m} hash={thread} onClose={() => setThread(null)} />}
        {frage && <AskDrawer key={frage.key} m={m} start={frage.q} nav={nav} onClose={() => setFrage(null)} />}
        {entwurf && <DraftModal m={m} c={entwurf} onClose={() => setEntwurf(null)} />}
      </main>
    </div>
  );
}

function Rail({ title, active, dot, onClick, children }: { title: string; active: boolean; dot?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`relative flex h-10 w-10 items-center justify-center rounded-[6px] ${active ? "bg-[#ebe8e5] text-[var(--text)]" : "text-[rgba(12,10,8,.45)] hover:bg-[var(--wash)] hover:text-[var(--text)]"}`}
    >
      {children}
      {dot && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
    </button>
  );
}
