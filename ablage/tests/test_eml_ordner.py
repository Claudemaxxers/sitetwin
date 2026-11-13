import os
import shutil

import pytest

from ablage import store
from ablage.adapters import eml, ordner
from ablage.models import ParseFehler, RawItem

from .conftest import FAKE_DATA

EMAIL = FAKE_DATA / "email"
DRIVE = FAKE_DATA / "drive"


@pytest.fixture(scope="module")
def mails() -> list[RawItem]:
    from ablage.models import ImportKontext

    return list(eml.parse(EMAIL, ImportKontext(projekt="BV Simmering")))


@pytest.fixture(scope="module")
def dateien() -> list[RawItem]:
    from ablage.models import ImportKontext

    return list(ordner.parse(DRIVE, ImportKontext(projekt="BV Simmering")))


# --- E-Mail ---------------------------------------------------------------


def test_6_mails_2_pdf_anhaenge(mails):
    assert all(isinstance(m, RawItem) for m in mails)
    assert len(mails) == 8
    anhaenge = [m for m in mails if m.anhang]
    assert sorted(a.anhang.dateiname for a in anhaenge) == [
        "Plan_E-05_Top5_IndexC.pdf",
        "Sonderwunsch_Top7.pdf",
    ]
    assert all(a.anhang.typ.value == "pdf" and a.anhang.mimetype == "application/pdf" for a in anhaenge)


def test_betreff_dekodiert(mails):
    betreffs = {m.meta["betreff"] for m in mails if not m.anhang}
    assert "BV Simmering – Plan E-05 Top 5 Index C" in betreffs
    assert "Lieferbestätigung Auftrag 2026-44817" in betreffs
    assert "Sonderwunsch Top 7 – zusätzliche Datendose Arbeitszimmer" in betreffs
    assert not any("=?" in b for b in betreffs)


def test_mail_felder(mails):
    planer = mails[0]
    assert planer.absender == "DI Martin Lechner <m.lechner@tb-lechner.example>"
    assert planer.kanal == "a.gruber@elektro-gruber.example"
    assert planer.zeitpunkt.isoformat() == "2026-11-10T09:12:00+01:00"
    assert planer.text.startswith("Betreff: BV Simmering – Plan E-05 Top 5 Index C\n\n")
    assert planer.original_ref == planer.meta["message_id"]
    assert planer.original_ref.startswith("<") and planer.original_ref.endswith("@tb-lechner.example>")
    grosshandel = next(m for m in mails if "Lieferbest" in m.text[:40])
    assert grosshandel.absender.startswith("Elektro-Großhandel Weiss")
    protokoll = next(m for m in mails if m.meta.get("cc"))
    assert "s.huber@elektro-gruber.example" in protokoll.meta["cc"]


def test_in_reply_to(mails):
    antwort = next(m for m in mails if m.meta.get("in_reply_to"))
    anzeige = next(m for m in mails if m.meta.get("betreff", "").startswith("Behinderungsanzeige"))
    assert antwort.meta["betreff"].startswith("Re: Behinderungsanzeige")
    assert antwort.meta["in_reply_to"] == anzeige.meta["message_id"]


def test_pdf_anhang_hat_text_und_verweist_auf_mail(mails):
    planer, plan = mails[0], mails[1]
    assert plan.anhang.dateiname == "Plan_E-05_Top5_IndexC.pdf"
    assert plan.meta["gehoert_zu"] == planer.content_hash()
    assert plan.original_ref == f"{planer.original_ref}#Plan_E-05_Top5_IndexC.pdf"
    assert (plan.absender, plan.zeitpunkt, plan.kanal) == (planer.absender, planer.zeitpunkt, planer.kanal)
    assert "Wohnungsverteiler (WV): Abstellraum" in plan.text
    assert plan.meta["text_quelle"] == "pypdf"
    sonderwunsch = next(m for m in mails if m.anhang and m.anhang.dateiname == "Sonderwunsch_Top7.pdf")
    assert len(sonderwunsch.text) > 50


def test_kaputte_mail_und_html_fallback(tmp_path, ctx):
    (tmp_path / "a.eml").write_bytes(
        b"From: A <a@x.example>\r\nTo: b@x.example\r\nSubject: Hi\r\n"
        b"Date: Fri, 13 Nov 2026 10:00:00 +0000\r\nMessage-ID: <1@x>\r\n"
        b"Content-Type: text/html; charset=utf-8\r\n\r\n"
        b"<html><style>p{}</style><p>Hallo <b>Welt</b></p><p>Zeile 2</p></html>\r\n"
    )
    (item,) = eml.parse(tmp_path, ctx)
    assert item.text == "Betreff: Hi\n\nHallo Welt\nZeile 2"
    assert item.zeitpunkt.isoformat() == "2026-11-13T11:00:00+01:00"


