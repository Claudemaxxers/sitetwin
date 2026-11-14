"""Shapes that real WhatsApp exports have: iPhone zip (_chat.txt), English phone, 12-hour time."""

import zipfile

from ablage import store
from ablage.adapters import whatsapp
from ablage.models import RawItem

LRM = chr(0x200E)


def _zip(pfad, dateien: dict[str, bytes]):
    with zipfile.ZipFile(pfad, "w") as z:
        for name, daten in dateien.items():
            z.writestr(name, daten)
    return pfad


def test_iphone_zip_mit_chat_txt_und_sprachnachricht(tmp_path, ctx):
    chat = (
        f"[13.11.26, 22:30:01] Baustelle Test: {LRM}Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt. "
        "Niemand außerhalb dieses Chats kann sie lesen.\n"
        f"[13.11.26, 22:30:01] Santino: {LRM}Santino hat diese Gruppe erstellt\n"
        "[13.11.26, 22:31:05] Santino: Test eins\n"
        f"{LRM}[13.11.26, 22:31:40] Santino: {LRM}<Anhang: 00000004-AUDIO-2026-11-13-22-31-40.opus>\n"
        f"{LRM}[13.11.26, 22:32:10] Santino: {LRM}<Anhang: 00000005-PHOTO-2026-11-13-22-32-10.jpg>\n"
        "[13.11.26, 22:33:00] Santino: Zeile eins\nZeile zwei\n"
        f"[13.11.26, 22:34:00] Santino: {LRM}Bild weggelassen\n"
    )
    archiv = _zip(
        tmp_path / "WhatsApp Chat - Baustelle Test.zip",
        {
            "_chat.txt": chat.encode("utf-8"),
            "00000004-AUDIO-2026-11-13-22-31-40.opus": b"OggS-echt",
            "00000005-PHOTO-2026-11-13-22-32-10.jpg": b"jpeg-echt",
        },
    )
    alles = list(whatsapp.ereignisse(archiv, ctx))
    items = [e for e in alles if isinstance(e, RawItem)]
    system = [e for e in alles if isinstance(e, whatsapp.Systemzeile)]

    assert len(system) == 1  # encryption notice; "hat diese Gruppe erstellt" comes through as a message
    assert {i.kanal for i in items} == {"Baustelle Test"}
    audio = next(i for i in items if i.anhang and i.anhang.typ.value == "audio")
    assert audio.anhang.dateiname.endswith(".opus") and audio.anhang.inhalt == b"OggS-echt"
    assert audio.text == "" and audio.zeitpunkt.isoformat() == "2026-11-13T22:31:40+01:00"
    foto = next(i for i in items if i.anhang and i.anhang.typ.value == "image")
    assert foto.anhang.mimetype == "image/jpeg"
    assert any(i.text == "Zeile eins\nZeile zwei" for i in items)
    assert sum(bool(i.meta.get("medien_ausgeschlossen")) for i in items) == 1

    backend = store.FakeBackend()
    eins = store.speichern(whatsapp.parse(archiv, ctx), backend)
    assert eins.neu == eins.gelesen == len(items) and len(backend.dateien) == 2
    assert store.speichern(whatsapp.parse(archiv, ctx), backend).neu == 0


def test_entpackter_iphone_ordner(tmp_path, ctx):
    ordner = tmp_path / "WhatsApp Chat - Polier"
    ordner.mkdir()
    (ordner / "_chat.txt").write_text("[13.11.26, 08:00:00] Polier: Morgen\n", encoding="utf-8")
    (item,) = whatsapp.parse(ordner, ctx)
    assert item.kanal == "Polier" and item.original_ref == "_chat.txt#L1"


def test_englisches_android_mit_12_stunden_zeit(tmp_path, ctx):
    (tmp_path / "WhatsApp Chat with Site Test.txt").write_text(
        "13/11/2026, 10:31 pm - Messages and calls are end-to-end encrypted. Tap to learn more.\n"
        "13/11/2026, 10:31 pm - Santino: Hello\n"
        "13/11/2026, 12:05 am - Santino: kurz nach Mitternacht\n"
        "11/13/26, 12:30 PM - Santino: US-Reihenfolge, Mittag\n"
        "13/11/2026, 10:32 pm - Santino: PTT-20261113-WA0001.opus (file attached)\n"
        "13/11/2026, 10:33 pm - Santino: This message was deleted\n"
        "13/11/2026, 10:34 pm - Santino: <Media omitted>\n",
        encoding="utf-8",
    )
    (tmp_path / "PTT-20261113-WA0001.opus").write_bytes(b"OggS")
    alles = list(whatsapp.ereignisse(tmp_path, ctx))
    items = [e for e in alles if isinstance(e, RawItem)]
    assert len(items) == 6 and len(alles) == 7
    assert items[0].kanal == "Site Test"
    assert [i.zeitpunkt.strftime("%d.%m. %H:%M") for i in items[:3]] == ["13.11. 22:31", "13.11. 00:05", "13.11. 12:30"]
    assert items[3].anhang.typ.value == "audio"
    assert items[4].meta == {"geloescht": True} and items[5].meta == {"medien_ausgeschlossen": True}


def test_deutsches_format_unveraendert(tmp_path, ctx):
    (tmp_path / "WhatsApp Chat mit Test.txt").write_text(
        "03.04.26, 07:02 - A: dritter April, nicht vierter März\n", encoding="utf-8"
    )
    (item,) = whatsapp.parse(tmp_path, ctx)
    assert (item.zeitpunkt.day, item.zeitpunkt.month) == (3, 4)
