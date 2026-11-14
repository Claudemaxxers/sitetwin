"""POST /import/email/gmail-felder (SPEC §7.10): Mail so, wie der n8n-Gmail-Node sie zerlegt.

Das n8n-Item wird hier aus der .eml nachgebaut (Form laut n8n-Quellcode `parseRawEmail` +
mailparser, nicht an einer echten Ausführung geprüft). Maßstab: dieselben Zeilen und
content_hash-Werte wie der .eml-Import.
"""

import base64
import email
import email.policy
from datetime import timezone

import pytest

from ablage import store
from ablage.adapters import eml

from .conftest import FAKE_DATA
from .test_n8n_eingang import CTX, client, einstellungen, setup  # noqa: F401  (Fixtures)

EMLS = sorted((FAKE_DATA / "email").glob("*.eml"))
PLANER = FAKE_DATA / "email" / "2026-11-10_0912_Planer_Index_C_Top5.eml"
URL = "/import/email/gmail-felder"
# meta-Schlüssel, die je Weg anders sind (gehen nicht in den Hash)
WEG_META = {"datei", "quelle", "gmail_id", "gmail_weg"}


@pytest.fixture
def backend() -> store.FakeBackend:
    return store.FakeBackend()


def _adresse(h) -> dict | None:
    if h is None:
        return None
    return {
        "value": [{"address": a.addr_spec, "name": a.display_name} for a in h.addresses],
        "text": str(h),
        "html": "<span>…</span>",
    }


def n8n_item(pfad, kopfzeilen: bool = True) -> tuple[dict, list[dict]]:
    """Nachbau von $json und den Anhängen des Gmail Triggers mit Simplify aus."""
    msg = email.message_from_bytes(pfad.read_bytes(), policy=email.policy.default)
    plain = msg.get_body(preferencelist=("plain",))
    mail = {
        "id": "18c0aa11" + pfad.stem[-4:],
        "threadId": "18c0aa11",
        "labelIds": ["Label_1", "INBOX"],
        "sizeEstimate": len(pfad.read_bytes()),
        "html": False,
        "text": plain.get_content() if plain else None,
        "textAsHtml": "<p>…</p>",
        "subject": str(msg["Subject"]),
        "date": msg["Date"].datetime.astimezone(timezone.utc).isoformat().replace("+00:00", ".000Z"),
        "to": _adresse(msg["To"]),
        "from": _adresse(msg["From"]),
        "cc": _adresse(msg["Cc"]),
        "messageId": str(msg["Message-ID"]),
        "inReplyTo": str(msg["In-Reply-To"]) if msg["In-Reply-To"] else None,
        "references": str(msg["References"]) if msg["References"] else None,
    }
    if kopfzeilen:  # n8n: headers[zeile.key] = zeile.line
        mail["headers"] = {k.lower(): f"{k}: {v}" for k, v in msg.raw_items()}
    mail = {k: v for k, v in mail.items() if v is not None}  # JSON lässt undefined weg
    anhaenge = [
        {
            "name": t.get_filename(),
            "mime": t.get_content_type(),
            "base64": base64.b64encode(t.get_payload(decode=True)).decode(),
        }
        for t in msg.iter_attachments()
    ]
    return mail, anhaenge


def eml_zeilen(pfad) -> dict[str, dict]:
    b = store.FakeBackend()
    store.speichern(eml.parse(pfad, CTX), b)
    return b.zeilen


def ohne_weg(z: dict) -> dict:
    return {**z, "meta": {k: v for k, v in z["meta"].items() if k not in WEG_META}}


def post(client, mail, anhaenge=None, headers=None, **kw):
    return client.post(URL, json={"mail": mail, "anhaenge": anhaenge or [], **kw}, headers=headers or {})


# ---- gleiche Zeilen und Hashes wie .eml ----


def test_alle_fake_mails_vorhanden():
    assert len(EMLS) == 6


@pytest.mark.parametrize("kopfzeilen", [True, False], ids=["mit_headers", "nur_felder"])
@pytest.mark.parametrize("pfad", EMLS, ids=lambda p: p.stem)
def test_gleiche_zeilen_wie_eml(client, backend, pfad, kopfzeilen):
    mail, anhaenge = n8n_item(pfad, kopfzeilen)
    r = post(client, mail, anhaenge)
    assert r.status_code == 200, r.text
    erwartet = eml_zeilen(pfad)
    assert r.json() == {"gelesen": len(erwartet), "neu": len(erwartet), "duplikate": 0, "fehler": []}
    assert set(backend.zeilen) == set(erwartet)
    for h, z in erwartet.items():
        assert ohne_weg(backend.zeilen[h]) == ohne_weg(z)
        assert backend.zeilen[h]["meta"]["quelle"] == "gmail"
        assert backend.zeilen[h]["meta"]["gmail_weg"] == "felder"
        assert backend.zeilen[h]["meta"]["gmail_id"] == mail["id"]


