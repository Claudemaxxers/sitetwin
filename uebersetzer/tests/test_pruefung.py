"""Prüf-Agent ohne Claude und ohne Supabase."""

from uebersetzer.db import SpeicherDB
from uebersetzer.modell import Pruefergebnis, SignalGeloest, SignalVorschlag
from uebersetzer.pruefung import pruefe

P = "BV Simmering"
PLAENE = [
    {"projekt": P, "plan_nr": "E-05", "plan_index": "B", "gueltig_ab": None, "aenderung": None},
    {"projekt": P, "plan_nr": "E-05", "plan_index": "C", "gueltig_ab": "2026-11-10T09:12:00+01:00",
     "aenderung": "Verteiler in Abstellraum"},
]


def e(id_, zeit, art, **kw):
    basis = dict(
        id=id_, projekt=P, quelle_hash=f"h-{id_}", nr=1, zeitpunkt=zeit, art=art, person="Stefan Huber",
        top="Top 5", raum="Vorraum", element="Wohnungsverteiler", zusammenfassung=f"Eintrag {id_}",
        plan_nr=None, plan_index=None, unklar=False, konfidenz=0.9, rueckfrage=None, geprueft_am=None,
    )
    return {**basis, **kw}


def neue_db(eintraege, plaene=PLAENE):
    db = SpeicherDB([], [], [])
    db.eintraege = eintraege
    db.plaene = [dict(p) for p in plaene]
    return db


def test_arbeit_nach_altem_index_wird_signal():
    db = neue_db([
        e("1", "2026-11-12T10:52:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B"),
        e("2", "2026-11-12T15:41:00+01:00", "arbeit_erledigt", plan_nr="E-05", plan_index="B"),
    ])
    b = pruefe(db, None, None)
    assert len(db.signale_liste) == 1
    s = db.signale_liste[0]
    assert s["art"] == "plan_veraltet" and s["schwere"] == "kritisch" and s["status"] == "offen"
    assert s["eintrag_ids"] == ["1", "2"] and b.ergaenzt == 1
    assert "Index C" in s["anruf_text"] and s["anruf_text"].startswith("Servus Stefan")
    assert all(x["geprueft_am"] for x in db.eintraege)


def test_alter_index_vor_der_planaenderung_ist_kein_signal():
    db = neue_db([e("1", "2026-11-09T08:00:00+01:00", "arbeit_erledigt", plan_nr="E-05", plan_index="B")])
    pruefe(db, None, None)
    assert db.signale_liste == []


