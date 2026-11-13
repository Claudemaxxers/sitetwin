import zipfile
from datetime import timedelta

import pytest

from ablage.adapters import whatsapp
from ablage.models import ParseFehler, RawItem

from .conftest import WA

EXPORT = "WhatsApp Chat mit BV Simmering Elektro.txt"


@pytest.fixture(scope="module")
def alles():
    from ablage.models import ImportKontext

    return list(whatsapp.ereignisse(WA, ImportKontext(projekt="BV Simmering")))


@pytest.fixture(scope="module")
def items(alles) -> list[RawItem]:
    return [e for e in alles if isinstance(e, RawItem)]


def test_39_nachrichten_5_systemzeilen_keine_fehler(alles, items):
    assert len(items) == 39
    assert len([e for e in alles if isinstance(e, whatsapp.Systemzeile)]) == 5
    assert not [e for e in alles if isinstance(e, ParseFehler)]


def test_parse_liefert_keine_systemzeilen(ctx):
    assert all(isinstance(e, RawItem) for e in whatsapp.parse(WA, ctx))


def test_absender_exakt(items):
    assert {i.absender for i in items} == {
        "Andrea Gruber",
        "Stefan Huber",
        "Ali Demir",
        "Thomas Meier (Krenn Bau)",
    }


def test_5_anhaenge_3_fotos_2_sprachnachrichten(items):
    anhaenge = [i for i in items if i.anhang]
    assert len(anhaenge) == 5
    assert sorted(i.anhang.typ.value for i in anhaenge) == ["audio", "audio", "image", "image", "image"]
    assert all(len(i.anhang.sha256) == 64 and i.anhang.inhalt for i in anhaenge)
    assert all(i.text == "" for i in anhaenge if i.anhang.typ.value == "image")
    assert not any(i.meta.get("anhang_fehlt") for i in items)


def test_sprachnachrichten_mit_sidecar_transkript(items):
    audio = {i.anhang.dateiname: i for i in items if i.anhang and i.anhang.typ.value == "audio"}
    assert set(audio) == {"PTT-20261112-WA0009.opus", "PTT-20261112-WA0015.opus"}
    for name, item in audio.items():
        erwartet = (WA / "media" / f"{name}.txt").read_text(encoding="utf-8").strip()
        assert item.text == erwartet and erwartet
        assert item.meta["transkript_quelle"] == "sidecar"


def test_geloeschte_nachricht_markiert(items):
    geloescht = [i for i in items if i.meta.get("geloescht")]
    assert len(geloescht) == 1
    assert geloescht[0].absender == "Ali Demir"


def test_kanal_zeit_und_original_ref(items):
    erste = items[0]
    assert erste.kanal == "BV Simmering Elektro"
    assert erste.projekt == "BV Simmering"
    assert erste.original_ref == f"{EXPORT}#L6"
    assert erste.zeitpunkt.isoformat() == "2026-11-10T07:02:00+01:00"
    assert erste.zeitpunkt.utcoffset() == timedelta(hours=1)
    assert erste.text.startswith("Guten Morgen zusammen")
    assert len({i.original_ref for i in items}) == 39


def test_mehrzeiler_fehlender_anhang_unsichtbare_zeichen(tmp_path, ctx):
    (tmp_path / "WhatsApp Chat mit Test.txt").write_text(
        "﻿01.02.26, 08:00 - Gruppe erstellt\n"
        "01.02.26, 08:01 - A B: Zeile eins\n"
        "Zeile zwei\n"
        "\n"
        "Zeile vier: mit Doppelpunkt\n"
        "01.02.26, 08:02 - ‎A B: ‎IMG-1.jpg (Datei angehängt)\n"
        "01.02.26, 08:03 - A B: <Medien ausgeschlossen>\n"
        "31.02.26, 08:04 - A B: kaputtes Datum\n"
        "01.02.26, 08:05 - C: letzte\n",
        encoding="utf-8",
    )
    (tmp_path / "notizen.txt").write_text("01.02.26, 09:00 - X: kein Export", encoding="utf-8")
    alles = list(whatsapp.parse(tmp_path, ctx))
    items = [e for e in alles if isinstance(e, RawItem)]
    fehler = [e for e in alles if isinstance(e, ParseFehler)]

    assert [i.absender for i in items] == ["A B", "A B", "A B", "C"]
    assert items[0].text == "Zeile eins\nZeile zwei\n\nZeile vier: mit Doppelpunkt"
    assert items[0].original_ref == "WhatsApp Chat mit Test.txt#L2"
    assert items[1].anhang is None and items[1].text == ""
    assert items[1].meta == {"anhang_fehlt": True, "anhang_name": "IMG-1.jpg"}
    assert items[2].meta == {"medien_ausgeschlossen": True}
    assert len(fehler) == 1 and fehler[0].ref.endswith("#L8")


def test_ios_format(tmp_path, ctx):
    (tmp_path / "WhatsApp Chat mit iOS.txt").write_text(
        "[01.02.26, 08:01:30] A B: Hallo\nweiter\n[01.02.26, 08:02:00] C: Ok\n", encoding="utf-8"
    )
    items = list(whatsapp.parse(tmp_path, ctx))
    assert [i.text for i in items] == ["Hallo\nweiter", "Ok"]
    assert items[0].zeitpunkt.second == 30


def test_zip_und_einzeldatei_liefern_dasselbe(tmp_path, ctx, items):
    archiv = tmp_path / "export.zip"
    with zipfile.ZipFile(archiv, "w") as z:
        for p in WA.rglob("*"):
            if p.is_file():
                z.write(p, p.relative_to(WA).as_posix())
    erwartet = [i.content_hash() for i in items]
    assert [i.content_hash() for i in whatsapp.parse(archiv, ctx)] == erwartet
    assert [i.content_hash() for i in whatsapp.parse(WA / EXPORT, ctx)] == erwartet


def test_kein_export_gefunden(tmp_path, ctx):
    ergebnis = list(whatsapp.parse(tmp_path, ctx))
    assert len(ergebnis) == 1 and isinstance(ergebnis[0], ParseFehler)
