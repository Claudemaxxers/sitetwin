"""Das Audit muss saubere Daten durchwinken und jede Art von Schaden finden."""

import copy

import pytest

from ablage import audit, store
from ablage.models import ImportKontext

from .conftest import FAKE_DATA

CTX = ImportKontext(projekt="BV Simmering")


@pytest.fixture(scope="module")
def sauber():
    backend = store.FakeBackend()
    quelle = audit.originale(FAKE_DATA, CTX)
    ergebnis = store.speichern(quelle, backend)
    assert ergebnis.neu == 64  # 53 Basis + 11 Szenario wand_top5
    return list(backend.zeilen.values()), dict(backend.dateien), quelle


def _lauf(zeilen, dateien, quelle):
    belege = audit.belege_aus_erwartet(FAKE_DATA / "ERWARTET.md")
    return {b.pruefung: b for b in audit.pruefe(zeilen, dateien, quelle=quelle, belege=belege)}


def test_saubere_daten_keine_fehler_keine_warnungen(sauber):
    befunde = _lauf(*sauber)
    assert len(befunde) >= 20
    assert [str(b) for b in befunde.values() if b.stufe != audit.OK] == []


def test_belege_aus_golden_set_erkannt():
    belege = audit.belege_aus_erwartet(FAKE_DATA / "ERWARTET.md")
    assert {"IMG-20261112-WA0012", "PTT-20261112-WA0009", "PTT-20261112-WA0015", "Sonderwunsch_Top7.pdf"} <= set(belege)


def _kaputt(sauber, aendere):
    zeilen, dateien, quelle = copy.deepcopy(sauber[0]), dict(sauber[1]), sauber[2]
    aendere(zeilen, dateien)
    return {n: b for n, b in _lauf(zeilen, dateien, quelle).items() if b.stufe != audit.OK}


def _zeile(zeilen, **kw):
    return next(z for z in zeilen if all(z.get(k) == v for k, v in kw.items()))


def test_findet_verfaelschten_text(sauber):
    def aendere(zeilen, dateien):
        _zeile(zeilen, absender="Andrea Gruber", anhang_pfad=None)["text"] += " (nachträglich geändert)"

    befunde = _kaputt(sauber, aendere)
    assert "content_hash aus Spalten nachrechenbar" in befunde
    assert "alles aus den Originalen ist in der Tabelle" not in befunde  # Hash-Spalte selbst blieb


def test_findet_verfaelschtes_transkript_trotz_gleichem_hash(sauber):
    def aendere(zeilen, dateien):
        _zeile(zeilen, anhang_typ="audio")["text"] = "ganz anderer Inhalt"

    assert set(_kaputt(sauber, aendere)) == {"Felder byte-gleich zum Original (Umlaute, Emoji, Zeit)"}


def test_findet_fehlende_verwaiste_und_vertauschte_dateien(sauber):
    def fehlt(zeilen, dateien):
        del dateien[_zeile(zeilen, anhang_typ="image")["anhang_pfad"]]

    def waise(zeilen, dateien):
        dateien["bv-simmering/whatsapp/" + "0" * 64 + ".jpg"] = b"x"

    def vertauscht(zeilen, dateien):
        dateien[_zeile(zeilen, anhang_typ="pdf")["anhang_pfad"]] = b"anderer Inhalt"

    assert "jede Anhang-Zeile hat ihre Datei im Bucket" in _kaputt(sauber, fehlt)
    assert "keine verwaisten Dateien im Bucket" in _kaputt(sauber, waise)
    assert "Dateiinhalt im Bucket = sha256 im Pfad" in _kaputt(sauber, vertauscht)


def test_findet_verlorene_zeile_und_mojibake(sauber):
    def verloren(zeilen, dateien):
        zeilen.remove(_zeile(zeilen, typ="call"))

    def mojibake(zeilen, dateien):
        z = next(z for z in zeilen if "ü" in z["text"] and not z["anhang_pfad"])
        z["text"] = z["text"].encode("utf-8").decode("cp1252", errors="replace")

    assert "alles aus den Originalen ist in der Tabelle" in _kaputt(sauber, verloren)
    assert "content_hash aus Spalten nachrechenbar" in _kaputt(sauber, mojibake)


def test_findet_zeitverschiebung_und_wertebereich(sauber):
    def stunde(zeilen, dateien):
        z = _zeile(zeilen, typ="call")
        z["zeitpunkt"] = z["zeitpunkt"].replace("16:10:04+01:00", "16:10:04+00:00")  # UTC statt Wien

    def status(zeilen, dateien):
        zeilen[0]["status"] = "erledigt"

    def drive_mit_zeit(zeilen, dateien):
        _zeile(zeilen, typ="drive")["zeitpunkt"] = "2026-11-13T10:00:00+01:00"

    assert "Felder byte-gleich zum Original (Umlaute, Emoji, Zeit)" in _kaputt(sauber, stunde)
    assert "typ/status im Wertebereich" in _kaputt(sauber, status)
    assert "zeitpunkt fehlt nur bei drive" in _kaputt(sauber, drive_mit_zeit)


def test_findet_kaputte_verweise_und_fehlendes_transkript(sauber):
    def verweis(zeilen, dateien):
        next(z for z in zeilen if z["meta"].get("gehoert_zu"))["meta"]["gehoert_zu"] = "f" * 64

    def transkript(zeilen, dateien):
        _zeile(zeilen, anhang_typ="audio")["text"] = ""

    assert "meta.gehoert_zu zeigt auf vorhandene Mail" in _kaputt(sauber, verweis)
    befunde = _kaputt(sauber, transkript)
    assert befunde["Sprachnachrichten haben Transkript"].stufe == audit.WARNUNG


def test_status_vom_uebersetzer_stoert_nicht(sauber):
    def aendere(zeilen, dateien):
        for z in zeilen:
            z["status"] = "verarbeitet"
        zeilen[0]["meta"] = {**zeilen[0]["meta"], "fehler": "vom Übersetzer"}

    assert _kaputt(sauber, aendere) == {}
