import type { ReactNode, SVGProps } from "react";
import type { Person, Ton } from "@/lib/vm";

/** Building blocks in Talona's look (TALONA.md §4): Hanken Grotesk, ink, warm grey, one orange. */

const PILL: Record<Ton, string> = {
  grau: "bg-[#ebe8e5] text-[rgba(12,10,8,.7)]",
  blau: "bg-[#e4ebf6] text-[#3b63a8]",
  gruen: "bg-[#e3efe5] text-[#2f6b40]",
  orange: "bg-[#fbe6d8] text-[#b45624]",
  amber: "bg-[#f6ecd2] text-[#8a651a]",
  rot: "bg-[#f8e1dd] text-[#a63a2b]",
};

export function Pill({ ton = "grau", children, className = "" }: { ton?: Ton; children: ReactNode; className?: string }) {
  return <span className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] px-2 text-[11px] leading-none ${PILL[ton]} ${className}`}>{children}</span>;
}

export function Avatar({ p, size = 32 }: { p: Pick<Person, "initialen" | "farbe" | "name">; size?: number }) {
  return (
    <span title={p.name} className="inline-flex shrink-0 items-center justify-center rounded-full text-[#3f3a35]" style={{ width: size, height: size, background: p.farbe, fontSize: Math.max(10, size * 0.34) }}>
      {p.initialen}
    </span>
  );
}

export function Kuerzel({ children, size = 32 }: { children: ReactNode; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#ebe8e5] text-[11px] text-[rgba(12,10,8,.7)]" style={{ width: size, height: size }}>
      {children}
    </span>
  );
}

/** Talona's record chip: small bordered tag with a source icon and a name. */
export function QuelleChip({ typ, foto, audio, children }: { typ: string | null; foto?: boolean; audio?: boolean; children: ReactNode }) {
  const Icon = audio ? I.Mic : foto ? I.Camera : typ === "email" ? I.Mail : typ === "call" ? I.Phone : I.Chat;
  return (
    <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[4px] border border-[var(--line)] bg-[var(--wash)] px-1.5 text-[11px] leading-none text-[rgba(12,10,8,.6)]">
      <Icon className="size-3" />
      {children}
    </span>
  );
}

export function MonoLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mono text-[10px] uppercase tracking-[0.06em] text-[rgba(12,10,8,.55)] ${className}`}>{children}</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[6px] border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(12,10,8,.04)] ${className}`}>{children}</div>;
}

export function H2({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-[20px] leading-7 tracking-[-0.01em] ${className}`}>{children}</h2>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-8 border-b border-[var(--line)] text-[15px]">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={`-mb-px border-b-2 pb-3 ${value === t.key ? "border-[var(--text)]" : "border-transparent text-[rgba(12,10,8,.6)] hover:text-[var(--text)]"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageHead({ eyebrow, title, right }: { eyebrow?: ReactNode; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[14px] text-[rgba(12,10,8,.6)]">{eyebrow}</div>}
        <h1 className="text-[40px] leading-[46px] tracking-[-0.02em]">{title}</h1>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2 pt-1">{right}</div>}
    </div>
  );
}

