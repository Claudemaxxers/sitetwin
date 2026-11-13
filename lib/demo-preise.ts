import type { Schaetzung } from "./vm";

/**
 * Demo estimates for changes whose messages carry no quantity.
 * Taken from the team's golden set (fake_data/ERWARTET.md): LV unit prices and the
 * Regie rate of 62 €/h applied to what the site said. Used only when nothing can be
 * calculated from the record itself; keyed by "<Top>|<theme>".
 */
export const DEMO_SCHAETZUNG: Record<string, Schaetzung> = {
  "Top 4|steckdose": { betrag: 115.5, grundlage: "3 × 38,50 € Schukosteckdose (LV 02.02.010)", quelle: "kalkulation" },
  "Top 7|datendose": { betrag: 132.5, grundlage: "89,00 € Datendose + ~15 lfm × 2,90 € Cat6 (LV 02.04.010/020)", quelle: "kalkulation" },
  "TG|wallbox": { betrag: 280, grundlage: "~35 lfm M32, keine LV-Position, Preis neu gebildet", quelle: "kalkulation" },
  "Top 5|verteiler": { betrag: 372, grundlage: "6 h × 62,00 € Regie (Umbau nach Index C)", quelle: "kalkulation" },
  "Top 3|wartezeit": { betrag: 372, grundlage: "2 Monteure × 3 h × 62,00 € Regie", quelle: "kalkulation" },
  "Top 2|auslass": { betrag: 110, grundlage: "1,5 h × 62,00 € + 3 m Rohr und Kabel", quelle: "kalkulation" },
};
