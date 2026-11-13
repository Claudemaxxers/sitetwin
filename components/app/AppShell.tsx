"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { zwilling, type ProjektDaten } from "@/lib/twin-model";
import TwinView from "../TwinView";
import { ChangesView } from "./ChangesView";
import { InboxView } from "./InboxView";
import { RecordView } from "./RecordView";

export type Ansicht = "aenderungen" | "inbox" | "protokoll" | "zwilling";

export interface Nav {
  zuAenderung: (id: string) => void;
  zuNachricht: (hash: string) => void;
  zuTop: (top: string) => void;
}

/** Talona's web app frame: thin icon rail on the left, page on the right (TALONA.md §2). */
export default function AppShell({ initial, start }: { initial: ProjektDaten; start?: Ansicht }) {
  const [daten, setDaten] = useState(initial);
  const [neu, setNeu] = useState<Set<string>>(new Set());
  const [ansicht, setAnsicht] = useState<Ansicht>(start ?? "aenderungen");
  const [aenderung, setAenderung] = useState<string | null>(null);
  const [nachricht, setNachricht] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ top: string; key: number } | null>(null);

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

  const z = useMemo(() => zwilling(daten), [daten]);
  const nav: Nav = {
    zuAenderung: (id) => {
      setAenderung(id);
      setAnsicht("aenderungen");
    },
    zuNachricht: (hash) => {
      setNachricht(hash);
      setAnsicht("inbox");
    },
    zuTop: (top) => {
      setFocus({ top, key: Date.now() });
      setAnsicht("zwilling");
    },
  };
  const offen = z.signale.filter((s) => s.status === "offen").length;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <aside className="flex w-[56px] shrink-0 flex-col items-center gap-1 border-r border-[var(--line)] bg-white py-3">
        <Link href="/" title="Alle Projekte" className="mb-3 flex h-9 w-9 items-center justify-center">
          <Logo />
        </Link>
        <RailButton title="Änderungen" active={ansicht === "aenderungen"} badge={offen} onClick={() => { setAnsicht("aenderungen"); setAenderung(null); }}>
          <IconChart />
        </RailButton>
        <RailButton title="Inbox" active={ansicht === "inbox"} onClick={() => setAnsicht("inbox")}>
          <IconInbox />
        </RailButton>
        <RailButton title="Protokoll" active={ansicht === "protokoll"} onClick={() => setAnsicht("protokoll")}>
          <IconRecord />
        </RailButton>
        <RailButton title="Zwilling" active={ansicht === "zwilling"} onClick={() => setAnsicht("zwilling")}>
          <IconCube />
        </RailButton>
        <div className="flex-1" />
        <Link href="/" title="Alle Projekte" className="muted flex h-9 w-9 items-center justify-center rounded-[4px] hover:bg-[var(--panel-2)] hover:text-[var(--text)]">
          <IconGrid />
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--line)] px-6 text-[13px]">
          <div className="flex items-center gap-2">
            <span>{daten.projekt.name ?? daten.projekt.projekt}</span>
            <span className="muted">· {daten.projekt.adresse}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="muted">Krenn Bau GmbH</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--text)] text-[10px] text-white">KB</span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden">
          {ansicht === "aenderungen" && <ChangesView daten={daten} z={z} detail={aenderung} setDetail={setAenderung} nav={nav} />}
          {ansicht === "inbox" && <InboxView daten={daten} z={z} sel={nachricht} setSel={setNachricht} nav={nav} neu={neu} />}
          {ansicht === "protokoll" && <RecordView daten={daten} nav={nav} neu={neu} />}
          {ansicht === "zwilling" && <TwinView daten={daten} neu={neu} focus={focus} />}
        </main>
      </div>
    </div>
  );
}

function RailButton({ title, active, badge, onClick, children }: { title: string; active: boolean; badge?: number; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`relative flex h-9 w-9 items-center justify-center rounded-[4px] ${active ? "bg-[var(--panel-2)] text-[var(--text)]" : "muted hover:bg-[var(--wash)] hover:text-[var(--text)]"}`}
    >
      {children}
      {!!badge && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
    </button>
  );
}

/* Icons: 18px, 1.6 stroke, like Talona's rail. */
const S = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden>
      <rect x="3" y="15" width="20" height="7" rx="1.5" fill="#0c0a08" />
      <rect x="3" y="9.5" width="20" height="4.5" rx="1.2" fill="#0c0a08" opacity=".55" />
      <rect x="3" y="4" width="20" height="4.5" rx="1.2" fill="#ee783b" />
    </svg>
  );
}
const IconChart = () => (
  <svg {...S}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);
const IconInbox = () => (
  <svg {...S}>
    <path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M3 13h5l1.5 2.5h5L16 13h5" />
  </svg>
);
const IconRecord = () => (
  <svg {...S}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);
const IconCube = () => (
  <svg {...S}>
    <path d="M12 2l9 5v10l-9 5-9-5V7z" />
    <path d="M12 12l9-5M12 12v10M12 12L3 7" />
  </svg>
);
const IconGrid = () => (
  <svg {...S}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </svg>
);
