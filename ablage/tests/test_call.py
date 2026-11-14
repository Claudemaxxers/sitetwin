import json

import pytest
from pydantic import ValidationError

from ablage.adapters import call
from ablage.models import ImportKontext, ParseFehler, QuellTyp

from .conftest import CALL


@pytest.fixture
def payload() -> dict:
    return json.loads(CALL.read_text(encoding="utf-8"))


def test_vertrag_v1(payload):
    item = call.aus_payload(payload, ImportKontext(projekt="Fallback"))
    assert item.typ is QuellTyp.call
    assert item.projekt == "BV Simmering"  # from the payload, not from the context
    assert item.absender == "Stefan Huber"
    assert item.kanal == "+43 660 0000000"
    assert item.original_ref == "call_8f3a2c1e"
    assert item.zeitpunkt.isoformat() == "2026-11-13T16:10:04+01:00"
    zeilen = item.text.split("\n")
    assert len(zeilen) == 13
    assert zeilen[0].startswith("Agent: Hallo Stefan")
    assert zeilen[1] == "Stefan Huber: Ja passt, bin eh im Auto."
    assert item.meta["call_id"] == "call_8f3a2c1e"
    assert item.meta["richtung"] == "outbound"
    assert item.meta["dauer_s"] == 157
    assert item.meta["zusammenfassung"].startswith("Wartezeit Top 3")
    assert item.meta["roh"] == payload


def test_utc_wird_nach_wien_umgerechnet_und_default_projekt(payload, ctx):
    minimal = {"call_id": "c1", "gestartet_um": "2026-11-13T15:10:04Z", "transkript": []}
    item = call.aus_payload(minimal, ImportKontext(projekt="Fallback"))
    assert item.zeitpunkt.isoformat() == "2026-11-13T16:10:04+01:00"
    assert item.projekt == "Fallback"
    assert item.text == "" and item.meta["dauer_s"] is None


@pytest.mark.parametrize("feld", ["call_id", "gestartet_um", "transkript"])
def test_pflichtfelder(payload, ctx, feld):
    del payload[feld]
    with pytest.raises(ValidationError):
        call.aus_payload(payload, ctx)


def test_parse_datei_und_kaputte_datei(tmp_path, ctx):
    assert len(list(call.parse(CALL, ctx))) == 1
    kaputt = tmp_path / "kaputt.json"
    kaputt.write_text("{", encoding="utf-8")
    (ergebnis,) = call.parse(kaputt, ctx)
    assert isinstance(ergebnis, ParseFehler) and ergebnis.ref == "kaputt.json"
