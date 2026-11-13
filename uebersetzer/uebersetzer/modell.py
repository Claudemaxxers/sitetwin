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
    "soll_aenderung",  # das Soll ändert sich während der Bauphase ("Keller nur 3x3", "haben wir geändert")
    "freigabe",        # Bauleitung bestätigt oder lehnt eine vorgeschlagene Soll-Änderung ab
    "nachweis",        # Foto/PDF eines Dokuments, das eine Soll-Änderung schriftlich belegt
]


Schritt = Literal[
    "staenderwerk",        # Trockenbau: Ständer gestellt
    "verrohrung",          # Leerrohre verlegt
    "leitung_eingezogen",  # Kabel eingezogen / Leitungen verlegt
    "gesetzt",             # Dose, Verteiler, Auslass gesetzt
    "angeschlossen",       # Geräte angeschlossen, fertig montiert
    "abnahme",             # Prüfung/Abnahme bestanden
    "beplankung",          # Wand geschlossen / beplankt / zugemacht
    "spachteln",
    "malen",
    "montage",             # Endmontage (z. B. Rauchmelder)
    "rueckbau",            # Ausbau / Rausreißen
    "sonstiges",
]

BauteilArt = Literal["wand", "leitung", "dose", "verteiler", "auslass", "schalter", "melder", "sonstiges"]


class SollElement(BaseModel):
    """Ein Bauteil, das ein Plan vorsieht."""

    bezeichnung: str = Field(description="Wie im Plan, eindeutig innerhalb des Raums, z. B. 'Wand B1', 'Steckdose Waschtisch'.")
    art: BauteilArt
    top: str = Field(description="Exakt wie in der Liste der Tops, z. B. 'Top 3'.")
    raum: str
    lage: Optional[str] = Field(description="Lage/Details laut Plan, z. B. 'h=110 cm, Arbeitsplatte', 'Stromkreis F4'.")
    anzahl: int
    gehoert_zu: Optional[str] = Field(description="Bezeichnung des Bauteils, in dem es sitzt (meist die Wand), sonst null.")


class SollDetails(BaseModel):
    """Details zu einem Eintrag der Art soll_aenderung, freigabe oder nachweis.
    Bewusst ohne optionale Felder (leer = ""): sonst wird das Ausgabeformat für Structured Outputs zu groß."""

    eintrag_nr: int = Field(description="Nummer des Eintrags in `eintraege` (1-basiert), zu dem diese Details gehören.")
    bezug: str = Field(description="Bei freigabe/nachweis: Schlüssel der offenen Soll-Änderung aus der Liste, sonst \"\".")
    entscheidung: Literal["ja", "nein", "keine"] = Field(description="Bei freigabe: ja = bestätigt, nein = abgelehnt. Sonst keine.")
    titel: str = Field(description="Bei soll_aenderung: kurzer Titel, z. B. 'Keller 3x3 m statt 3x4 m'. Sonst \"\".")
    neues_soll: str = Field(description="Bei soll_aenderung: was jetzt gelten soll, konkret. Sonst \"\".")
    bauteile_entfallen: list[str] = Field(description="Bei soll_aenderung: Schlüssel aus der Bauteil-Liste, die wegfallen oder verlegt werden.")

    def als_dict(self) -> dict:
        """Format, das in eintraege.soll gespeichert und von soll.py gelesen wird."""
        return {
            "bezug": self.bezug or None,
            "freigabe_ja": {"ja": True, "nein": False}.get(self.entscheidung),
            "titel": self.titel or None,
            "neues_soll": self.neues_soll or None,
            "bauteile_entfallen": self.bauteile_entfallen,
        }


class Eintrag(BaseModel):
    """Ein strukturierter Eintrag: was, wo, wer, wann, nach welchem Plan."""

    art: EintragArt
    zusammenfassung: str = Field(description="Ein kurzer deutscher Satz, was passiert ist oder passieren soll.")
    person: Optional[str] = Field(description="Wer, wie im Original geschrieben, z. B. 'Thomas Meier (Krenn Bau)'.")
    gewerk: Optional[str] = Field(description="elektro, gu, planung, trockenbau, maler, sanitaer, grosshandel, kaeufer, …")
    top: Optional[str] = Field(description="Exakt wie in der Liste der Tops, z. B. 'Top 5' oder 'TG'.")
    raum: Optional[str]
    element: Optional[str] = Field(description="Bauteil, z. B. 'Wohnungsverteiler', 'Deckenauslass', 'Steckdose'.")
    # Für die Mehrkosten im Frontend (lib/twin-model.ts). Pflichtfelder statt optional, sonst wird das
    # Ausgabeformat für Structured Outputs zu groß: leer = "" bzw. 0.
    taetigkeit: str = Field(description="Normalisiert, z. B. 'Steckdosen setzen', 'Verteiler versetzen'. Sonst \"\".")
    menge: float = Field(description="Menge, falls genannt (z. B. 3 Stück, 35 m, 6 h). Sonst 0.")
    einheit: str = Field(description="Einheit zur Menge: Stk, lfm, m, h. Sonst \"\".")
    lv_pos_nr: Optional[str] = Field(description="Passende LV-Position, nur wenn eindeutig.")
    plan_nr: Optional[str] = Field(description="Plan, nach dem gearbeitet wurde/wird, z. B. 'E-05'. Nur zusammen mit plan_index.")
    plan_index: Optional[str] = Field(
        description="NUR der Index, nach dem diese Arbeit ausgeführt wurde oder ausgeführt werden soll, z. B. 'B'. "
        "Ein Plan, der nur erwähnt, ausgegeben oder für ungültig erklärt wird, gehört NICHT hierher (→ null)."
    )
    entschieden_von: Optional[str] = Field(description="Bei Anweisungen und Planänderungen: wer hat es entschieden.")
    wartet_auf: Optional[str] = Field(description="Worauf/auf wen gewartet wird, z. B. 'Trockenbau', 'Freigabe GU'.")
    zitat: Optional[str] = Field(description="Die relevante Stelle aus der Quelle, wörtlich und kurz.")
    bauteil: Optional[str] = Field(
        description="Schlüssel des betroffenen Bauteils exakt aus der Bauteil-Liste, z. B. 'top 3|bad|wand b1'. "
        "Nur wenn eindeutig, sonst null."
    )
    schritt: Optional[Schritt] = Field(description="Welcher Arbeitsschritt am Bauteil, nur bei Arbeit.")
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
    soll: list[SollDetails] = Field(description="Je ein Element pro Eintrag der Art soll_aenderung, freigabe oder nachweis. Sonst leer.")
    elemente: list[SollElement] = Field(
        description="Bei Plandokumenten: alle Bauteile, die der Plan in diesem Index vorsieht. "
        "Bei einer soll_aenderung: die Bauteile, die es dadurch neu bzw. an neuer Stelle gibt. Sonst leere Liste."
    )


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
