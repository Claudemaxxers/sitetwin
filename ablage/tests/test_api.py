import base64
import json

import pytest
from fastapi.testclient import TestClient

from ablage import api, store
from ablage.models import ImportKontext

from .conftest import CALL, WA


@pytest.fixture
def backend() -> store.FakeBackend:
    return store.FakeBackend()


@pytest.fixture
def client(backend):
    api.app.dependency_overrides[api.get_backend] = lambda: backend
    api.app.dependency_overrides[api.get_kontext] = lambda: ImportKontext(projekt="Fallback")
    yield TestClient(api.app)
    api.app.dependency_overrides.clear()


@pytest.fixture
def call_payload() -> dict:
    return json.loads(CALL.read_text(encoding="utf-8"))


def nachricht(**kw) -> dict:
    return {
        "projekt": "BV Simmering",
        "kanal": "BV Simmering Elektro",
        "absender": "Stefan Huber",
        "zeitpunkt": "2026-11-14T08:15:30+01:00",
        "text": "Top 5 Verteiler ist umgebaut",
        "wa_id": "wamid.TEST1",
        **kw,
    }


def test_health(client):
    assert client.get("/health").json() == {"ok": True}


def test_call_landet_in_quellen(client, backend, call_payload):
    r = client.post("/import/call", json=call_payload)
    assert r.status_code == 200
    assert r.json() == {"gelesen": 1, "neu": 1, "duplikate": 0, "fehler": []}
    (zeile,) = backend.zeilen.values()
    assert zeile["typ"] == "call" and zeile["projekt"] == "BV Simmering"
    assert zeile["absender"] == "Stefan Huber" and zeile["original_ref"] == "call_8f3a2c1e"
    assert zeile["zeitpunkt"] == "2026-11-13T16:10:04+01:00"
    assert zeile["text"].startswith("Agent: Hallo Stefan")
    assert zeile["meta"]["roh"] == call_payload


def test_call_retry_und_nachgelieferte_zusammenfassung_keine_zweite_zeile(client, backend, call_payload):
    client.post("/import/call", json=call_payload)
    r = client.post("/import/call", json={**call_payload, "zusammenfassung": "Neu."})
    assert r.json() == {"gelesen": 1, "neu": 0, "duplikate": 1, "fehler": []}
    assert len(backend.zeilen) == 1


def test_call_ohne_projekt_nimmt_default(client, backend, call_payload):
    del call_payload["projekt"]
    client.post("/import/call", json=call_payload)
    assert next(iter(backend.zeilen.values()))["projekt"] == "Fallback"


@pytest.mark.parametrize("feld", ["call_id", "gestartet_um", "transkript"])
def test_call_pflichtfeld_fehlt_422(client, backend, call_payload, feld):
    del call_payload[feld]
    assert client.post("/import/call", json=call_payload).status_code == 422
    assert not backend.zeilen


def test_live_nachricht_text(client, backend):
    r = client.post("/import/whatsapp/nachricht", json=nachricht())
    assert r.status_code == 200
    assert r.json() == {"gelesen": 1, "neu": 1, "duplikate": 0, "fehler": []}
    (zeile,) = backend.zeilen.values()
    assert zeile["typ"] == "whatsapp" and zeile["kanal"] == "BV Simmering Elektro"
    assert zeile["zeitpunkt"] == "2026-11-14T08:15:30+01:00"
    assert zeile["original_ref"] == "wamid.TEST1"
    assert zeile["meta"] == {"wa_id": "wamid.TEST1", "quelle": "live"}
    assert zeile["anhang_pfad"] is None


def test_live_nachricht_identitaet_ist_wa_id(client, backend):
    client.post("/import/whatsapp/nachricht", json=nachricht())
    r = client.post("/import/whatsapp/nachricht", json=nachricht(text="Webhook-Retry"))
    assert r.json()["neu"] == 0 and r.json()["duplikate"] == 1
    r = client.post("/import/whatsapp/nachricht", json=nachricht(wa_id="wamid.TEST2"))
    assert r.json()["neu"] == 1
    assert len(backend.zeilen) == 2


def test_live_nachricht_mit_anhang(client, backend):
    foto = (WA / "media" / "IMG-20261112-WA0012.jpg").read_bytes()
    anhang = {
        "mimetype": "image/jpeg",
        "dateiname": "IMG-live.jpg",
        "base64": base64.b64encode(foto).decode(),
    }
    r = client.post("/import/whatsapp/nachricht", json=nachricht(text="", anhang=anhang))
    assert r.json()["neu"] == 1
    (zeile,) = backend.zeilen.values()
    assert zeile["anhang_typ"] == "image" and zeile["anhang_name"] == "IMG-live.jpg"
    assert zeile["anhang_pfad"].startswith("bv-simmering/whatsapp/")
    assert backend.dateien[zeile["anhang_pfad"]] == foto


def test_live_nachricht_utc_nach_wien_und_default_projekt(client, backend):
    n = nachricht(zeitpunkt="2026-11-14T07:15:30Z")
    del n["projekt"]
    client.post("/import/whatsapp/nachricht", json=n)
    (zeile,) = backend.zeilen.values()
    assert zeile["zeitpunkt"] == "2026-11-14T08:15:30+01:00"
    assert zeile["projekt"] == "Fallback"


@pytest.mark.parametrize(
    "kaputt",
    [
        {"wa_id": ""},
        {"zeitpunkt": "gestern"},
        {"anhang": {"dateiname": "x.jpg", "base64": "kein base64!!"}},
    ],
)
def test_live_nachricht_ungueltig_422(client, backend, kaputt):
    assert client.post("/import/whatsapp/nachricht", json=nachricht(**kaputt)).status_code == 422
    assert not backend.zeilen


def test_backend_fehler_wird_502(client, backend, monkeypatch):
    def weg(_hashes):
        raise ConnectionError("down")

    monkeypatch.setattr(backend, "vorhandene_hashes", weg)
    assert client.post("/import/whatsapp/nachricht", json=nachricht()).status_code == 502
