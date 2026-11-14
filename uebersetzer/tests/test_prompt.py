"""Der Prompt enthält, was Claude braucht – und den Lösungsschlüssel nie."""

from pathlib import Path

from uebersetzer import anhang, prompt, testquellen
from uebersetzer.extraktion import baue_anfrage
from uebersetzer.lauf import zeitachse_vor

FAKE = Path(__file__).resolve().parents[2] / "fake_data"


def test_anfrage_aufbau(tmp_path):
    quellen = sorted(testquellen.alle(FAKE, "BV Simmering", tmp_path), key=lambda q: str(q["zeitpunkt"] or ""))
    tops, lv = testquellen.stammdaten_aus_csv(FAKE / "drive" / "Projekt_Simmering", "BV Simmering")
    foto = next(q for q in quellen if q["anhang_typ"] == "image")
    bloecke, hinweis = anhang.inhaltsbloecke(foto, Path(foto["anhang_pfad"]).read_bytes())
    system, messages = baue_anfrage(
        foto, bloecke, hinweis, zeitachse_vor(foto, quellen, 40),
        [{"plan_nr": "E-05", "plan_index": "C", "gueltig_ab": "2026-11-10T09:12:00+01:00"}],
        prompt.stammdaten_block("BV Simmering", tops, lv),
    )
    assert system[-1]["cache_control"] == {"type": "ephemeral"}
    assert "02.02.010" in system[1]["text"] and "Top 5" in system[1]["text"]
    inhalt = messages[0]["content"]
    assert inhalt[0]["type"] == "image" and inhalt[0]["source"]["media_type"] == "image/jpeg"
    text = inhalt[-1]["text"]
    assert "E-05 Index C" in text and "<neue_quelle>" in text and "Foto" in text
    alles = str(system) + str(messages)
    assert "ERWARTET" not in alles and "Golden" not in alles and "Fallen" not in alles


def test_pdf_ohne_text_wird_ausgelesen():
    pdf = (FAKE / "drive" / "Projekt_Simmering" / "Plaene" / "Plan_E-05_Top5_IndexC.pdf").read_bytes()
    q = {"anhang_pfad": "x.pdf", "anhang_name": "Plan_E-05_Top5_IndexC.pdf", "anhang_typ": "pdf", "text": ""}
    bloecke, _ = anhang.inhaltsbloecke(q, pdf)
    assert bloecke[0]["type"] == "text" and "Index C" in bloecke[0]["text"]
    q["text"] = "schon da"
    assert anhang.inhaltsbloecke(q, pdf) == ([], None)


def _heic(breite=64, hoehe=48) -> bytes:
    import io

    import pillow_heif
    from PIL import Image

    pillow_heif.register_heif_opener()
    aus = io.BytesIO()
    Image.new("RGB", (breite, hoehe), (200, 120, 40)).save(aus, format="HEIF")
    return aus.getvalue()


def _bild(block) -> "Image.Image":
    import base64
    import io

    from PIL import Image

    return Image.open(io.BytesIO(base64.b64decode(block["source"]["data"])))


def test_heic_wird_zu_jpeg():
    """iPhone-Fotos (HEIC) nimmt Claude nicht an: der Übersetzer wandelt sie in JPEG um."""
    q = {"anhang_pfad": "x/IMG_0042.HEIC", "anhang_name": "IMG_0042.HEIC", "anhang_typ": "image", "text": ""}
    bloecke, hinweis = anhang.inhaltsbloecke(q, _heic())
    assert bloecke[0]["type"] == "image" and bloecke[0]["source"]["media_type"] == "image/jpeg"
    bild = _bild(bloecke[0])
    assert bild.format == "JPEG" and bild.size == (64, 48)
    assert "Foto" in hinweis


def test_heic_wird_verkleinert():
    q = {"anhang_pfad": "x/gross.heic", "anhang_name": "gross.heic", "anhang_typ": "image", "text": ""}
    bloecke, _ = anhang.inhaltsbloecke(q, _heic(4032, 3024))
    assert max(_bild(bloecke[0]).size) == anhang.MAX_KANTE


def test_heic_mit_falscher_endung_und_heif_ohne_bildtyp():
    # HEIC-Inhalt unter .jpg: am Dateikopf erkannt, sonst ginge kaputtes "JPEG" an Claude.
    q = {"anhang_pfad": "x/foto.jpg", "anhang_name": "foto.jpg", "anhang_typ": "image", "text": ""}
    bloecke, _ = anhang.inhaltsbloecke(q, _heic())
    assert _bild(bloecke[0]).format == "JPEG"
    # .heif stuft die Ablage nicht als Bild ein; die Endung reicht.
    q = {"anhang_pfad": "x/foto.heif", "anhang_name": "foto.heif", "anhang_typ": "sonstiges", "text": ""}
    bloecke, _ = anhang.inhaltsbloecke(q, _heic())
    assert bloecke[0]["source"]["media_type"] == "image/jpeg"


def test_kaputtes_heic_gibt_hinweis_statt_absturz():
    q = {"anhang_pfad": "x/kaputt.heic", "anhang_name": "kaputt.heic", "anhang_typ": "image", "text": ""}
    bloecke, hinweis = anhang.inhaltsbloecke(q, b"kein bild")
    assert bloecke == [] and "konnte nicht gelesen werden" in hinweis


def test_jpeg_bleibt_unveraendert():
    daten = b"\xff\xd8\xff\xe0" + b"0" * 32
    q = {"anhang_pfad": "x/a.jpg", "anhang_name": "a.jpg", "anhang_typ": "image", "text": ""}
    bloecke, _ = anhang.inhaltsbloecke(q, daten)
    import base64

    assert base64.b64decode(bloecke[0]["source"]["data"]) == daten
