"""Erzeugt den fiktiven Elektro-Ausführungsplan E-03 für Top 3 (Index A) mit Wänden und Bauteilen.

Testdaten für das Bauteil-Register: Die bestehenden Pläne (E-05) nennen nur den Verteiler.
Dieser Plan listet je Trockenbauwand die Leitungen und Dosen darin, damit SiteTwin erkennen kann,
ob eine Wand geschlossen wird, bevor ihre Installation fertig ist.

    uv run python werkzeuge/plan_top3.py   # schreibt fake_data/drive/Projekt_Simmering/Plaene/Plan_E-03_Top3_IndexA.pdf
"""

from pathlib import Path

from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas

ZIEL = Path(__file__).resolve().parents[2] / "fake_data/drive/Projekt_Simmering/Plaene/Plan_E-03_Top3_IndexA.pdf"

KOPF = [
    ("Helvetica-Bold", 14, "Plan E-03  |  Top 3, 1. OG  |  Elektroinstallation"),
    ("Helvetica", 9, "BV Simmeringer Hauptstraße 112 – TB Lechner Elektroplanung – M 1:50 (schematisch, fiktiv)"),
    ("Helvetica-Bold", 10, "Index A   Datum 28.10.2026   Ausführungsplan"),
    ("Helvetica", 9, "Räume: Vorraum, Wohnzimmer, Küche, Schlafzimmer, Kinderzimmer, Bad, WC"),
    ("Helvetica", 9, "Trockenbauwände (Novak Trockenbau): erst schließen, wenn Installation gesetzt und Elektro-Abnahme erfolgt ist."),
]

WAENDE = [
    ("Wand W3-01", "Vorraum | Wohnzimmer", [
        "Leitung F2 Licht Wohnzimmer (NYM 3x1,5 im Leerrohr M20)",
        "Schalter Licht Wohnzimmer, Vorraum-Seite, h=105 cm (F2)",
        "Leitung F3 Steckdosen Wohnzimmer (NYM 3x2,5 im Leerrohr M20)",
        "Steckdose 2-fach Wohnzimmer, h=30 cm (F3)",
    ]),
    ("Wand W3-02", "Bad | Schlafzimmer", [
        "Leitung F5 Bad (NYM 3x2,5 im Leerrohr M20)",
        "Steckdose IP44 Waschtisch, Bad-Seite, h=110 cm (F5)",
        "Steckdose IP44 Waschmaschine, Bad-Seite, h=110 cm (F5)",
        "Schalter Licht Bad, Bad-Seite, h=105 cm (F1)",
    ]),
    ("Wand W3-03", "Schlafzimmer | Kinderzimmer", [
        "Leitung F6 Steckdosen Kinderzimmer (NYM 3x2,5 im Leerrohr M20)",
        "Steckdose 2-fach Kinderzimmer, h=30 cm (F6)",
        "Datendose Cat6 doppelt Schlafzimmer, h=30 cm",
    ]),
    ("Wand W3-04", "Küche | Vorraum", [
        "Leitung F7 Herd (NYM 5x2,5 im Leerrohr M25)",
        "Herdanschlussdose Küche, h=60 cm (F7)",
        "Leitung F8 Arbeitsplatte (NYM 3x2,5 im Leerrohr M20)",
        "Steckdosen Arbeitsplatte Küche, 6 Stk, h=110 cm (F8)",
    ]),
    ("Wand W3-05", "WC | Vorraum", [
        "Leitung F1 Licht WC/Bad (NYM 3x1,5 im Leerrohr M20)",
        "Schalter Licht WC, Vorraum-Seite, h=105 cm (F1)",
        "Wohnungsverteiler UP 3-reihig, Vorraum-Seite, h=160 cm",
    ]),
]


def main() -> None:
    ZIEL.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(ZIEL), pagesize=landscape(A4))
    breite, hoehe = landscape(A4)
    y = hoehe - 40
    for schrift, groesse, text in KOPF:
        c.setFont(schrift, groesse)
        c.drawString(40, y, text)
        y -= groesse + 8
    y -= 6
    spalte_x = [40, 300, 560]
    for i, (wand, raeume, bauteile) in enumerate(WAENDE):
        x = spalte_x[i % 3]
        if i % 3 == 0 and i:
            y -= 150
        c.setFont("Helvetica-Bold", 10)
        c.drawString(x, y, f"{wand}  ({raeume})")
        c.setFont("Helvetica", 8)
        for j, b in enumerate(bauteile):
            c.drawString(x + 8, y - 14 - j * 12, f"- {b}")
    c.setFont("Helvetica", 8)
    c.drawString(40, 30, "Stromkreise lt. Verteilerplan Top 3: F1 Licht WC/Bad, F2 Licht Wohnen, F3 Steckdosen Wohnen, F5 Bad, F6 Kinderzimmer, F7 Herd, F8 Küche")
    c.showPage()
    c.save()
    print(f"geschrieben: {ZIEL}")


if __name__ == "__main__":
    main()
