"""Stress tests: line endings, re-export, random garbage, clock change, volume, Unicode."""

import random
import shutil
import time

from ablage import store
from ablage.adapters import whatsapp
from ablage.models import ParseFehler, RawItem

from .conftest import WA

EXPORT = "WhatsApp Chat mit BV Simmering Elektro.txt"


def _hashes(pfad, ctx) -> list[str]:
    return [i.content_hash() for i in whatsapp.parse(pfad, ctx) if isinstance(i, RawItem)]


def test_crlf_export_gleiche_hashes(tmp_path, ctx):
    kopie = tmp_path / "wa"
    shutil.copytree(WA, kopie)
    roh = (kopie / EXPORT).read_bytes().replace(b"\r\n", b"\n")
    (kopie / EXPORT).write_bytes(b"\xef\xbb\xbf" + roh.replace(b"\n", b"\r\n"))  # BOM + CRLF
    assert _hashes(kopie, ctx) == _hashes(WA, ctx)


def test_spaeterer_laengerer_export_nur_das_neue_ist_neu(tmp_path, ctx):
    backend = store.FakeBackend()
    store.speichern(whatsapp.parse(WA, ctx), backend)

    spaeter = tmp_path / "wa"
    shutil.copytree(WA, spaeter)
    with (spaeter / EXPORT).open("a", encoding="utf-8") as f:
        f.write("\n16.11.26, 07:00 - Stefan Huber: Montag, Verteiler Top 5 wird umgebaut\n")
        f.write("16.11.26, 07:01 - Ali Demir: Bin in 10 min da\n")
    ergebnis = store.speichern(whatsapp.parse(spaeter, ctx), backend)
    assert (ergebnis.gelesen, ergebnis.neu, ergebnis.duplikate) == (41, 2, 39)
    assert backend.uploads == 5  # attachments not uploaded again


def test_teilweise_ueberlappender_export_ohne_anfang(tmp_path, ctx):
    """Chat is later exported only from 12 Nov on: line numbers shift, hashes do not."""
    backend = store.FakeBackend()
    store.speichern(whatsapp.parse(WA, ctx), backend)
    teil = tmp_path / "wa"
    shutil.copytree(WA, teil)
    zeilen = (teil / EXPORT).read_text(encoding="utf-8").splitlines()
    ab_12 = [z for z in zeilen if z[:8] >= "12.11.26"]
    (teil / EXPORT).write_text("\n".join(ab_12) + "\n", encoding="utf-8")
    ergebnis = store.speichern(whatsapp.parse(teil, ctx), backend)
    assert ergebnis.gelesen == len(ab_12) and ergebnis.neu == 0


def test_zufallsmuell_wirft_nie(tmp_path, ctx):
    rng = random.Random(20261113)
    bausteine = [
        "10.11.26, 07:02 - A: ok", "99.99.99, 99:99 - A: x", "10.11.26, 07:02 - ", "[10.11.26, 07:02:61] A: x",
        "", ":", " - ", "A: B: C", "\u200e\ufeff", "<Medien ausgeschlossen>", "x.jpg (Datei angehängt)",
        "10.11.26, 07:02 - A: x.jpg (Datei angehängt)", "\x00\x01", "😀" * 50, "a" * 5000, "31.12.9999, 23:59 - Z: y",
        "1.1.26, 7:05 - A: kurzes Datum", "10.11.26, 07:02 - A hat B hinzugefügt", "\t", "29.02.27, 10:00 - A: kein Schaltjahr",
    ]  # fmt: skip
    for runde in range(40):
        zeilen = [rng.choice(bausteine) + rng.choice(["", " ", "\r"]) for _ in range(rng.randint(0, 60))]
        (tmp_path / "WhatsApp Chat mit Fuzz.txt").write_text("\n".join(zeilen), encoding="utf-8", newline="")
        for e in whatsapp.parse(tmp_path, ctx):
            assert isinstance(e, (RawItem, ParseFehler)), runde
            if isinstance(e, RawItem):
                assert e.zeitpunkt.tzinfo is not None and e.absender
                assert len(e.content_hash()) == 64
                assert "\u200e" not in e.text and "\ufeff" not in e.text


