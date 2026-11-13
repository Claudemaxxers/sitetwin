import json
import shutil
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from ablage.adapters import call, whatsapp
from ablage.models import Anhang, QuellTyp, RawItem

from .conftest import CALL, WA

WIEN = ZoneInfo("Europe/Vienna")


def _wa(**kw) -> RawItem:
    basis = dict(
        typ=QuellTyp.whatsapp,
        projekt="BV Simmering",
        kanal="Gruppe",
        absender="Stefan Huber",
        zeitpunkt=datetime(2026, 11, 12, 7, 10, tzinfo=WIEN),
        text="Ok machen wir heute",
        original_ref="export.txt#L1",
    )
    return RawItem(**{**basis, **kw})


def test_gleicher_input_gleicher_hash():
    assert _wa().content_hash() == _wa().content_hash()
    assert len(_wa().content_hash()) == 64


def test_text_wird_normalisiert():
    assert _wa(text="  a\r\nb \n").content_hash() == _wa(text="a\nb").content_hash()


def test_zeitzone_egal_gleicher_moment():
    utc = datetime(2026, 11, 12, 6, 10, tzinfo=timezone.utc)
    assert _wa(zeitpunkt=utc).content_hash() == _wa().content_hash()


def test_meta_und_original_ref_nicht_im_hash():
    assert _wa(meta={"x": 1}, original_ref="anders.txt#L99").content_hash() == _wa().content_hash()


def test_inhalt_im_hash():
    h = _wa().content_hash()
    assert _wa(text="anders").content_hash() != h
    assert _wa(absender="Ali Demir").content_hash() != h
    assert _wa(projekt="BV Favoriten").content_hash() != h


def test_anderer_exportdateiname_gleicher_hash(tmp_path, ctx):
    kopie = tmp_path / "wa"
    shutil.copytree(WA, kopie)
    alt = kopie / "WhatsApp Chat mit BV Simmering Elektro.txt"
    alt.rename(kopie / "WhatsApp Chat mit BV Simmering Elektro (1).txt")

    def hashes(pfad, kanal):
        items = [i for i in whatsapp.parse(pfad, ctx) if isinstance(i, RawItem)]
        return [i.model_copy(update={"kanal": kanal}).content_hash() for i in items]

    # kanal kommt aus dem Dateinamen; bei gleichem Kanal ist der Hash vom Dateinamen unabhängig
    assert hashes(WA, "k") == hashes(kopie, "k")


def test_audio_mit_und_ohne_sidecar_gleicher_hash(tmp_path, ctx):
    ohne = tmp_path / "wa"
    shutil.copytree(WA, ohne)
    for sidecar in ohne.rglob("*.opus.txt"):
        sidecar.unlink()

    def audio(pfad):
        return [
            i
            for i in whatsapp.parse(pfad, ctx)
            if isinstance(i, RawItem) and i.anhang and i.anhang.typ.value == "audio"
        ]

    mit, nackt = audio(WA), audio(ohne)
    assert len(mit) == len(nackt) == 2
    assert all(i.text for i in mit) and not any(i.text for i in nackt)
    assert [i.content_hash() for i in mit] == [i.content_hash() for i in nackt]


def test_drive_mtime_nicht_im_hash():
    def drive(mtime: str, ref: str = "Projekt/LV.csv") -> RawItem:
        return RawItem(
            typ=QuellTyp.drive,
            projekt="BV Simmering",
            kanal="drive",
            zeitpunkt=None,
            text="a;b",
            anhang=Anhang.aus_bytes("LV.csv", b"a;b"),
            original_ref=ref,
            meta={"mtime": mtime},
        )

    assert drive("2026-11-10").content_hash() == drive("2026-11-13").content_hash()
    assert drive("x", ref="Projekt/Alt/LV.csv").content_hash() != drive("x").content_hash()


def test_call_geaenderte_zusammenfassung_gleicher_hash(ctx):
    payload = json.loads(CALL.read_text(encoding="utf-8"))
    spaeter = {**payload, "zusammenfassung": "Nachgeliefert.", "transkript": payload["transkript"][:3]}
    anderer = {**payload, "call_id": "call_anders"}
    h = call.aus_payload(payload, ctx).content_hash()
    assert call.aus_payload(spaeter, ctx).content_hash() == h
    assert call.aus_payload(anderer, ctx).content_hash() != h


def test_live_whatsapp_identitaet_ist_wa_id():
    a = _wa(meta={"wa_id": "wamid.1"}, text="erste Fassung")
    b = _wa(meta={"wa_id": "wamid.1"}, text="Retry mit anderem Text")
    assert a.content_hash() == b.content_hash()
    assert _wa(meta={"wa_id": "wamid.2"}).content_hash() != a.content_hash()
