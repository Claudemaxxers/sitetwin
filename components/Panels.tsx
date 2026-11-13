"use client";

import { useRef, useState } from "react";
import { elementName, wallsFor } from "@/lib/model";
import type { Flag, SiteEvent, Source, WallState } from "@/lib/types";
import { ACTION_LABEL, SEVERITY_STYLE, SOURCE_ICON, STATUS_COLOR, STATUS_LABEL, timeLabel } from "./ui";

/* ---------------- Live feed ---------------- */

export function Feed({
  events,
  freshIds,
  onSelect,
}: {
  events: SiteEvent[];
  freshIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  const groups: { messageId: string; events: SiteEvent[] }[] = [];
  for (const e of events) {
    const last = groups[groups.length - 1];
    if (last && last.messageId === e.messageId) last.events.push(e);
    else groups.push({ messageId: e.messageId, events: [e] });
  }
  return (
    <div className="flex flex-col gap-2">
      {groups.reverse().map((g) => {
        const first = g.events[0];
        return (
          <div key={g.messageId} className={`rounded-lg border border-[var(--line)] p-2.5 ${freshIds.has(first.id) ? "flash" : ""}`}>
            <div className="flex items-center justify-between text-xs muted">
              <span>
                {SOURCE_ICON[first.source]} <span className="text-[var(--text)] font-medium">{first.sender}</span>
              </span>
              <span className="mono">{timeLabel(first.ts)}</span>
            </div>
            <div className="mt-1 text-sm whitespace-pre-wrap break-words">{first.rawText}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {g.events.map((e) => e.action === "question_answered" ? (
                <div key={e.id} className="w-full text-sm rounded-[3px] border-l-2 border-[var(--accent)] bg-[var(--panel-2)] px-2.5 py-1.5">
                  <span className="label !text-[var(--accent)]">SiteTwin antwortet aus dem Protokoll</span>
                  <div className="mt-0.5">{e.summary}</div>
                </div>
              ) : (
                <button
                  key={e.id}
                  onClick={() => wallsFor(e.elementId)[0] && onSelect(wallsFor(e.elementId)[0])}
                  className="mono text-[11px] rounded px-1.5 py-0.5 border border-[var(--line)] hover:border-[var(--accent)]"
                  title={e.summary}
                >
                  <span className="accent">{ACTION_LABEL[e.action]}</span>
                  {e.elementId !== "ALL" && <> · {elementName(e.elementId)}</>}
                  {e.drawingRev && <> · Rev {e.drawingRev}</>}
                  {e.confidence < 1 && <span className="muted"> · {Math.round(e.confidence * 100)}%</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Composer ---------------- */

const SENDERS = [
  "Ali (Elektro)",
  "Sven (Sanitär)",
  "Marek (Trockenbau)",
  "Jana (Maler)",
  "Petra Huber (Planung)",
  "Dr. Klein (Prüfer)",
  "Tom (Polier)",
];

export function Composer({ onSend, busy }: { onSend: (p: { source: Source; sender: string; text: string; image?: { data: string; mediaType: string } }) => Promise<void>; busy: boolean }) {
  const [sender, setSender] = useState(SENDERS[0]);
  const [source, setSource] = useState<Source>("chat");
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ data: string; mediaType: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setImage({ data: url.split(",")[1], mediaType: file.type, name: file.name });
      setSource("foto");
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!text.trim() && !image) return;
    await onSend({ source, sender, text, image: image ? { data: image.data, mediaType: image.mediaType } : undefined });
    setText("");
    setImage(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <select className="input" value={sender} onChange={(e) => setSender(e.target.value)}>
          {SENDERS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className="input !w-28" value={source} onChange={(e) => setSource(e.target.value as Source)}>
          <option value="chat">💬 Chat</option>
          <option value="mail">✉️ Mail</option>
          <option value="foto">📷 Foto</option>
        </select>
      </div>
      <textarea
        className="input min-h-16"
        placeholder="Nachricht wie in der Baustellen-Gruppe, z. B. „Wand 15 ist zu“"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
        }}
      />
      <div className="flex items-center gap-2">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          📷 {image ? image.name.slice(0, 18) : "Foto"}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <button className="btn btn-accent ml-auto" disabled={busy} onClick={submit}>
          {busy ? "Wird ausgewertet…" : "Senden"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Superintendent inbox ---------------- */

const SEV_ORDER = { critical: 0, high: 1, medium: 2 };

export function Inbox({
  flags,
  events,
  live,
  onDecide,
  onSelect,
}: {
  flags: Flag[];
  events: SiteEvent[];
  live: boolean;
  onDecide: (flagId: string, outcome: "approve" | "stop", comment: string) => Promise<void>;
  onSelect: (id: string) => void;
}) {
  const [comments, setComments] = useState<Record<string, string>>({});
  const open = flags.filter((f) => f.status === "open").sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.ts.localeCompare(a.ts));
  const decided = flags.filter((f) => f.status !== "open").sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""));
  const byId = new Map(events.map((e) => [e.id, e]));

  return (
    <div className="flex flex-col gap-3">
      {open.length === 0 && <div className="muted text-sm">Keine offenen Konflikte. ✅</div>}
      {open.map((f) => {
        const sev = SEVERITY_STYLE[f.severity];
        const src = byId.get(f.eventIds[0]);
        return (
          <div key={f.id} className="rounded-lg p-3 border" style={{ borderColor: sev.color, background: "#fff" }}>
            <div className="flex items-center justify-between">
              <span className="mono text-[11px] font-bold" style={{ color: sev.color }}>
                {sev.label}
              </span>
              <span className="mono text-[11px] muted">{timeLabel(f.ts)}</span>
            </div>
            <button className="text-left font-semibold text-sm mt-1 hover:underline" onClick={() => wallsFor(f.elementId)[0] && onSelect(wallsFor(f.elementId)[0])}>
              {f.title}
            </button>
            <p className="text-sm mt-1 text-[var(--text)]/90">{f.reason}</p>
            {src && (
              <p className="text-xs muted mt-1.5">
                Quelle: {SOURCE_ICON[src.source]} {src.sender} – „{src.rawText.slice(0, 90)}“
              </p>
            )}
            {live && (
              <>
                <input
                  className="input mt-2"
                  placeholder="Kommentar an die Baustelle (optional)"
                  value={comments[f.id] ?? ""}
                  onChange={(e) => setComments({ ...comments, [f.id]: e.target.value })}
                />
                <div className="flex gap-2 mt-2">
                  <button className="btn flex-1 !border-red-600 !text-red-700" onClick={() => onDecide(f.id, "stop", comments[f.id] ?? "")}>
                    🛑 Stopp
                  </button>
                  <button className="btn flex-1" onClick={() => onDecide(f.id, "approve", comments[f.id] ?? "")}>
                    ✅ Freigeben
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
      {decided.length > 0 && (
        <>
          <div className="mono text-[11px] muted mt-2 tracking-wider">ENTSCHIEDEN</div>
          {decided.map((f) => (
            <div key={f.id} className="rounded-lg p-2.5 border border-[var(--line)] text-sm">
              <div className="flex justify-between">
                <span>{f.status === "stopped" ? "🛑 Gestoppt" : "✅ Freigegeben"}</span>
                <span className="mono text-[11px] muted">{f.decidedAt && timeLabel(f.decidedAt)}</span>
              </div>
              <div className="muted mt-0.5">{f.title}</div>
              <div className="text-xs mt-0.5">
                von {f.decidedBy}
                {f.comment && <> – „{f.comment}“</>}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------- Element details ---------------- */

export function ElementPanel({ wall, events, flags, onClose }: { wall: WallState; events: SiteEvent[]; flags: Flag[]; onClose: () => void }) {
  const byId = new Map(events.map((e) => [e.id, e]));
  const history = wall.history.map((id) => byId.get(id)).filter((e): e is SiteEvent => !!e).reverse();
  const own = flags.filter((f) => wallsFor(f.elementId).includes(wall.id) && f.rule !== "low_confidence");
  return (
    <div className="panel p-3 w-80 max-w-[calc(100vw-32px)] max-h-[60vh] overflow-auto shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="mono text-[11px] accent">{wall.id}</div>
          <div className="font-semibold">{elementName(wall.id)}</div>
        </div>
        <button className="btn !px-2 !py-0.5" onClick={onClose} aria-label="Schließen">
          ✕
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
        <div>
          <div className="muted text-xs">Status</div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOR[wall.status] }} />
            {STATUS_LABEL[wall.status]}
            {wall.closePlanned && <span className="muted text-xs">(Schließen geplant)</span>}
          </div>
        </div>
        <div>
          <div className="muted text-xs">Gültiger Plan</div>
          <div>Rev {wall.currentRev}</div>
        </div>
        <div className="col-span-2">
          <div className="muted text-xs">Rev {wall.currentRev} bestätigt von</div>
          <div>{wall.acks.length ? wall.acks.join(", ") : "noch niemandem"}</div>
        </div>
      </div>
      {own.length > 0 && (
        <div className="mt-3">
          <div className="muted text-xs mb-1">Konflikte</div>
          {own.map((f) => (
            <div key={f.id} className="text-sm" style={{ color: f.status === "open" ? SEVERITY_STYLE[f.severity].color : undefined }}>
              {f.status === "open" ? "⚠" : f.status === "stopped" ? "🛑" : "✅"} {f.title}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3">
        <div className="muted text-xs mb-1">Verlauf – wer hat was geändert</div>
        <ol className="flex flex-col gap-1.5">
          {history.map((e) => (
            <li key={e.id} className="text-xs border-l-2 border-[var(--line)] pl-2">
              <span className="mono muted">{timeLabel(e.ts)}</span> · <span className="accent">{ACTION_LABEL[e.action]}</span>
              {e.drawingRev && <> · Rev {e.drawingRev}</>}
              <div>
                {SOURCE_ICON[e.source]} {e.actor} <span className="muted">({e.trade})</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