def test_kaputte_bytes_im_export(tmp_path, ctx):
    (tmp_path / "WhatsApp Chat mit Bytes.txt").write_bytes(
        b"10.11.26, 07:02 - A: gut\n10.11.26, 07:03 - A: kaputt \xff\xfe hier\n10.11.26, 07:04 - B: danach\n"
    )
    items = list(whatsapp.parse(tmp_path, ctx))
    assert [i.absender for i in items] == ["A", "A", "B"]  # one broken line does not cost the rest


def test_zeitumstellung(tmp_path, ctx):
    (tmp_path / "WhatsApp Chat mit Zeit.txt").write_text(
        "29.03.26, 02:30 - A: gibt es nicht (Sommerzeit beginnt)\n"
        "25.10.26, 02:30 - A: gibt es zweimal (Winterzeit beginnt)\n"
        "15.07.26, 12:00 - A: Sommer\n"
        "15.01.26, 12:00 - A: Winter\n",
        encoding="utf-8",
    )
    items = list(whatsapp.parse(tmp_path, ctx))
    assert len(items) == 4 and all(isinstance(i, RawItem) for i in items)
    assert items[2].zeitpunkt.utcoffset().total_seconds() == 7200
    assert items[3].zeitpunkt.utcoffset().total_seconds() == 3600
    assert [i.content_hash() for i in items] == _hashes(tmp_path, ctx)  # deterministic


def test_unicode_bleibt_exakt(ctx):
    roh = (WA / EXPORT).read_text(encoding="utf-8").splitlines()
    items = [i for i in whatsapp.parse(WA, ctx) if isinstance(i, RawItem)]
    daumen = next(i for i in items if i.text == "👍")
    assert daumen.absender == "Thomas Meier (Krenn Bau)"
    for i in items:
        if not i.anhang:
            nr = int(i.original_ref.rsplit("#L", 1)[1])
            assert roh[nr - 1].endswith(i.text)  # text sits unchanged at the referenced line


def test_20000_nachrichten_schnell_und_in_batches(tmp_path, ctx):
    zeilen = [
        f"{1 + n // 1440 % 28:02d}.{1 + n // 40320:02d}.26, {n // 60 % 24:02d}:{n % 60:02d} - Person {n % 7}: Nachricht {n}"
        for n in range(20_000)
    ]
    (tmp_path / "WhatsApp Chat mit Gross.txt").write_text("\n".join(zeilen), encoding="utf-8")

    class Begrenzt(store.FakeBackend):
        groesste = 0

        def einfuegen(self, zeilen):
            self.groesste = max(self.groesste, len(zeilen))
            assert len(zeilen) <= store.BATCH, "Insert-Request zu groß"
            return super().einfuegen(zeilen)

    backend = Begrenzt()
    start = time.perf_counter()
    ergebnis = store.speichern(whatsapp.parse(tmp_path, ctx), backend)
    dauer = time.perf_counter() - start
    assert (ergebnis.gelesen, ergebnis.neu, ergebnis.duplikate, ergebnis.fehler) == (20_000, 20_000, 0, [])
    assert backend.groesste == store.BATCH
    assert dauer < 15, f"{dauer:.1f}s für 20.000 Nachrichten"
    assert store.speichern(whatsapp.parse(tmp_path, ctx), backend).neu == 0


def test_insert_fehler_in_einem_batch_kostet_nur_die_kaputte_zeile(tmp_path, ctx):
    zeilen = [f"10.11.26, {n // 60:02d}:{n % 60:02d} - A: Nachricht {n}" for n in range(1200)]
    (tmp_path / "WhatsApp Chat mit Batch.txt").write_text("\n".join(zeilen), encoding="utf-8")

    class EineKaputt(store.FakeBackend):
        def einfuegen(self, zeilen):
            if any(z["text"] == "Nachricht 700" for z in zeilen):
                if len(zeilen) > 1:
                    raise RuntimeError("Batch abgelehnt")
                raise RuntimeError("Zeile abgelehnt")
            return super().einfuegen(zeilen)

    ergebnis = store.speichern(whatsapp.parse(tmp_path, ctx), EineKaputt())
    assert (ergebnis.gelesen, ergebnis.neu, ergebnis.duplikate) == (1200, 1199, 0)
    assert len(ergebnis.fehler) == 1 and "Insert fehlgeschlagen" in ergebnis.fehler[0]
