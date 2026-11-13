"use client";

import { useState } from "react";
import type { EintragArt, ProjektDaten } from "@/lib/twin-model";
import { gewerkLabel, kurzName, ort, tag, tagKey, tagTitel, uhrzeit } from "@/lib/talona";
import type { Nav } from "./AppShell";
import { Card, PageTitle, Pill, Tabs } from "./ui";

type Filter = "alle" | "erledigt" | "aenderung" | "behinderung" | "anfrage";
const FILTER: Record<Filter, EintragArt[] | null> = {
  alle: null,
  erledigt: ["arbeit_erledigt", "abnahme", "problem_behoben"],
  aenderung: ["planaenderung", "anweisung", "soll_aenderung" as EintragArt],
  behinderung: ["behinderung"],
  anfrage: ["frage"],
};

/** Talona's project record: one line per fact, grouped by day. */
export function RecordView({ daten, nav, neu }: { daten: ProjektDaten; nav: Nav; neu: Set<string> }) {
  const [f, setF] = useState<Filter>("alle");
  const liste = daten.eintraege.filter((e) => !FILTER[f] || FILTER[f]!.includes(e.art)).filter((e) => e.art !== "sonstiges" || e.top);
  const tage = [...new Set(liste.map((e) => tagKey(e.zeitpunkt)))].sort().reverse();

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <PageTitle title="Protokoll" eyebrow={`${daten.projekt.name ?? daten.projekt.projekt} · ${daten.eintraege.length} Einträge`} />
      <div className="mt-5">
        <Tabs<Filter>
          value={f}
          onChange={setF}
          tabs={[
            { key: "alle", label: "Alle" },
            { key: "erledigt", label: "Erledigt" },
            { key: "aenderung", label: "Änderungen" },
            { key: "behinderung", label: "Behinderungen" },
            { key: "anfrage", label: "Anfragen" },
          ]}
        />
      </div>
      {tage.map((t) => {
        const items = liste.filter((e) => tagKey(e.zeitpunkt) === t).sort((a, b) => (b.zeitpunkt ?? "").localeCompare(a.zeitpunkt ?? ""));
        return (
          <Card key={t} className="mt-5 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
              <span className="text-[15px]">{tagTitel(items[0]?.zeitpunkt ?? null)}</span>
              <span className="muted text-[12px]">
                {items.length} {items.length === 1 ? "Eintrag" : "Einträge"}
              </span>
            </div>
            {items.map((e) => (
              <button
                key={e.id}
                onClick={() => nav.zuNachricht(e.quelle_hash)}
                className={`grid w-full grid-cols-[64px_minmax(0,1fr)_150px_140px] items-center gap-4 border-b border-[var(--line)] px-5 py-2.5 text-left text-[13px] last:border-0 hover:bg-[var(--wash)] ${neu.has(e.id) ? "flash" : ""}`}
              >
                <span className="mono muted text-[12px]">{uhrzeit(e.zeitpunkt)}</span>
                <span className="min-w-0">
                  <span className="block truncate">{e.zusammenfassung}</span>
                  <span className="muted block truncate text-[12px]">
                    {ort(e.top, e.raum)} · {gewerkLabel(e.gewerk)}
                  </span>
                </span>
                <span className="muted truncate">{kurzName(e.person)}</span>
                <span className="text-right">
                  <Pill tone={tag(e.art).tone}>{tag(e.art).label}</Pill>
                </span>
              </button>
            ))}
          </Card>
        );
      })}
    </div>
  );
}
