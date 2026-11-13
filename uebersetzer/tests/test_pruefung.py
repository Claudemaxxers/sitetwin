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
                art="reihenfolge", schwere="kritisch", kurzschluessel="Wand12-zu-vor-abnahme",
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
