"""n8n intake: POST /import/email/gmail and POST /import/drive/datei (SPEC §7.7, §7.8)."""

import base64
import json
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from ablage import api, config, store
from ablage.adapters import eml, ordner
from ablage.models import ImportKontext

from .conftest import CALL, FAKE_DATA

PLANER_EML = FAKE_DATA / "email" / "2026-11-10_0912_Planer_Index_C_Top5.eml"
DRIVE = FAKE_DATA / "drive"
CTX = ImportKontext(projekt="Fallback")


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
def setup(backend):
    state = {"cfg": einstellungen()}
    api.app.dependency_overrides[api.get_backend] = lambda: backend
    api.app.dependency_overrides[api.get_kontext] = lambda: CTX
    api.app.dependency_overrides[api.get_einstellungen] = lambda: state["cfg"]
    yield TestClient(api.app), state
    api.app.dependency_overrides.clear()


@pytest.fixture
def client(setup) -> TestClient:
    return setup[0]


def b64url(daten: bytes, padding: bool = False) -> str:
    text = base64.urlsafe_b64encode(daten).decode()
    return text if padding else text.rstrip("=")


def gmail(client, daten: bytes | None = None, headers: dict | None = None, **kw):
    body = {
        "raw": b64url(PLANER_EML.read_bytes() if daten is None else daten),
        "gmail_id": "18c0aa11",
        **kw,
    }
    return client.post("/import/email/gmail", json=body, headers=headers or {})


def drive(client, daten: bytes, headers: dict | None = None, **params):
    return client.post(
        "/import/drive/datei",
        params={"pfad": "Plaene/test.csv", **params},
        content=daten,
        headers={"Content-Type": "application/octet-stream", **(headers or {})},
    )


# ---- Gmail ----


def test_gmail_mail_mit_anhang(client, backend):
    r = gmail(client)
    assert r.status_code == 200
    assert r.json() == {"gelesen": 2, "neu": 2, "duplikate": 0, "fehler": []}
    zeilen = list(backend.zeilen.values())
    assert {z["projekt"] for z in zeilen} == {"Fallback"}
    assert all(z["meta"]["quelle"] == "gmail" and z["meta"]["gmail_id"] == "18c0aa11" for z in zeilen)
    assert any(z["anhang_name"] == "Plan_E-05_Top5_IndexC.pdf" for z in zeilen)


def test_gmail_gleicher_hash_wie_eml_import(client, backend):
    erwartet = {i.content_hash() for i in eml.aus_bytes(PLANER_EML.read_bytes(), PLANER_EML.name, CTX)}
    assert gmail(client).json()["neu"] == len(erwartet)
    assert set(backend.zeilen) == erwartet


def test_gmail_mit_padding_und_projekt(client, backend):
    r = client.post(
        "/import/email/gmail",
        json={
            "raw": b64url(PLANER_EML.read_bytes(), padding=True),
            "gmail_id": "x1",
            "projekt": "Test Santino",
        },
    )
    assert r.status_code == 200
    assert {z["projekt"] for z in backend.zeilen.values()} == {"Test Santino"}


def test_gmail_zweiter_aufruf_keine_neuen_zeilen(client, backend):
    gmail(client)
    r = gmail(client)
    assert r.json() == {"gelesen": 2, "neu": 0, "duplikate": 2, "fehler": []}
    assert len(backend.zeilen) == 2


@pytest.mark.parametrize("raw", ["%%%kein-base64%%%", "A", "   "])
def test_gmail_kaputtes_base64_422(client, backend, raw):
    r = client.post("/import/email/gmail", json={"raw": raw, "gmail_id": "x"})
    assert r.status_code == 422
    assert not backend.zeilen


def test_gmail_pflichtfelder_422(client):
    assert client.post("/import/email/gmail", json={"raw": b64url(b"x")}).status_code == 422
    assert client.post("/import/email/gmail", json={"raw": "", "gmail_id": "x"}).status_code == 422
    assert client.post("/import/email/gmail", json={"raw": "QQ", "gmail_id": ""}).status_code == 422


# ---- Drive ----