def test_aktueller_index_und_planaenderung_sind_kein_signal():
    db = neue_db([
        e("1", "2026-11-12T10:00:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="C"),
        e("2", "2026-11-12T10:00:00+01:00", "planaenderung", plan_nr="E-05", plan_index="B"),
    ])
    pruefe(db, None, None)
    assert db.signale_liste == []


def test_arbeit_nach_gueltigem_index_loest_signal():
    db = neue_db([
        e("1", "2026-11-12T10:52:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B"),
        e("2", "2026-11-16T12:00:00+01:00", "arbeit_erledigt", raum="Abstellraum", plan_nr="E-05", plan_index="C"),
    ])
    b = pruefe(db, None, None)
    s = db.signale_liste[0]
    assert s["status"] == "geloest" and s["geloest_durch"] == "2" and len(b.geloest) == 1


def test_wieder_offenes_signal_wird_erneut_angerufen():
    db = neue_db([
        e("1", "2026-11-12T10:52:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B"),
        e("2", "2026-11-16T12:00:00+01:00", "arbeit_erledigt", raum="Abstellraum", plan_nr="E-05", plan_index="C"),
    ])
    pruefe(db, None, None)
    s = db.signale_liste[0]
    assert s["status"] == "geloest"
    # Der Telefon-Agent hatte vor der Lösung schon angerufen
    db.signal_aendern(s["id"], {"angerufen_am": "2026-11-12T11:00:00+01:00", "anruf_id": "conv_1"})
    db.eintraege.append(e("3", "2026-11-17T09:00:00+01:00", "arbeit_erledigt", plan_nr="E-05", plan_index="B"))
    b = pruefe(db, None, None)
    s = db.signale_liste[0]
    assert b.wieder_offen == 1 and s["status"] == "offen"
    assert s["angerufen_am"] is None and s["anruf_id"] is None


def test_erneute_pruefung_erzeugt_nichts_doppelt():
    db = neue_db([e("1", "2026-11-12T10:52:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B")])
    pruefe(db, None, None)
    b = pruefe(db, None, None)
    assert b.eintraege == 0 and len(db.signale_liste) == 1


def test_rueckfrage_nur_bei_unklar_gemeldeter_arbeit():
    db = neue_db([
        e("1", "2026-11-13T09:00:00+01:00", "arbeit_erledigt", top=None, raum=None, element=None,
          unklar=True, konfidenz=0.3, rueckfrage="Wo genau bist du fertig?"),
        e("2", "2026-11-13T09:01:00+01:00", "sonstiges", unklar=True, konfidenz=0.3, rueckfrage="Worauf bezieht sich 'ok'?"),
    ])
    pruefe(db, None, None)
    assert [s["art"] for s in db.signale_liste] == ["unklar"]
    assert "Wo genau" in db.signale_liste[0]["anruf_text"]


def test_claude_signal_und_loesung():
    db = neue_db([
        e("1", "2026-11-13T09:00:00+01:00", "arbeit_geplant", person="Marek (Novak)", top="Top 3", raum="Bad",
          element="Wand 12", zusammenfassung="Marek will Wand 12 heute zumachen"),
        e("2", "2026-11-13T11:00:00+01:00", "problem_behoben", top="Top 3", raum="Bad", element="Wand 12",
          zusammenfassung="Abnahme Elektro Wand 12 ok"),
    ])
    anfragen = []

    def fake(system, messages):
        anfragen.append(messages[0]["content"])
        if len(anfragen) == 1:
            return Pruefergebnis(signale=[SignalVorschlag(
                art="abweichung_plan", schwere="kritisch", kurzschluessel="Wand12-zu-vor-abnahme",
                titel="Top 3 Bad: Wand 12 zu vor Abnahme", begruendung="Elektro-Abnahme fehlt",
                anruf_text="Wand 12 noch nicht zumachen.", zustaendig="Marek (Novak)", top="Top 3", raum="Bad",
                element="Wand 12", eintrag_nrs=[1])], geloest=[])
        return Pruefergebnis(signale=[], geloest=[SignalGeloest(schluessel="ki|Top 3|wand12-zu-vor-abnahme", eintrag_nr=1, begruendung="Abnahme ok")])

    b = pruefe(db, None, fake)
    assert b.claude_aufrufe == 2
    s = db.signale_liste[0]
    assert s["schluessel"] == "ki|Top 3|wand12-zu-vor-abnahme" and s["status"] == "geloest" and s["geloest_durch"] == "2"
    assert "ki|Top 3|wand12-zu-vor-abnahme" in anfragen[1]  # offenes Signal wird im zweiten Aufruf mitgegeben
    assert "Marek will Wand 12" in anfragen[1]  # Stand der Baustelle enthält den früheren Eintrag


def test_claude_darf_regel_signale_nicht_loesen():
    db = neue_db([
        e("1", "2026-11-12T10:52:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B"),
        e("2", "2026-11-12T15:38:00+01:00", "planaenderung", person="Andrea Gruber", zusammenfassung="Index C gilt"),
    ])
    schluessel = "plan_veraltet|Top 5|E-05|wohnungsverteiler"

    def fake(system, messages):
        assert "loesbar=\"ja\">\n(keine)" in messages[0]["content"]
        return Pruefergebnis(signale=[], geloest=[SignalGeloest(schluessel=schluessel, eintrag_nr=1, begruendung="geklärt")])

    pruefe(db, None, fake)
    assert db.signale_liste[0]["schluessel"] == schluessel and db.signale_liste[0]["status"] == "offen"


def test_claude_fehler_laesst_gruppe_ungeprueft():
    db = neue_db([e("1", "2026-11-13T09:00:00+01:00", "arbeit_geplant")])

    def kaputt(system, messages):
        raise ValueError("kaputt")

    b = pruefe(db, None, kaputt)
    assert b.fehler and not db.eintraege[0]["geprueft_am"]


def test_reihenfolge_vorschlaege_von_claude_werden_verworfen():
    db = neue_db([e("1", "2026-11-13T09:00:00+01:00", "arbeit_geplant")])

    def fake(system, messages):
        return Pruefergebnis(signale=[SignalVorschlag(
            art="reihenfolge", schwere="hoch", kurzschluessel="x", titel="Wand zu", begruendung="b", anruf_text="a",
            zustaendig=None, top="Top 5", raum=None, element=None, eintrag_nrs=[1])], geloest=[])

    pruefe(db, None, fake)
    assert db.signale_liste == []


# --- Lernschleife: Rückmeldungen der Baustelle (signale.bewertung) ---------------

NOTIZ = "per WhatsApp, Stefan Huber, 14.11. 12:03: 👎"


def _bewerten(db, bewertung, notiz=NOTIZ):
    s = db.signale_liste[-1]
    db.signal_aendern(s["id"], {"bewertung": bewertung, "bewertung_notiz": notiz})
    return s


def test_fehlalarm_wird_bei_gleicher_lage_abgestuft_statt_ergaenzt():
    db = neue_db([e("1", "2026-11-12T10:52:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B")])
    pruefe(db, None, None)
    alt = _bewerten(db, "fehlalarm")
    alt_vorher = dict(alt)
    db.eintraege.append(e("2", "2026-11-12T15:41:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B"))
    b = pruefe(db, None, None)

    assert len(db.signale_liste) == 2
    assert alt == alt_vorher  # bewertetes Signal bleibt unverändert stehen, samt Bewertung
    neu = db.signale_liste[1]
    assert neu["schluessel"] == alt["schluessel"] + "#nach-fehlalarm-1"
    assert neu["status"] == "offen" and neu["schwere"] == "mittel" and neu["eintrag_ids"] == ["2"]
    assert neu["titel"].startswith("Früher als Fehlalarm bewertet: ")  # sichtbar in WhatsApp und Web-App
    assert NOTIZ in neu["begruendung"] and "sonst kritisch" in neu["begruendung"]
    assert neu["anruf_text"].startswith("Servus Stefan") and "Fehlalarm" in neu["anruf_text"]
    assert neu.get("bewertung") is None
    assert b.abgestuft == [neu["titel"]] and b.ergaenzt == 0 and b.wieder_offen == 0

    # weitere Belege landen im Folgesignal, bleiben abgestuft, kein drittes Signal
    db.eintraege.append(e("3", "2026-11-13T08:00:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B"))
    pruefe(db, None, None)
    assert len(db.signale_liste) == 2
    assert db.signale_liste[1]["eintrag_ids"] == ["2", "3"] and db.signale_liste[1]["schwere"] == "mittel"


def test_geloester_fehlalarm_wird_nicht_wieder_geoeffnet():
    db = neue_db([
        e("1", "2026-11-12T10:52:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B"),
        e("2", "2026-11-16T12:00:00+01:00", "arbeit_erledigt", raum="Abstellraum", plan_nr="E-05", plan_index="C"),
    ])
    pruefe(db, None, None)
    alt = _bewerten(db, "fehlalarm")
    assert alt["status"] == "geloest"
    db.eintraege.append(e("3", "2026-11-17T09:00:00+01:00", "arbeit_erledigt", plan_nr="E-05", plan_index="B"))
    b = pruefe(db, None, None)
    assert alt["status"] == "geloest" and b.wieder_offen == 0
    neu = db.signale_liste[1]
    assert neu["status"] == "offen" and neu["schwere"] == "mittel" and neu["titel"].startswith("Früher als Fehlalarm")


def test_folgesignal_loest_sich_wie_das_original():
    db = neue_db([e("1", "2026-11-12T10:52:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B")])
    pruefe(db, None, None)
    _bewerten(db, "fehlalarm")
    db.eintraege += [
        e("2", "2026-11-12T15:41:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B"),
        e("3", "2026-11-16T12:00:00+01:00", "arbeit_erledigt", raum="Abstellraum", plan_nr="E-05", plan_index="C"),
    ]
    pruefe(db, None, None)
    assert db.signale_liste[1]["status"] == "geloest" and db.signale_liste[1]["geloest_durch"] == "3"


def test_berechtigt_bleibt_wie_bisher():
    db = neue_db([
        e("1", "2026-11-12T10:52:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B"),
        e("2", "2026-11-16T12:00:00+01:00", "arbeit_erledigt", raum="Abstellraum", plan_nr="E-05", plan_index="C"),
    ])
    pruefe(db, None, None)
    s = _bewerten(db, "berechtigt", "per WhatsApp, Stefan Huber, 14.11. 12:03: 👍")
    db.eintraege.append(e("3", "2026-11-17T09:00:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B"))
    b = pruefe(db, None, None)
    assert len(db.signale_liste) == 1 and b.wieder_offen == 1 and not b.abgestuft
    assert s["status"] == "offen" and s["schwere"] == "kritisch" and "Fehlalarm" not in s["titel"]
    assert s["bewertung"] == "berechtigt"  # Bewertung bleibt beim Wiederöffnen stehen


def test_claude_prompt_enthaelt_rueckmeldungen_der_baustelle():
    db = neue_db([e("1", "2026-11-12T10:52:00+01:00", "arbeit_geplant", plan_nr="E-05", plan_index="B")])
    pruefe(db, None, None)
    _bewerten(db, "fehlalarm")
    db.signale_liste.append({
        "id": "x", "projekt": P, "schluessel": "ki|Top 3|wand12", "art": "abweichung_plan", "status": "geloest",
        "titel": "Top 3 Bad: Wand 12 zu vor Abnahme", "bewertung": "berechtigt", "bewertung_notiz": None,
    })
    db.eintraege.append(e("2", "2026-11-13T09:00:00+01:00", "arbeit_geplant", zusammenfassung="neu"))
    anfragen = []

    def fake(system, messages):
        anfragen.append((system, messages[0]["content"]))
        return Pruefergebnis(signale=[], geloest=[])

    pruefe(db, None, fake)
    system, text = anfragen[0]
    block = text.split("<rueckmeldungen_der_baustelle")[1].split("</rueckmeldungen_der_baustelle>")[0]
    assert f"- fehlalarm · plan_veraltet · Top 5 / Vorraum / Wohnungsverteiler: nach Index B statt C · {NOTIZ}" in block
    assert "- berechtigt · abweichung_plan · Top 3 Bad: Wand 12 zu vor Abnahme" in block
    assert text.index("</rueckmeldungen_der_baustelle>") < text.index("<neue_eintraege")
    assert system[-1]["cache_control"] == {"type": "ephemeral"}  # Caching unverändert
    assert "rueckmeldungen_der_baustelle" in system[0]["text"]


def test_claude_prompt_ohne_rueckmeldungen():
    db = neue_db([e("1", "2026-11-13T09:00:00+01:00", "arbeit_geplant")])
    texte = []
    pruefe(db, None, lambda s, m: texte.append(m[0]["content"]) or Pruefergebnis(signale=[], geloest=[]))
    assert "<rueckmeldungen_der_baustelle hinweis=\"Bewertungen früherer Warnungen, jüngste zuerst\">\n(keine)\n" in texte[0]
