"""Was der Übersetzer aus einer Quelle macht – das Ausgabeformat für Claude (Structured Outputs).

Die Felder entsprechen 1:1 den Spalten von `eintraege` und `plaene` in uebersetzer/schema.sql.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

EintragArt = Literal[
    "arbeit_erledigt",
    "arbeit_geplant",
    "anweisung",
    "planaenderung",
    "abnahme",
    "behinderung",
    "lieferung",
    "bestaetigung",
    "problem_behoben",
    "frage",
    "sonstiges",
]


class Eintrag(BaseModel):
    """Ein strukturierter Eintrag: was, wo, wer, wann, nach welchem Plan."""

    art: EintragArt
    zusammenfassung: str = Field(description="Ein kurzer deutscher Satz, was passiert ist oder passieren soll.")
    person: Optional[str] = Field(description="Wer, wie im Original geschrieben, z. B. 'Thomas Meier (Krenn Bau)'.")
    firma: Optional[str]
    gewerk: Optional[str] = Field(description="elektro, gu, planung, trockenbau, maler, sanitaer, grosshandel, kaeufer, …")
    top: Optional[str] = Field(description="Exakt wie in der Liste der Tops, z. B. 'Top 5' oder 'TG'.")
    raum: Optional[str]
    element: Optional[str] = Field(description="Bauteil, z. B. 'Wohnungsverteiler', 'Deckenauslass', 'Steckdose'.")
    taetigkeit: Optional[str] = Field(description="Normalisiert, z. B. 'Steckdosen setzen', 'Verteiler versetzen'.")
    menge: Optional[float]
    einheit: Optional[str]
    lv_pos_nr: Optional[str] = Field(description="Passende LV-Position, nur wenn eindeutig.")
    plan_nr: Optional[str] = Field(description="Plan, nach dem gearbeitet wurde/wird, z. B. 'E-05'. Nur zusammen mit plan_index.")
    plan_index: Optional[str] = Field(
        description="NUR der Index, nach dem diese Arbeit ausgeführt wurde oder ausgeführt werden soll, z. B. 'B'. "
        "Ein Plan, der nur erwähnt, ausgegeben oder für ungültig erklärt wird, gehört NICHT hierher (→ null)."
    )
    entschieden_von: Optional[str] = Field(description="Bei Anweisungen und Planänderungen: wer hat es entschieden.")
    wartet_auf: Optional[str] = Field(description="Worauf/auf wen gewartet wird, z. B. 'Trockenbau', 'Freigabe GU'.")
    zitat: Optional[str] = Field(description="Die relevante Stelle aus der Quelle, wörtlich und kurz.")
    konfidenz: float = Field(description="0 bis 1: wie sicher die Zuordnung ist.")
    unklar: bool
    rueckfrage: Optional[str] = Field(description="Was man nachfragen müsste, statt zu raten.")


class Plan(BaseModel):
    """Ein Plan-Index, den diese Quelle ausgibt oder enthält (Plan-PDF, Mail des Planers)."""

    plan_nr: str = Field(description="z. B. 'E-05'")
    plan_index: str = Field(description="z. B. 'C'")
    bezeichnung: Optional[str]
    top: Optional[str]
    aenderung: Optional[str] = Field(description="Was sich gegenüber dem vorherigen Index ändert.")


class Ergebnis(BaseModel):
    eintraege: list[Eintrag]
    plaene: list[Plan]


# --- Prüf-Agent -------------------------------------------------------------

class SignalVorschlag(BaseModel):
    """Eine Abweichung, die Claude in den neuen Einträgen erkennt."""

    art: Literal["reihenfolge", "abweichung_plan", "nicht_weitergegeben", "sonstiges"]
    schwere: Literal["kritisch", "hoch", "mittel"] = Field(
        description="kritisch = gleich Nacharbeit/Schaden, wenn niemand eingreift; hoch = Nacharbeit wahrscheinlich; mittel = klären."
    )
    kurzschluessel: str = Field(description="Stabiler Kurzname ohne Leerzeichen, z. B. 'top3-wand-zu-vor-installation'.")
    titel: str = Field(description="Kurz, für die Liste im Zwilling.")
    begruendung: str = Field(description="Warum das eine Abweichung ist, mit Bezug auf Plan, LV oder Reihenfolge.")
    anruf_text: str = Field(description="Was der Telefon-Agent dem Vorarbeiter sagt: 2–3 Sätze, Du-Form, konkret.")
    zustaendig: Optional[str] = Field(description="Wer angerufen werden soll, wie in den Einträgen geschrieben.")
    top: Optional[str]
    raum: Optional[str]
    element: Optional[str]
    eintrag_nrs: list[int] = Field(description="Nummern der neuen Einträge, die das Signal auslösen.")


class SignalGeloest(BaseModel):
    schluessel: str = Field(description="Schlüssel eines offenen Signals aus der Liste.")
    eintrag_nr: int = Field(description="Nummer des neuen Eintrags, der die Lösung belegt.")
    begruendung: str


class Pruefergebnis(BaseModel):
    signale: list[SignalVorschlag]
    geloest: list[SignalGeloest]