def test_drive_csv_text_gefuellt(client, backend):
    daten = "Pos;Menge\nKabel;12\n".encode()
    r = drive(client, daten, datei_id="1AbC", geaendert_am="2026-11-12T10:00:00Z")
    assert r.status_code == 200
    assert r.json() == {"gelesen": 1, "neu": 1, "duplikate": 0, "fehler": []}
    z = next(iter(backend.zeilen.values()))
    assert z["typ"] == "drive" and z["zeitpunkt"] is None and z["absender"] is None
    assert z["kanal"] == "Google Drive" and z["projekt"] == "Fallback"
    assert z["original_ref"] == "Plaene/test.csv"
    assert "Kabel;12" in z["text"]
    assert z["meta"]["quelle"] == "n8n" and z["meta"]["drive_id"] == "1AbC"
    assert z["meta"]["mtime"] == "2026-11-12T10:00:00Z" and z["meta"]["groesse"] == len(daten)


def test_drive_pdf_text_aus_pypdf(client, backend):
    pdf = next(DRIVE.rglob("*.pdf"))
    r = drive(client, pdf.read_bytes(), pfad=pdf.name)
    assert r.status_code == 200
    z = next(iter(backend.zeilen.values()))
    assert z["text"].strip() and z["meta"]["text_quelle"] == "pypdf"


def test_drive_gleicher_hash_wie_ordner_parse(client, backend):
    erwartet = {i.content_hash() for i in ordner.parse(DRIVE, CTX)}
    for datei in sorted(p for p in DRIVE.rglob("*") if p.is_file()):
        relativ = datei.relative_to(DRIVE)
        if ordner.ignoriert(relativ):
            continue
        r = drive(client, datei.read_bytes(), pfad=relativ.as_posix(), kanal=DRIVE.name)
        assert r.json()["gelesen"] == 1
    assert set(backend.zeilen) == erwartet


def test_drive_pfad_wird_normalisiert(client, backend):
    drive(client, b"x", pfad="\\Plaene\\Elektro\\a.txt")
    assert next(iter(backend.zeilen.values()))["original_ref"] == "Plaene/Elektro/a.txt"


def test_drive_zweiter_aufruf_duplikat(client):
    drive(client, b"a;b")
    assert drive(client, b"a;b").json()["duplikate"] == 1


@pytest.mark.parametrize("pfad", ["desktop.ini", "Plaene/.versteckt.txt", "~$Liste.xlsx", "Thumbs.db"])
def test_drive_ignorierte_datei(client, backend, pfad):
    r = drive(client, b"x", pfad=pfad)
    assert r.status_code == 200
    assert r.json() == {"gelesen": 0, "neu": 0, "duplikate": 0, "fehler": []}
    assert not backend.zeilen


def test_drive_leerer_body_oder_pfad_422(client):
    assert drive(client, b"").status_code == 422
    assert client.post("/import/drive/datei", content=b"x").status_code == 422
    assert drive(client, b"x", pfad="/").status_code == 422


# ---- Token ----


def test_token_gesetzt_header_fehlt_oder_falsch_401(setup, backend):
    client, state = setup
    state["cfg"] = einstellungen(import_token="geheim")
    falsch = {"X-Ablage-Token": "falsch"}
    assert gmail(client).status_code == 401
    assert gmail(client, headers=falsch).status_code == 401
    assert drive(client, b"x").status_code == 401
    assert drive(client, b"x", headers=falsch).status_code == 401
    assert not backend.zeilen


def test_token_richtig_200(setup):
    client, state = setup
    state["cfg"] = einstellungen(import_token="geheim")
    h = {"X-Ablage-Token": "geheim"}
    assert gmail(client, headers=h).status_code == 200
    assert drive(client, b"x", headers=h).status_code == 200


def test_ohne_token_einstellung_keine_pruefung(client):
    assert gmail(client).status_code == 200


def test_token_aendert_nichts_an_import_call(setup):
    client, state = setup
    state["cfg"] = einstellungen(import_token="geheim")
    r = client.post("/import/call", json=json.loads(CALL.read_text(encoding="utf-8")))
    assert r.status_code == 200
    assert r.json()["neu"] == 1