# --- Ordner / Drive -------------------------------------------------------


def test_6_dateien_2_csv_1_md_3_pdf(dateien):
    assert all(isinstance(d, RawItem) for d in dateien)
    assert sorted(d.original_ref for d in dateien) == [
        "Projekt_Simmering/LV_Elektro.csv",
        "Projekt_Simmering/Plaene/Plan_E-03_Top3_IndexA.pdf",
        "Projekt_Simmering/Plaene/Plan_E-05_Top5_IndexB.pdf",
        "Projekt_Simmering/Plaene/Plan_E-05_Top5_IndexC.pdf",
        "Projekt_Simmering/Projekt.md",
        "Projekt_Simmering/Tops.csv",
    ]
    assert sorted(d.anhang.typ.value for d in dateien) == ["pdf", "pdf", "pdf", "tabelle", "tabelle", "text"]


def test_drive_felder(dateien):
    for d in dateien:
        assert d.zeitpunkt is None and d.absender is None
        assert d.kanal == "drive" and d.typ.value == "drive"
        assert d.meta["mtime"] and d.text
    lv = next(d for d in dateien if d.original_ref.endswith("LV_Elektro.csv"))
    assert lv.text.startswith("pos_nr;kurztext;") and "\n02.02.010;" in lv.text


def test_pdf_text_im_drive(dateien):
    b = next(d for d in dateien if d.original_ref.endswith("IndexB.pdf"))
    c = next(d for d in dateien if d.original_ref.endswith("IndexC.pdf"))
    assert "Wohnungsverteiler (WV): Vorraum" in b.text
    assert "Wohnungsverteiler (WV): Abstellraum" in c.text
    assert b.meta["text_quelle"] == c.meta["text_quelle"] == "pypdf"


def test_steuerdateien_ignoriert_mtime_nicht_im_hash_kaputtes_pdf(tmp_path, ctx):
    kopie = tmp_path / "drive"
    shutil.copytree(DRIVE, kopie)
    (kopie / ".DS_Store").write_bytes(b"x")
    (kopie / "Projekt_Simmering" / "desktop.ini").write_text("x")
    (kopie / "Projekt_Simmering" / "Thumbs.db").write_bytes(b"x")
    (kopie / "Projekt_Simmering" / "~$LV_Elektro.xlsx").write_bytes(b"x")
    (kopie / ".versteckt").mkdir()
    (kopie / ".versteckt" / "a.txt").write_text("x")
    for p in kopie.rglob("*"):
        os.utime(p, (1_600_000_000, 1_600_000_000))

    def hashes(pfad):
        return sorted(d.content_hash() for d in ordner.parse(pfad, ctx))

    assert len(hashes(kopie)) == 6
    assert hashes(kopie) == hashes(DRIVE)

    (kopie / "kaputt.pdf").write_bytes(b"kein pdf")
    kaputt = next(d for d in ordner.parse(kopie, ctx) if d.original_ref == "kaputt.pdf")
    assert kaputt.text == "" and "pdf_fehler" in kaputt.meta


def test_ordner_fehlt(tmp_path, ctx):
    (ergebnis,) = ordner.parse(tmp_path / "gibtsnicht", ctx)
    assert isinstance(ergebnis, ParseFehler)


# --- Store ----------------------------------------------------------------


def test_alles_zusammen_zweiter_import_0_neu(ctx):
    from ablage.adapters import call, whatsapp

    from .conftest import CALL, WA

    backend = store.FakeBackend()

    def lauf():
        return [
            store.speichern(whatsapp.parse(WA, ctx), backend),
            store.speichern(eml.parse(EMAIL, ctx), backend),
            store.speichern(ordner.parse(DRIVE, ctx), backend),
            store.speichern(call.parse(CALL, ctx), backend),
        ]

    assert [(e.gelesen, e.neu) for e in lauf()] == [(39, 39), (8, 8), (6, 6), (1, 1)]
    assert [(e.neu, e.duplikate) for e in lauf()] == [(0, 39), (0, 8), (0, 6), (0, 1)]
    assert len(backend.zeilen) == 54
    # Plan Index C liegt in Mail und Drive: gleiche Datei, aber getrennte Pfade je typ
    assert len(backend.dateien) == 5 + 2 + 6
