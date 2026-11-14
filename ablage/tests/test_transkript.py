"""Transcription of voice messages (SPEC §7.9), without network: fake and MockTransport."""

from datetime import datetime, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from ablage import api, config, store, transkript
from ablage.adapters import whatsapp_live
from ablage.models import Anhang, ImportKontext, ParseFehler, QuellTyp, RawItem

JETZT = datetime(2026, 11, 14, 7, 15, 30, tzinfo=timezone.utc)
SID = "SM" + "b" * 32
FORM = {
    "MessageSid": SID, "From": "whatsapp:+436601234567", "ProfileName": "Stefan Huber",
    "Body": "", "NumMedia": "1", "MediaUrl0": "https://api.twilio.com/m/1",
    "MediaContentType0": "audio/ogg",
}
BYTES = b"OggS-fake-voice"
TEXT = "Der Verteiler in Top 5 ist fertig."


def einstellungen(**kw) -> config.Einstellungen:
    basis = dict(
        supabase_url="", supabase_key="", bucket="ablage", default_projekt="Fallback",
        tz=ZoneInfo("Europe/Vienna"),
    )
    return config.Einstellungen(**{**basis, **kw})


class Fake:
    def __init__(self, antwort=TEXT, fehler=None):
        self.antwort, self.fehler, self.aufrufe = antwort, fehler, []

    def __call__(self, daten, dateiname, mimetype):
        self.aufrufe.append((daten, dateiname, mimetype))
        if self.fehler:
            raise self.fehler
        return self.antwort


@pytest.fixture
def backend() -> store.FakeBackend:
    return store.FakeBackend()


@pytest.fixture
def setup(backend):
    """(client, setze): setze(transkribierer) replaces the dependency."""
    api.app.dependency_overrides[api.get_backend] = lambda: backend
    api.app.dependency_overrides[api.get_kontext] = lambda: ImportKontext(projekt="Fallback")
    api.app.dependency_overrides[api.get_einstellungen] = lambda: einstellungen()
    api.app.dependency_overrides[api.get_downloader] = lambda: (lambda url: BYTES)
    api.app.dependency_overrides[api.get_jetzt] = lambda: (lambda: JETZT)

    def setze(t):
        api.app.dependency_overrides[api.get_transkribierer] = lambda: t

    yield TestClient(api.app), setze
    api.app.dependency_overrides.clear()


def post(client, form):
    return client.post(
        "/import/whatsapp/twilio",
        content=urlencode(form),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )


def audio_item(text="", dateiname="PTT-1.opus", meta=None) -> RawItem:
    return RawItem(
        typ=QuellTyp.whatsapp, projekt="P", absender="A", zeitpunkt=JETZT, text=text,
        anhang=Anhang.aus_bytes(dateiname, BYTES), original_ref="r", meta=meta or {},
    )


def test_twilio_sprachnachricht_wird_transkribiert(setup, backend):
    client, setze = setup
    fake = Fake()
    setze(fake)
    assert post(client, FORM).status_code == 200
    (z,) = backend.zeilen.values()
    assert z["text"] == TEXT
    assert z["meta"]["transkript_quelle"] == "whisper"
    assert z["anhang_typ"] == "audio" and backend.dateien[z["anhang_pfad"]] == BYTES
    assert fake.aufrufe == [(BYTES, SID + ".ogg", "audio/ogg")]


def test_transkribierer_wirft_nachricht_bleibt(setup, backend):
    client, setze = setup
    setze(Fake(fehler=TimeoutError("zu langsam")))
    assert post(client, FORM).status_code == 200
    (z,) = backend.zeilen.values()
    assert z["text"] == "" and z["anhang_pfad"] in backend.dateien
    assert z["meta"]["transkript_fehler"] == "TimeoutError: zu langsam"
    assert "transkript_quelle" not in z["meta"]


def test_ohne_schluessel_wie_bisher(setup, backend):
    client, _ = setup  # no override: real dependency, settings without key
    assert api.get_transkribierer(einstellungen()) is None
    assert post(client, FORM).status_code == 200
    (z,) = backend.zeilen.values()
    assert z["text"] == "" and not {"transkript_quelle", "transkript_fehler"} & set(z["meta"])