def test_anhaenge_zeilen_und_dateien(client, backend):
    mail, anhaenge = n8n_item(PLANER)
    post(client, mail, anhaenge)
    anhang = next(z for z in backend.zeilen.values() if z["anhang_name"])
    assert anhang["anhang_name"] == "Plan_E-05_Top5_IndexC.pdf" and anhang["anhang_typ"] == "pdf"
    assert anhang["text"].strip()  # PDF-Text wie beim .eml-Import
    assert backend.dateien[anhang["anhang_pfad"]] == base64.b64decode(anhaenge[0]["base64"])


def test_nach_eml_import_keine_neue_zeile(client, backend):
    store.speichern(eml.parse(PLANER, CTX), backend)
    r = post(client, *n8n_item(PLANER))
    assert r.json() == {"gelesen": 2, "neu": 0, "duplikate": 2, "fehler": []}


def test_nach_gmail_roh_keine_neue_zeile(client, backend):
    raw = base64.urlsafe_b64encode(PLANER.read_bytes()).decode().rstrip("=")
    assert client.post("/import/email/gmail", json={"raw": raw, "gmail_id": "x"}).json()["neu"] == 2
    assert post(client, *n8n_item(PLANER)).json()["neu"] == 0


def test_zweiter_aufruf_keine_neuen_zeilen(client, backend):
    mail, anhaenge = n8n_item(PLANER)
    post(client, mail, anhaenge)
    r = post(client, mail, anhaenge)
    assert r.json() == {"gelesen": 2, "neu": 0, "duplikate": 2, "fehler": []}
    assert len(backend.zeilen) == 2


def test_projekt_aus_body(client, backend):
    post(client, *n8n_item(PLANER), projekt="Test Santino")
    assert {z["projekt"] for z in backend.zeilen.values()} == {"Test Santino"}


@pytest.mark.parametrize("projekt", [None, "", "  "])
def test_projekt_leer_fallback(client, backend, projekt):
    post(client, *n8n_item(PLANER), projekt=projekt)
    assert {z["projekt"] for z in backend.zeilen.values()} == {"Fallback"}


# ---- tolerantes Lesen ----


def _hashes(client, backend, mail, anhaenge=None) -> set[str]:
    backend.zeilen.clear()
    r = post(client, mail, anhaenge)
    assert r.status_code == 200, r.text
    return set(backend.zeilen)


VARIANTEN = {
    "from_als_text": lambda m: {**m, "from": m["from"]["text"], "to": m["to"]["text"]},
    "from_nur_value": lambda m: {
        **m, "from": {"value": m["from"]["value"]}, "to": {"value": m["to"]["value"]}
    },
    "message_id_ohne_klammern": lambda m: {**m, "messageId": m["messageId"].strip("<>")},
    "grosse_feldnamen": lambda m: {
        ("Subject" if k == "subject" else "From" if k == "from" else "To" if k == "to" else k): v
        for k, v in m.items()
    },
    "datum_mit_offset": lambda m: {**m, "date": "2026-11-10T09:12:00+01:00"},
    "text_crlf_und_leerzeilen": lambda m: {**m, "text": "\r\n" + m["text"].replace("\n", "\r\n") + "\r\n\r\n"},
}


@pytest.mark.parametrize("variante", VARIANTEN, ids=list(VARIANTEN))
def test_varianten_nur_felder_gleicher_hash(client, backend, variante):
    mail, anhaenge = n8n_item(PLANER, kopfzeilen=False)
    erwartet = set(eml_zeilen(PLANER))
    assert _hashes(client, backend, VARIANTEN[variante](mail), anhaenge) == erwartet


def test_crlf_text_wird_als_lf_gespeichert(client, backend):
    mail, anhaenge = n8n_item(PLANER)
    mail["text"] = mail["text"].replace("\n", "\r\n")
    post(client, mail, anhaenge)
    erwartet = eml_zeilen(PLANER)
    for h, z in erwartet.items():
        assert backend.zeilen[h]["text"] == z["text"]


def test_headers_varianten_gleicher_hash(client, backend):
    mail, anhaenge = n8n_item(PLANER)
    erwartet = set(eml_zeilen(PLANER))
    # Schlüssel in beliebiger Schreibung, Werte ohne "Name:"-Präfix
    ohne_praefix = {k.upper(): v.split(":", 1)[1] for k, v in mail["headers"].items()}
    assert _hashes(client, backend, {**mail, "headers": ohne_praefix}, anhaenge) == erwartet
    # Liste wie Gmail-API payload.headers; Einzelfelder kaputt, Kopfzeilen gewinnen
    liste = [{"name": k, "value": v.split(":", 1)[1].strip()} for k, v in mail["headers"].items()]
    kaputt = {**mail, "headers": liste, "from": 42, "subject": "falsch", "date": "kein Datum"}
    assert _hashes(client, backend, kaputt, anhaenge) == erwartet


