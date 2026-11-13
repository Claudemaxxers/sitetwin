import base64
import hashlib
import hmac
from datetime import datetime, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from ablage import api, config, store
from ablage.adapters import whatsapp_twilio as twilio
from ablage.models import ImportKontext

URL = "https://example.ngrok.app/import/whatsapp/twilio"
TOKEN = "testtoken"
JETZT = datetime(2026, 11, 14, 7, 15, 30, tzinfo=timezone.utc)
FORM = {
    "MessageSid": "SM" + "a" * 32,
    "From": "whatsapp:+436601234567",
    "To": "whatsapp:+14155238886",
    "ProfileName": "Stefan Huber",
    "WaId": "436601234567",
    "Body": "  Top 5 Verteiler ist umgebaut ",
    "NumMedia": "0",
    "SmsStatus": "received",
}
BYTES = b"OggS-fake-voice"


def einstellungen(**kw) -> config.Einstellungen:
    basis = dict(
        supabase_url="", supabase_key="", bucket="ablage", default_projekt="Fallback",
        tz=ZoneInfo("Europe/Vienna"),
    )
    return config.Einstellungen(**{**basis, **kw})


@pytest.fixture
def backend() -> store.FakeBackend:
    return store.FakeBackend()


@pytest.fixture
def aufrufe() -> list[str]:
    return []


@pytest.fixture
def setup(backend, aufrufe):
    """Liefert (client, setze_cfg); Downloader ist ein Fake ohne Netz."""
    state = {"cfg": einstellungen(), "fehler": False}

    def lade(url: str) -> bytes:
        aufrufe.append(url)
        if state["fehler"]:
            raise ConnectionError("down")
        return BYTES

    api.app.dependency_overrides[api.get_backend] = lambda: backend
    api.app.dependency_overrides[api.get_kontext] = lambda: ImportKontext(projekt="Fallback")
    api.app.dependency_overrides[api.get_einstellungen] = lambda: state["cfg"]
    api.app.dependency_overrides[api.get_downloader] = lambda: lade
    api.app.dependency_overrides[api.get_jetzt] = lambda: (lambda: JETZT)
    yield TestClient(api.app), state
    api.app.dependency_overrides.clear()


def post(client, form: dict, **headers):
    return client.post(
        "/import/whatsapp/twilio",
        content=urlencode(form),
        headers={"Content-Type": "application/x-www-form-urlencoded", **headers},
    )


def test_text_nachricht(setup, backend):
    client, state = setup
    state["cfg"] = einstellungen(whatsapp_live_kanal="BV Simmering Elektro")
    r = post(client, FORM)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/xml")
    assert r.text == "<Response></Response>"
    (z,) = backend.zeilen.values()
    assert z["typ"] == "whatsapp" and z["projekt"] == "Fallback"
    assert z["kanal"] == "BV Simmering Elektro"
    assert z["absender"] == "Stefan Huber"
    assert z["text"] == "Top 5 Verteiler ist umgebaut"
    assert z["zeitpunkt"] == "2026-11-14T08:15:30+01:00"
    assert z["original_ref"] == FORM["MessageSid"]
    assert z["meta"] == {
        "wa_id": FORM["MessageSid"], "quelle": "live", "provider": "twilio",
        "absender_nummer": "+436601234567",
    }
    assert z["anhang_pfad"] is None


def test_absender_ohne_profilname_ist_nummer(setup, backend):
    client, _ = setup
    post(client, {k: v for k, v in FORM.items() if k != "ProfileName"})
    (z,) = backend.zeilen.values()
    assert z["absender"] == "+436601234567" and z["kanal"] is None


def test_sprachnachricht_mit_download(setup, backend, aufrufe):
    client, _ = setup
    form = {
        **FORM, "Body": "", "NumMedia": "1",
        "MediaUrl0": "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1",
        "MediaContentType0": "audio/ogg",
    }
    assert post(client, form).status_code == 200
    assert aufrufe == [form["MediaUrl0"]]
    (z,) = backend.zeilen.values()
    assert z["anhang_name"] == FORM["MessageSid"] + ".ogg"
    assert z["anhang_typ"] == "audio"
    assert z["text"] == ""
    assert backend.dateien[z["anhang_pfad"]] == BYTES


