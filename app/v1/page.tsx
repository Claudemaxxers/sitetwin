"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WALL_IDS, wallsFor } from "@/lib/model";
import { SCENARIO } from "@/lib/scenario";
import { deriveTwin } from "@/lib/twin";
import type { Flag, SiteEvent, Source } from "@/lib/types";
import { Composer, ElementPanel, Feed, Inbox } from "@/components/Panels";
import type { WallMark } from "@/components/Twin3D";
import { STATUS_COLOR, STATUS_LABEL, CONFLICT_COLOR, STOPPED_COLOR, timeLabel } from "@/components/ui";

const Twin3D = dynamic(() => import("@/components/Twin3D"), { ssr: false, loading: () => <div className="p-6 muted">3D-Modell lädt…</div> });

interface State {
  events: SiteEvent[];
  flags: Flag[];
  engine: "claude" | "heuristic";
}

/** Flags as they looked at time `t` (for the replay slider). */
function flagsAt(flags: Flag[], t: string | null): Flag[] {
  if (!t) return flags;
  return flags
    .filter((f) => f.ts <= t)
    .map((f) => (f.decidedAt && f.decidedAt > t ? { ...f, status: "open" as const, decidedAt: undefined, decidedBy: undefined, comment: undefined } : f));
}

export default function Page() {
  const [data, setData] = useState<State | null>(null);
  const [cursor, setCursor] = useState<number | null>(null); // null = live
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    const next = (await res.json()) as State;
    const newIds = next.events.filter((e) => known.current.size && !known.current.has(e.id)).map((e) => e.id);
    known.current = new Set(next.events.map((e) => e.id));
    if (newIds.length) setFresh(new Set(newIds));
    setData(next);
  }, []);

  useEffect(() => {
    load();
    const es = new EventSource("/api/stream");
    es.onmessage = () => load();
    return () => es.close();
  }, [load]);

  const live = cursor === null;
  const view = useMemo(() => {
    if (!data) return null;
    const events = live ? data.events : data.events.slice(0, cursor);
    const t = live ? null : (events[events.length - 1]?.ts ?? null);
    const flags = flagsAt(data.flags, t);
    const twin = deriveTwin(events);
    const marks: Record<string, WallMark> = {};
    for (const f of flags) {
      if (f.rule === "low_confidence") continue;
      for (const w of wallsFor(f.elementId)) {
        if (f.status === "open") marks[w] = "conflict";
        else if (f.status === "stopped" && marks[w] !== "conflict") {
          // A stop holds until the wall passes inspection afterwards.
          const cleared = events.some((e) => e.action === "inspection_passed" && wallsFor(e.elementId).includes(w) && e.ts > (f.decidedAt ?? ""));
          if (!cleared) marks[w] = "stopped";
        }
      }
    }
    return { events, flags, twin, marks };
  }, [data, cursor, live]);

  const send = async (p: { source: Source; sender: string; text: string; image?: { data: string; mediaType: string } }) => {
    setBusy(true);
    try {
      await fetch("/api/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
      setCursor(null);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (flagId: string, outcome: "approve" | "stop", comment: string) => {
    await fetch("/api/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ flagId, outcome, comment }) });
  };

  const nextDemo = async () => {
    const m = SCENARIO[step];
    if (!m) return;
    await send({ source: m.source, sender: m.sender, text: m.text });
    setStep(step + 1);
  };

  const reset = async () => {
    await fetch("/api/reset", { method: "POST" });
    setStep(0);
    setCursor(null);
    setSelected(null);
  };

  if (!data || !view) return <div className="p-6 muted">Lade Baustelle…</div>;

  const openCount = view.flags.filter((f) => f.status === "open").length;
  const counts = WALL_IDS.reduce<Record<string, number>>((acc, id) => {
    const s = view.twin[id].status;
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen lg:h-screen flex flex-col">
      <div className="bg-[var(--text)] text-white text-center text-[13px] py-2 px-4">
        Building Better Worlds Hackathon · Track 01 <span className="opacity-60">·</span> Context for the Physical World
      </div>
      <header className="flex flex-wrap items-center gap-4 px-5 py-3 border-b border-[var(--line)] bg-white">
        <div className="flex items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2 L22 12 L12 22 L2 12 Z" fill="var(--text)" />
            <path d="M12 7 L17 12 L12 17 L7 12 Z" fill="var(--accent)" />
          </svg>
          <span className="text-[19px] tracking-tight">SiteTwin</span>
          <span className="label ml-2 hidden sm:inline">Baustelle · Haus A · EG</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="chip" title="Wie Nachrichten ausgewertet werden">{data.engine === "claude" ? "KI: CLAUDE" : "REGEL-FALLBACK"}</span>
          {step < SCENARIO.length ? (
            <button className="btn btn-accent" onClick={nextDemo} disabled={busy} title={SCENARIO[step].note}>
              ▶ Demo {step + 1}/{SCENARIO.length}: {SCENARIO[step].note.split("→")[0].trim()}
            </button>
          ) : (
            <span className="muted text-sm">Demo durchgespielt</span>
          )}
          <button className="btn" onClick={reset}>Zurücksetzen</button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-2 border-b border-[var(--line)] bg-white/90 label">
        <span className="flex items-center gap-2"><i className="live-dot" /> Live auf der Baustelle</span>
        <span>Offene Konflikte <span className="chip !text-[var(--text)]">{openCount}</span></span>
        <span>Nachrichten verarbeitet <span className="chip !text-[var(--text)]">{view.events.filter((e) => e.source !== "seed").length}</span></span>
        <span>Entscheidungen <span className="chip !text-[var(--text)]">{view.flags.filter((f) => f.status !== "open").length}</span></span>
        <span>Wände abgenommen <span className="chip !text-[var(--text)]">{WALL_IDS.filter((id) => view.twin[id].done.inspection_passed).length}/{WALL_IDS.length}</span></span>
        <span>Fragen beantwortet <span className="chip !text-[var(--text)]">{view.events.filter((e) => e.action === "question_answered").length}</span></span>
      </div>

      <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[340px_1fr_360px] gap-3 p-3">
        <section className="panel p-3 flex flex-col min-h-0 order-2 lg:order-1">
          <h2 className="label mb-2">KANÄLE · LIVE</h2>
          <Composer onSend={send} busy={busy} />
          <div className="mt-3 overflow-auto min-h-0 flex-1 max-h-[50vh] lg:max-h-none">
            <Feed events={view.events} freshIds={fresh} onSelect={setSelected} />
          </div>
        </section>

        <section className="panel relative overflow-hidden min-h-[420px] order-1 lg:order-2 flex flex-col">
          <div className="relative flex-1 min-h-[360px]">
            <Twin3D twin={view.twin} marks={view.marks} selected={selected} onSelect={setSelected} />
            <div className="absolute left-3 top-3 flex flex-wrap gap-x-3 gap-y-1 text-xs bg-white/90 border border-[var(--line)] rounded-[3px] px-2.5 py-1.5 max-w-[calc(100%-24px)]">
              {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => (
                <span key={s} className="flex items-center gap-1">
                  <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
                  {STATUS_LABEL[s]} <span className="muted">{counts[s] ?? 0}</span>
                </span>
              ))}
              <span className="flex items-center gap-1">
                <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: CONFLICT_COLOR }} />
                Konflikt
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STOPPED_COLOR }} />
                Gestoppt
              </span>
            </div>
            {selected && view.twin[selected] && (
              <div className="absolute right-3 top-3">
                <ElementPanel wall={view.twin[selected]} events={view.events} flags={view.flags} onClose={() => setSelected(null)} />
              </div>
            )}
          </div>
          <div className="border-t border-[var(--line)] px-3 py-2 flex items-center gap-3 text-xs">
            <span className="mono muted whitespace-nowrap">ZEITLEISTE</span>
            <input
              type="range"
              className="flex-1 accent-[#ee783b]"
              min={1}
              max={data.events.length}
              value={cursor ?? data.events.length}
              onChange={(e) => {
                const v = Number(e.target.value);
                setCursor(v === data.events.length ? null : v);
              }}
            />
            <span className="mono whitespace-nowrap">
              {live ? <span className="accent">● LIVE</span> : timeLabel(view.events[view.events.length - 1].ts)}
            </span>
            {!live && (
              <button className="btn !py-0.5" onClick={() => setCursor(null)}>
                Live
              </button>
            )}
          </div>
        </section>

        <section className="panel p-3 flex flex-col min-h-0 order-3">
          <h2 className="label mb-2">
            BAULEITUNG · ENTSCHEIDUNGEN {openCount > 0 && <span className="text-red-400">({openCount} offen)</span>}
          </h2>
          <div className="overflow-auto min-h-0 flex-1">
            <Inbox flags={view.flags} events={view.events} live={live} onDecide={decide} onSelect={setSelected} />
          </div>
        </section>
      </main>
    </div>
  );
}