def test_gefaltete_kopfzeile(client, backend):
    """Sonderwunsch-Mail hat einen gefalteten, RFC-2047-kodierten Betreff."""
    pfad = next(p for p in EMLS if "Sonderwunsch" in p.name)
    mail, anhaenge = n8n_item(pfad)
    assert "\n" in mail["headers"]["subject"]
    assert _hashes(client, backend, mail, anhaenge) == set(eml_zeilen(pfad))
    z = next(z for z in backend.zeilen.values() if not z["anhang_name"])
    assert z["meta"]["betreff"] == "Sonderwunsch Top 7 – zusätzliche Datendose Arbeitszimmer"


def test_ganzes_n8n_item_und_mail_als_text(client, backend):
    import json

    mail, anhaenge = n8n_item(PLANER)
    erwartet = set(eml_zeilen(PLANER))
    assert _hashes(client, backend, {"json": mail, "binary": {}}, anhaenge) == erwartet
    assert _hashes(client, backend, json.dumps(mail), anhaenge) == erwartet


def test_reine_html_mail(client, backend):
    roh = (
        "From: A <a@x.example>\nTo: B <b@x.example>\nSubject: Nur HTML\n"
        "Date: Fri, 13 Nov 2026 10:00:00 +0100\nMessage-ID: <html1@x.example>\n"
        "MIME-Version: 1.0\nContent-Type: text/html; charset=utf-8\n\n"
        "<p>Hallo</p><p>Wand <b>Top 5</b> verschoben</p>\n"
    ).encode()
    erwartet = {i.content_hash() for i in eml.aus_bytes(roh, "x.eml", CTX)}
    msg = email.message_from_bytes(roh, policy=email.policy.default)
    mail = {
        "id": "h1",
        "headers": {k.lower(): f"{k}: {v}" for k, v in msg.raw_items()},
        "html": msg.get_body().get_content(),
        "text": "HALLO\n\nWAND TOP 5 VERSCHOBEN",  # mailparser macht aus HTML eigenen Text
    }
    assert _hashes(client, backend, mail) == erwartet


def test_anhang_ohne_namen_und_mime_mit_parametern(client, backend):
    mail, _ = n8n_item(PLANER)
    r = post(client, mail, [{"base64": base64.b64encode(b"a;b").decode(), "mime": "Text/CSV; charset=utf-8"}])
    assert r.status_code == 200
    z = next(z for z in backend.zeilen.values() if z["anhang_name"])
    assert z["anhang_name"] == "anhang-1" and z["original_ref"].endswith("#anhang-1")


# ---- 422 ----


@pytest.mark.parametrize(
    "body, stichwort",
    [
        ({"anhaenge": []}, "mail"),
        ({"mail": {}}, "mail fehlt"),
        ({"mail": "kein json"}, "kein JSON"),
        ({"mail": [1, 2]}, "mail"),
        (
            {"mail": {"id": "1", "snippet": "Hallo …", "From": "A <a@x.example>", "Subject": "x"}},
            "Simplify",
        ),
        ({"mail": {"subject": "x", "text": "y", "date": "2026-11-13T10:00:00Z"}}, "Gmail-id"),
        ({"mail": {"id": "1", "subject": "x", "text": "y"}}, "from und date fehlen"),
    ],
    ids=["ohne_mail", "leer", "text", "liste", "simplify_an", "ohne_id", "ohne_from_date"],
)
def test_unbrauchbar_422(client, backend, body, stichwort):
    r = client.post(URL, json=body)
    assert r.status_code == 422
    assert stichwort in r.text
    assert not backend.zeilen


def test_kaputter_anhang_422_mit_namen(client, backend):
    mail, _ = n8n_item(PLANER)
    r = post(client, mail, [{"name": "Plan.pdf", "mime": "application/pdf", "base64": "%%%"}])
    assert r.status_code == 422 and "Plan.pdf" in r.text
    assert not backend.zeilen


def test_anhang_ohne_base64_422(client):
    mail, _ = n8n_item(PLANER)
    assert post(client, mail, [{"name": "a.pdf"}]).status_code == 422


# ---- Token ----


def test_token(setup, backend):
    client, state = setup
    state["cfg"] = einstellungen(import_token="geheim")
    mail, anhaenge = n8n_item(PLANER)
    assert post(client, mail, anhaenge).status_code == 401
    assert post(client, mail, anhaenge, headers={"X-Ablage-Token": "falsch"}).status_code == 401
    assert not backend.zeilen
    assert post(client, mail, anhaenge, headers={"X-Ablage-Token": "geheim"}).status_code == 200
