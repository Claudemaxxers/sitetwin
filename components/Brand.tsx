import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect x="3" y="15" width="20" height="7" rx="1.5" fill="#0c0a08" />
        <rect x="3" y="9.5" width="20" height="4.5" rx="1.2" fill="#0c0a08" opacity=".55" />
        <rect x="3" y="4" width="20" height="4.5" rx="1.2" fill="#ee783b" />
      </svg>
      <span className="text-[17px] tracking-tight">SiteTwin</span>
    </Link>
  );
}

/** The customer company in the corner (demo: the general contractor of BV Simmering). */
export function Firma() {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <div className="text-sm">Krenn Bau GmbH</div>
        <div className="label">Generalunternehmer</div>
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--text)] text-xs text-white">KB</div>
    </div>
  );
}