def test_dependency_mit_schluessel():
    t = api.get_transkribierer(einstellungen(
        transkript_api_key="k", transkript_base_url="https://x/v1", transkript_modell="m"))
    assert t.url == "https://x/v1/audio/transcriptions" and t.modell == "m"
    assert "'k'" not in repr(t)


def test_foto_wird_nicht_transkribiert(setup, backend):
    client, setze = setup
    fake = Fake()
    setze(fake)
    post(client, {**FORM, "MediaContentType0": "image/jpeg"})
    (z,) = backend.zeilen.values()
    assert z["anhang_typ"] == "image" and z["text"] == ""
    assert fake.aufrufe == []


def test_sidecar_text_bleibt():
    fake = Fake()
    item = audio_item(text="Sidecar", meta={"transkript_quelle": "sidecar"})
    transkript.ergaenze([item], fake)
    assert item.text == "Sidecar" and item.meta["transkript_quelle"] == "sidecar"
    assert fake.aufrufe == []


def test_parsefehler_wird_durchgereicht():
    pf = ParseFehler(ref="x#L1", grund="kaputt")
    assert transkript.ergaenze([pf, audio_item()], Fake())[0] is pf


def test_nachricht_endpunkt_und_bestehendes_bleibt(setup, backend):
    client, setze = setup
    fake = Fake()
    setze(fake)
    body = {
        "absender": "Stefan", "zeitpunkt": "2026-11-14T08:00:00", "wa_id": "w1",
        "anhang": {"dateiname": "PTT-1.opus", "base64": "T2dnUw=="},
    }
    assert client.post("/import/whatsapp/nachricht", json=body).json()["neu"] == 1
    (z,) = backend.zeilen.values()
    assert z["text"] == TEXT and z["anhang_name"] == "PTT-1.opus"
    assert fake.aufrufe[0][1] == "PTT-1.opus"
    # Boundary: an already stored message is not transcribed again
    assert client.post("/import/whatsapp/nachricht", json=body).json()["duplikate"] == 1
    assert len(fake.aufrufe) == 1


def test_hash_gleich_mit_und_ohne_transkript():
    ohne = audio_item()
    mit = audio_item()
    transkript.ergaenze([mit], Fake())
    assert mit.text == TEXT and ohne.text == ""
    assert ohne.content_hash() == mit.content_hash()


def test_cli_pfad_liest_bytes_von_platte(tmp_path):
    datei = tmp_path / "a.opus"
    datei.write_bytes(BYTES)
    item = audio_item()
    item.anhang = Anhang(
        dateiname="a.opus", typ=item.anhang.typ, sha256="x", lokaler_pfad=str(datei)
    )
    fake = Fake()
    assert store.speichern([item], store.FakeBackend(), fake).neu == 1
    assert fake.aufrufe[0][0] == BYTES and item.text == TEXT


def _fabrik(handler):
    return transkript.transkribierer_aus(
        "geheim", "https://api.example/v1/", "whisper-large-v3",
        transport=httpx.MockTransport(handler),
    )


def test_fabrik_schickt_modell_sprache_bearer_und_benennt_opus_um():
    gesehen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        gesehen["url"] = str(request.url)
        gesehen["auth"] = request.headers["Authorization"]
        gesehen["body"] = request.read()
        return httpx.Response(200, json={"text": " Hallo Welt "})

    t = _fabrik(handler)
    assert t(BYTES, "PTT-1.opus", "audio/opus") == "Hallo Welt"
    body = gesehen["body"]
    assert gesehen["url"] == "https://api.example/v1/audio/transcriptions"
    assert gesehen["auth"] == "Bearer geheim"
    assert b'name="model"' in body and b"whisper-large-v3" in body
    assert b'name="language"' in body and b"\r\n\r\nde\r\n" in body
    assert b'filename="PTT-1.ogg"' in body and b".opus" not in body and BYTES in body


