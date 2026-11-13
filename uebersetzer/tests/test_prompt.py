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