export function Btn({ children, onClick, primary, className = "", title }: { children: ReactNode; onClick?: () => void; primary?: boolean; className?: string; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-[3px] px-4 text-[15px] transition ${primary ? "bg-[var(--accent)] text-white hover:bg-[#d9652a]" : "border border-[var(--line)] bg-white hover:border-[rgba(12,10,8,.35)]"} ${className}`}
    >
      {children}
    </button>
  );
}

export function Feld({ label, children, icon, pflicht }: { label: string; children: ReactNode; icon?: ReactNode; pflicht?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[4px] border border-[var(--line)] bg-white px-4 py-3">
      <div className="min-w-0">
        <div className="text-[12px] text-[rgba(12,10,8,.6)]">
          {label}
          {pflicht && " *"}
        </div>
        <div className="mt-1 text-[16px]">{children}</div>
      </div>
      {icon}
    </div>
  );
}

export function Suche({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-10 w-80 items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 text-[14px] focus-within:border-[rgba(12,10,8,.35)]">
      <I.Search className="size-4 text-[rgba(12,10,8,.45)]" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-transparent outline-none placeholder:text-[rgba(12,10,8,.45)]" />
    </label>
  );
}

/** Waveform like Talona's voice-note bubble. */
export function Welle({ n = 22, className = "" }: { n?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[2px] ${className}`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="w-[2px] rounded-full bg-current" style={{ height: 4 + (((i * 7) % 11) + ((i * 3) % 5)) * 1.1 }} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Icons: 1.5px stroke, like Talona's                                  */
/* ------------------------------------------------------------------ */

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({ width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...p });

export const I = {
  Chart: (p: P) => (
    <svg {...base(p)}>
      <path d="M5 20V12M10 20V6M15 20v-9M20 20V9" />
    </svg>
  ),
  Inbox: (p: P) => (
    <svg {...base(p)}>
      <path d="M3 13l2.4-7.2A2 2 0 0 1 7.3 4.5h9.4a2 2 0 0 1 1.9 1.3L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 13h5l1.5 2.5h5L16 13h5" />
    </svg>
  ),
  Calendar: (p: P) => (
    <svg {...base(p)}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  ),
  Layers: (p: P) => (
    <svg {...base(p)}>
      <path d="M12 3l9 4.5-9 4.5-9-4.5z" />
      <path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5" />
    </svg>
  ),
  Cube: (p: P) => (
    <svg {...base(p)}>
      <path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z" />
      <path d="M12 12l8.5-4.75M12 12v9.5M12 12L3.5 7.25" />
    </svg>
  ),
  Bell: (p: P) => (
    <svg {...base(p)}>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  ),
  Grid: (p: P) => (
    <svg {...base(p)}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
    </svg>
  ),
  Search: (p: P) => (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </svg>
  ),
  ChevronLeft: (p: P) => (
    <svg {...base(p)}>
      <path d="M14.5 6l-6 6 6 6" />
    </svg>
  ),
  ChevronRight: (p: P) => (
    <svg {...base(p)}>
      <path d="M9.5 6l6 6-6 6" />
    </svg>
  ),
  ChevronDown: (p: P) => (
    <svg {...base(p)}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  ),
  Sparkle: (p: P) => (
    <svg {...base(p)}>
      <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z" />
    </svg>
  ),
  Tag: (p: P) => (
    <svg {...base(p)}>
      <path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z" />
      <circle cx="8" cy="8" r="1.3" />
    </svg>
  ),
  Book: (p: P) => (
    <svg {...base(p)}>
      <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z" />
      <path d="M12 6.5v13" />
    </svg>
  ),
  Users: (p: P) => (
    <svg {...base(p)}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M16.5 14.5c2.4.2 4 1.7 4.5 4.5" />
    </svg>
  ),
  Mic: (p: P) => (
    <svg {...base(p)}>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </svg>
  ),
  Camera: (p: P) => (
    <svg {...base(p)}>
      <path d="M3.5 8.5a2 2 0 0 1 2-2H8l1.5-2h5L16 6.5h2.5a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  ),
  Mail: (p: P) => (
    <svg {...base(p)}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  ),
  Phone: (p: P) => (
    <svg {...base(p)}>
      <path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4z" />
    </svg>
  ),
  Chat: (p: P) => (
    <svg {...base(p)}>
      <path d="M4 17.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H8z" />
    </svg>
  ),
  Check: (p: P) => (
    <svg {...base(p)}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  Play: (p: P) => (
    <svg {...base({ ...p, fill: "currentColor", stroke: "none" })}>
      <path d="M7 4.5v15l12.5-7.5z" />
    </svg>
  ),
  Pause: (p: P) => (
    <svg {...base({ ...p, fill: "currentColor", stroke: "none" })}>
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </svg>
  ),
  X: (p: P) => (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  File: (p: P) => (
    <svg {...base(p)}>
      <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z" />
      <path d="M14 3.5V8h4" />
    </svg>
  ),
  Plus: (p: P) => (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Branch: (p: P) => (
    <svg {...base(p)}>
      <path d="M6 4v16M6 12h7a4 4 0 0 0 4-4V6" />
    </svg>
  ),
};

/** Talona's mark-like logo for the rail; our three-storey mark. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden>
      <rect x="3" y="15" width="20" height="7" rx="1.5" fill="#0c0a08" />
      <rect x="3" y="9.5" width="20" height="4.5" rx="1.2" fill="#0c0a08" opacity=".55" />
      <rect x="3" y="4" width="20" height="4.5" rx="1.2" fill="#ee783b" />
    </svg>
  );
}

export const eur = (n: number, d = 2) => n.toLocaleString("de-AT", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d });
export const eurK = (n: number) => (n >= 1000 ? `€${(n / 1000).toLocaleString("de-AT", { maximumFractionDigits: 1 })}K` : `€${Math.round(n)}`);
export const zeit = (iso: string | number | null) => (iso ? new Date(iso).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" }) : "");
export const tagKurz = (iso: string | number | null) =>
  iso ? new Date(iso).toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Vienna" }).replace(/\.,/, ",") : "";
export const tagZeit = (iso: string | number | null) => (iso ? `${tagKurz(iso)} ${zeit(iso)}` : "");
export const tagLang = (iso: string | number | null) =>
  iso ? new Date(iso).toLocaleDateString("de-AT", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "Europe/Vienna" }) : "";
export const datumIso = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" });
