import type { ReactNode } from "react";

/** Small building blocks in Talona's look (TALONA.md §4). */

type Tone = "accent" | "ok" | "info" | "plain";

const PILL: Record<Tone, string> = {
  accent: "bg-[#fdeee5] text-[#b5521f]",
  ok: "bg-[#e7f2ea] text-[#2f7a46]",
  info: "bg-[var(--spring-light)] text-[#355fa8]",
  plain: "bg-[var(--panel-2)] text-[var(--muted)]",
};

export function Pill({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-[11px] leading-4 ${PILL[tone]}`}>{children}</span>;
}

export function Kuerzel({ children, size = 28, tone = "plain" }: { children: ReactNode; size?: number; tone?: "plain" | "info" | "accent" }) {
  const cls = tone === "info" ? "bg-[var(--spring-light)] text-[#355fa8]" : tone === "accent" ? "bg-[#fdeee5] text-[#b5521f]" : "bg-[var(--panel-2)] text-[var(--text)]";
  return (
    <span className={`mono inline-flex shrink-0 items-center justify-center rounded-full text-[10px] ${cls}`} style={{ width: size, height: size }}>
      {children}
    </span>
  );
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`label ${className}`}>{children}</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[4px] border border-[var(--line)] bg-white ${className}`}>{children}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-5 border-b border-[var(--line)] text-[13px]">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={`-mb-px border-b-2 pb-2 ${value === t.key ? "border-[var(--text)]" : "muted border-transparent hover:text-[var(--text)]"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageTitle({ eyebrow, title, right }: { eyebrow?: ReactNode; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div>
        {eyebrow && <div className="muted mb-1 text-[12px]">{eyebrow}</div>}
        <h1 className="text-[28px] leading-8 tracking-[-0.02em]">{title}</h1>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
