"""Tests ohne Claude und ohne Supabase: Pipeline, Idempotenz, Pläne, Fehlerbehandlung."""

from pathlib import Path

import pytest

from uebersetzer import testquellen
from uebersetzer.db import SpeicherDB
from uebersetzer.extraktion import ExtraktionsFehler
from uebersetzer.lauf import verarbeite, zeitachse_vor
from uebersetzer.modell import Eintrag, Ergebnis, Plan

FAKE = Path(__file__).resolve().parents[2] / "fake_data"
PROJEKT = "BV Simmering"


def eintrag(**kw) -> Eintrag:
    basis = dict(
        art="arbeit_erledigt", zusammenfassung="x", person=None, gewerk=None, top=None, raum=None,
        element=None, taetigkeit="", menge=0, einheit="", lv_pos_nr=None, plan_nr=None, plan_index=None,
        entschieden_von=None, wartet_auf=None, zitat=None, bauteil=None, schritt=None, konfidenz=0.9, unklar=False, rueckfrage=None,
    )
    return Eintrag(**{**basis, **kw})


@pytest.fixture
def db(tmp_path):
    quellen = testquellen.alle(FAKE, PROJEKT, tmp_path)
    tops, lv = testquellen.stammdaten_aus_csv(FAKE / "drive" / "Projekt_Simmering", PROJEKT)
    return SpeicherDB(quellen, tops, lv)


def test_testquellen_mengen(db):
    typen = [q["typ"] for q in db.quellen]
    assert typen.count("whatsapp") == 39
    assert typen.count("email") == 8  # 6 Mails + 2 PDF-Anhänge
    assert typen.count("drive") == 6  # inkl. Plan E-03 Top 3 (Bauteil-Register)
    assert typen.count("call") == 1
    assert len({q["content_hash"] for q in db.quellen}) == len(db.quellen)


def test_alles_wird_verarbeitet_und_ohne_llm_faelle_uebersprungen(db):
    aufrufe = []
    bericht = verarbeite(db, lambda s, m: aufrufe.append(m) or Ergebnis(eintraege=[], plaene=[], soll=[], elemente=[]), None)
    assert bericht.verarbeitet == 54 and not bericht.fehler
    # 3 Stammdaten-Dateien (2 CSV, 1 MD) + 1 gelöschte Nachricht brauchen kein Claude
    assert bericht.uebersprungen == 4
    assert len(aufrufe) == 50
    assert all(q["status"] == "verarbeitet" for q in db.quellen)


def test_zweiter_lauf_macht_nichts(db):
    verarbeite(db, lambda s, m: Ergebnis(eintraege=[eintrag()], plaene=[], soll=[], elemente=[]), None)
    anzahl = len(db.eintraege)
    bericht = verarbeite(db, lambda s, m: pytest.fail("darf nicht aufgerufen werden"), None)
    assert bericht.verarbeitet == 0 and len(db.eintraege) == anzahl


def test_neuverarbeitung_ersetzt_statt_verdoppelt(db):
    verarbeite(db, lambda s, m: Ergebnis(eintraege=[eintrag(), eintrag()], plaene=[], soll=[], elemente=[]), None)
    vorher = len(db.eintraege)
    for q in db.quellen:
        q["status"] = "neu"
    verarbeite(db, lambda s, m: Ergebnis(eintraege=[eintrag(), eintrag()], plaene=[], soll=[], elemente=[]), None)
    assert len(db.eintraege) == vorher
    assert {(e["quelle_hash"], e["nr"]) for e in db.eintraege}.__len__() == vorher


def test_top_wird_normalisiert_und_konfidenz_begrenzt(db):
    verarbeite(db, lambda s, m: Ergebnis(eintraege=[eintrag(top="top5", konfidenz=1.7)], plaene=[], soll=[], elemente=[]), None)
    e = db.eintraege[0]
    assert e["top"] == "Top 5" and e["konfidenz"] == 1.0
    assert e["projekt"] == PROJEKT and e["nr"] == 1


def test_gueltiger_plan_ist_der_neueste_index(db):
    def extr(system, messages):
        text = messages[0]["content"][-1]["text"]
        if "Index C" in text and "neue_quelle" in text and "IndexC" in text:
            return Ergebnis(eintraege=[], plaene=[Plan(plan_nr="E-05", plan_index="C", bezeichnung=None, top="Top 5", aenderung="Verteiler in Abstellraum")], soll=[], elemente=[])
        if "IndexB" in text:
            return Ergebnis(eintraege=[], plaene=[Plan(plan_nr="E-05", plan_index="B", bezeichnung=None, top="Top 5", aenderung=None)], soll=[], elemente=[])
        return Ergebnis(eintraege=[], plaene=[], soll=[], elemente=[])

    verarbeite(db, extr, None)
    aktuell = db.aktuelle_plaene(PROJEKT)
    assert [(p["plan_nr"], p["plan_index"]) for p in aktuell] == [("E-05", "C")]
    # Drive-PDF (ohne Datum) und Mail-Anhang (mit Datum) ergeben einen Plan C mit Ausgabedatum der Mail
    c = [p for p in db.plaene if p["plan_index"] == "C"]
    assert len(c) == 1 and c[0]["gueltig_ab"].startswith("2026-11-10")


def test_fehler_markiert_quelle_und_laeuft_weiter(db):
    def extr(system, messages):
        if "Steckdosen IP44" in messages[0]["content"][-1]["text"].split("<neue_quelle>")[1]:
            raise ExtraktionsFehler("kaputt")
        return Ergebnis(eintraege=[], plaene=[], soll=[], elemente=[])

    bericht = verarbeite(db, extr, None)
    fehler = [q for q in db.quellen if q["status"] == "fehler"]
    assert len(fehler) == 1 and fehler[0]["meta"]["fehler"].startswith("ExtraktionsFehler")
    assert bericht.verarbeitet == 53


def test_audio_ohne_transkript_wird_unklar(db):
    audio = next(q for q in db.quellen if q["anhang_typ"] == "audio")
    audio["text"] = ""
    verarbeite(db, lambda s, m: Ergebnis(eintraege=[], plaene=[], soll=[], elemente=[]), None)
    e = [e for e in db.eintraege if e["quelle_hash"] == audio["content_hash"]]
    assert len(e) == 1 and e[0]["unklar"] and e[0]["rueckfrage"]


def test_zeitachse_enthaelt_nur_fruehere_datierte_quellen(db):
    alle = db.projekt_quellen(PROJEKT)
    q = next(x for x in alle if "Index C für Top 5" in (x["text"] or ""))
    achse = zeitachse_vor(q, alle, 1000)
    assert achse and all(a["zeitpunkt"] and a["zeitpunkt"] <= q["zeitpunkt"] for a in achse)
    assert q not in achse
    assert len(zeitachse_vor(q, alle, 5)) == 5


def test_leere_mehrkosten_felder_werden_null():
    from uebersetzer.lauf import eintrag_zeile
    q = {"content_hash": "h", "zeitpunkt": None}
    leer = eintrag_zeile("P", q, 1, eintrag(), [])
    assert leer["taetigkeit"] is None and leer["menge"] is None and leer["einheit"] is None
    voll = eintrag_zeile("P", q, 1, eintrag(taetigkeit="Steckdosen setzen", menge=3, einheit="Stk"), [])
    assert (voll["taetigkeit"], voll["menge"], voll["einheit"]) == ("Steckdosen setzen", 3, "Stk")
