"""Szenario wand_top5 (Kernbeispiel aus KONZEPT.md): Zahlen aus fake_data/ERWARTET.md §5."""

import pytest

from ablage import audit, store
from ablage.adapters import call, whatsapp
from ablage.models import ImportKontext, RawItem

from .conftest import FAKE_DATA

SZENARIO = FAKE_DATA / "szenarien" / "wand_top5"
CTX = ImportKontext(projekt="BV Simmering")


@pytest.fixture(scope="module")
def alles():
    return list(whatsapp.ereignisse(SZENARIO / "whatsapp", CTX))


@pytest.fixture(scope="module")
def items(alles) -> list[RawItem]:
    return [e for e in alles if isinstance(e, RawItem)]


def test_10_nachrichten_1_systemzeile(alles, items):
    assert len(items) == 10 and len(alles) == 11
    assert sum(isinstance(e, whatsapp.Systemzeile) for e in alles) == 1
    assert {i.kanal for i in items} == {"BV Simmering Elektro"}  # gleicher Kanal wie die Basisdaten
    assert "Marko Novak (Novak Trockenbau)" in {i.absender for i in items}


def test_4_anhaenge_beide_sprachnachrichten_mit_transkript(items):
    anhaenge = {i.anhang.dateiname: i for i in items if i.anhang}
    assert sorted(anhaenge) == [
        "IMG-20261113-WA0021.jpg",
        "IMG-20261114-WA0004.jpg",
        "PTT-20261113-WA0022.opus",
        "PTT-20261114-WA0005.opus",
    ]
    ausloeser = anhaenge["PTT-20261113-WA0022.opus"]
    assert ausloeser.zeitpunkt.isoformat() == "2026-11-13T17:20:00+01:00"
    assert "Samstag um sieben machen wir die zweite Seite zu" in ausloeser.text
    loesung = anhaenge["PTT-20261114-WA0005.opus"]
    assert loesung.zeitpunkt.isoformat() == "2026-11-14T06:55:00+01:00"
    assert "Ihr könnts die Wand zumachen" in loesung.text
    assert all(i.meta.get("transkript_quelle") == "sidecar" for i in (ausloeser, loesung))


def test_signal_anruf_nach_vertrag_v1():
    (anruf,) = call.parse(SZENARIO / "calls", CTX)
    assert anruf.original_ref == "call_3b91d7f2" and anruf.absender == "Stefan Huber"
    assert anruf.zeitpunkt.isoformat() == "2026-11-13T17:31:12+01:00"
    assert anruf.meta["dauer_s"] == 106
    assert anruf.meta["roh"]["anlass"] == "signal"  # Zusatzfeld bleibt in meta.roh erhalten
    assert "Die Wand darf nicht zugehen" in anruf.text


def test_reihenfolge_ausloeser_vor_anruf_vor_loesung(items):
    ausloeser = next(i for i in items if i.anhang and i.anhang.dateiname == "PTT-20261113-WA0022.opus")
    loesung = next(i for i in items if i.anhang and i.anhang.dateiname == "PTT-20261114-WA0005.opus")
    zu = next(i for i in items if i.text == "Passt danke, wir machen jetzt zu")
    (anruf,) = call.parse(SZENARIO / "calls", CTX)
    assert ausloeser.zeitpunkt < anruf.zeitpunkt < loesung.zeitpunkt < zu.zeitpunkt


def test_nach_basisdaten_11_neu_keine_kollision():
    backend = store.FakeBackend()
    alle = audit.originale(FAKE_DATA, CTX)
    assert len(alle) == 64 and len({i.content_hash() for i in alle}) == 64
    store.speichern(whatsapp.parse(FAKE_DATA / "whatsapp", CTX), backend)
    assert len(backend.zeilen) == 39
    eins = store.speichern(whatsapp.parse(SZENARIO / "whatsapp", CTX), backend)
    zwei = store.speichern(call.parse(SZENARIO / "calls", CTX), backend)
    assert (eins.neu, eins.duplikate, zwei.neu) == (10, 0, 1)
    nochmal = store.speichern(whatsapp.parse(SZENARIO / "whatsapp", CTX), backend)
    assert (nochmal.neu, nochmal.duplikate) == (0, 10)


def test_belege_aus_erwartet_liegen_in_den_daten():
    namen = {i.anhang.dateiname for i in audit.originale(FAKE_DATA, CTX) if i.anhang}
    belege = audit.belege_aus_erwartet(FAKE_DATA / "ERWARTET.md")
    assert len(belege) >= 9
    assert [b for b in belege if not any(b in n for n in namen)] == []