def test_adapter_anhang_mimetype():
    n = twilio.TwilioNachricht(
        MessageSid="SM1", From="whatsapp:+43660", NumMedia=1,
        MediaUrl0="https://x/m", MediaContentType0="audio/ogg",
    )
    item = twilio.aus_formular(n, ImportKontext(projekt="P"), JETZT, lade=lambda _u: BYTES)
    assert item.anhang.dateiname == "SM1.ogg" and item.anhang.mimetype == "audio/ogg"
    assert item.anhang.inhalt == BYTES
    assert twilio.endung("image/jpeg; charset=x") == ".jpg" and twilio.endung(None) == ".bin"


def test_gleiche_sid_zweimal_ein_duplikat(setup, backend):
    client, _ = setup
    post(client, FORM)
    post(client, {**FORM, "Body": "Retry"})
    assert len(backend.zeilen) == 1
    assert post(client, FORM).status_code == 200  # Retry bleibt 200
    r = client.post("/import/whatsapp/nachricht", json={
        "absender": "x", "zeitpunkt": "2026-11-14T08:00:00+01:00", "wa_id": FORM["MessageSid"],
        "projekt": "Fallback",
    })
    assert r.json()["neu"] == 0 and r.json()["duplikate"] == 1


def signiert(form: dict, token: str = TOKEN) -> str:
    daten = URL + "".join(k + form[k] for k in sorted(form))
    return base64.b64encode(hmac.new(token.encode(), daten.encode(), hashlib.sha1).digest()).decode()


def test_signatur_gueltig(setup, backend):
    client, state = setup
    state["cfg"] = einstellungen(twilio_auth_token=TOKEN, twilio_webhook_url=URL)
    r = post(client, FORM, **{"X-Twilio-Signature": signiert(FORM)})
    assert r.status_code == 200 and len(backend.zeilen) == 1


@pytest.mark.parametrize("header", [None, "kaputt", signiert(FORM, "falscher-token")])
def test_signatur_ungueltig_403(setup, backend, header):
    client, state = setup
    state["cfg"] = einstellungen(twilio_auth_token=TOKEN, twilio_webhook_url=URL)
    r = post(client, FORM, **({"X-Twilio-Signature": header} if header else {}))
    assert r.status_code == 403 and not backend.zeilen


def test_signatur_geaenderter_body_403(setup, backend):
    client, state = setup
    state["cfg"] = einstellungen(twilio_auth_token=TOKEN, twilio_webhook_url=URL)
    r = post(client, {**FORM, "Body": "manipuliert"}, **{"X-Twilio-Signature": signiert(FORM)})
    assert r.status_code == 403


@pytest.mark.parametrize("feld", ["MessageSid", "From"])
def test_pflichtfeld_fehlt_422(setup, backend, feld):
    client, _ = setup
    form = {k: v for k, v in FORM.items() if k != feld}
    assert post(client, form).status_code == 422
    assert not backend.zeilen


def test_download_fehlt_nachricht_bleibt(setup, backend):
    client, state = setup
    state["fehler"] = True
    form = {**FORM, "NumMedia": "1", "MediaUrl0": "https://api.twilio.com/m/1",
            "MediaContentType0": "image/jpeg"}
    assert post(client, form).status_code == 200
    (z,) = backend.zeilen.values()
    assert z["anhang_pfad"] is None and z["text"] == "Top 5 Verteiler ist umgebaut"
    assert "ConnectionError" in z["meta"]["anhang_fehler"]
    assert z["meta"]["anhang_url"] == "https://api.twilio.com/m/1"


def test_backend_fehler_wird_502(setup, backend, monkeypatch):
    client, _ = setup

    def weg(_hashes):
        raise ConnectionError("down")

    monkeypatch.setattr(backend, "vorhandene_hashes", weg)
    assert post(client, FORM).status_code == 502