def test_fabrik_antwort_ohne_text_vermerkt_fehler():
    t = _fabrik(lambda r: httpx.Response(200, json={"foo": "bar"}))
    item = audio_item()
    transkript.ergaenze([item], t)
    assert item.text == ""
    assert item.meta["transkript_fehler"].startswith("TranskriptFehler:")
    assert "geheim" not in str(item.meta)


@pytest.mark.parametrize("status", [401, 429, 500])
def test_fabrik_http_fehler(status):
    item = audio_item()
    transkript.ergaenze([item], _fabrik(lambda r: httpx.Response(status, text="nope")))
    assert item.meta["transkript_fehler"] == f"TranskriptFehler: HTTP {status}"


def test_fabrik_netzfehler_und_modell_in_meta():
    def weg(request):
        raise httpx.ConnectTimeout("timeout")

    item = audio_item()
    transkript.ergaenze([item], _fabrik(weg))
    assert item.meta["transkript_fehler"].startswith("ConnectTimeout")
    gut = audio_item()
    transkript.ergaenze([gut], _fabrik(lambda r: httpx.Response(200, json={"text": "ok"})))
    assert gut.meta["transkript_modell"] == "whisper-large-v3"
    assert gut.meta["transkript_quelle"] == "whisper"


def test_ohne_schluessel_keine_fabrik():
    assert transkript.transkribierer_aus("", "https://x", "m") is None


def test_live_nachricht_ohne_anhang_unberuehrt():
    n = whatsapp_live.LiveNachricht(
        absender="A", zeitpunkt="2026-11-14T08:00:00", wa_id="w", text="Hallo")
    item = whatsapp_live.aus_nachricht(n, ImportKontext(projekt="P"))
    fake = Fake()
    transkript.ergaenze([item], fake)
    assert item.text == "Hallo" and fake.aufrufe == []


# --- Silence: Whisper invents text ("Vielen Dank."), the Ablage does not adopt it ---------------

def _antwort(text, *no_speech):
    return {"text": text, "segments": [{"text": text, "no_speech_prob": w} for w in no_speech]}


def test_stille_ergibt_kein_transkript():
    """Values as measured from Groq whisper-large-v3 on 4 s of silence (14 Nov 2026)."""
    item = audio_item()
    transkript.ergaenze([item], _fabrik(lambda r: httpx.Response(200, json=_antwort(" Vielen Dank.", 0.701))))
    assert item.text == ""
    assert item.meta["transkript_fehler"] == "KeineSprache: keine Sprache erkannt"
    assert "transkript_quelle" not in item.meta


def test_sprache_bleibt_auch_mit_stiller_pause():
    t = _fabrik(lambda r: httpx.Response(200, json=_antwort(" Ja passt.", 0.004)))
    assert t(BYTES, "a.ogg", "audio/ogg") == "Ja passt."
    # one silent segment next to a spoken one: do not discard
    t = _fabrik(lambda r: httpx.Response(200, json=_antwort(" Top 5 ist fertig.", 0.9, 0.01)))
    assert t(BYTES, "a.ogg", "audio/ogg") == "Top 5 ist fertig."


@pytest.mark.parametrize("segmente", [None, [], [{}], [{"no_speech_prob": None}], "kaputt"])
def test_ohne_brauchbare_segmente_kein_filter(segmente):
    t = _fabrik(lambda r: httpx.Response(200, json={"text": "ok", "segments": segmente}))
    assert t(BYTES, "a.ogg", "audio/ogg") == "ok"


def test_fragt_segmente_an_und_faellt_bei_400_zurueck():
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(request.read())
        if b"verbose_json" in bodies[-1]:
            return httpx.Response(400, json={"error": "response_format not supported"})
        return httpx.Response(200, json={"text": "ok"})

    assert _fabrik(handler)(BYTES, "a.ogg", "audio/ogg") == "ok"
    assert len(bodies) == 2 and b'name="response_format"' in bodies[0] and b"response_format" not in bodies[1]
