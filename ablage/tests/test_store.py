from ablage import store
from ablage.adapters import call, whatsapp
from ablage.models import ParseFehler

from .conftest import CALL, WA


def test_erster_import_39_neu_zweiter_0(ctx):
    backend = store.FakeBackend()
    eins = store.speichern(whatsapp.parse(WA, ctx), backend)
    assert (eins.gelesen, eins.neu, eins.duplikate, eins.fehler) == (39, 39, 0, [])
    assert len(backend.zeilen) == 39 and len(backend.dateien) == 5

    zwei = store.speichern(whatsapp.parse(WA, ctx), backend)
    assert (zwei.gelesen, zwei.neu, zwei.duplikate, zwei.fehler) == (39, 0, 39, [])
    assert len(backend.zeilen) == 39 and backend.uploads == 5  # no double upload


def test_zeilen_passen_zur_tabelle(ctx):
    backend = store.FakeBackend()
    store.speichern(whatsapp.parse(WA, ctx), backend)
    spalten = {
        "typ", "projekt", "kanal", "absender", "zeitpunkt", "text", "anhang_pfad", "anhang_typ",
        "anhang_name", "original_ref", "content_hash", "status", "meta",
    }  # fmt: skip
    for z in backend.zeilen.values():
        assert set(z) == spalten
        assert z["status"] == "neu" and z["typ"] == "whatsapp"
    mit_anhang = [z for z in backend.zeilen.values() if z["anhang_pfad"]]
    assert len(mit_anhang) == 5
    for z in mit_anhang:
        assert z["anhang_pfad"].startswith("bv-simmering/whatsapp/")
        assert z["anhang_pfad"] in backend.dateien
        assert z["anhang_pfad"].endswith((".jpg", ".opus"))


def test_parsefehler_landen_im_ergebnis():
    ergebnis = store.speichern([ParseFehler(ref="x.txt#L3", grund="kaputt")], store.FakeBackend())
    assert ergebnis.gelesen == 0 and ergebnis.fehler == ["x.txt#L3: kaputt"]


def test_upload_fehler_isoliert(ctx):
    class Kaputt(store.FakeBackend):
        def upload(self, pfad, daten, mimetype):
            if pfad.endswith(".opus"):
                raise OSError("Storage weg")
            super().upload(pfad, daten, mimetype)

    backend = Kaputt()
    ergebnis = store.speichern(whatsapp.parse(WA, ctx), backend)
    assert (ergebnis.gelesen, ergebnis.neu, ergebnis.duplikate) == (39, 37, 0)
    assert len(ergebnis.fehler) == 2


def test_call_zweimal_eine_zeile(ctx):
    backend = store.FakeBackend()
    assert store.speichern(call.parse(CALL, ctx), backend).neu == 1
    zwei = store.speichern(call.parse(CALL, ctx), backend)
    assert (zwei.neu, zwei.duplikate) == (0, 1)


def test_slug():
    assert store.slug("BV Simmering") == "bv-simmering"
    assert store.slug("Öko-Straße 12 / Top") == "oeko-strasse-12-top"
