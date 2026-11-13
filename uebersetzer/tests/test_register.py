"""Bauteil-Register und Bauteil-Regeln, ohne Claude und ohne Supabase."""

from uebersetzer.db import SpeicherDB, element_schluessel
from uebersetzer.modell import Plan, SollElement
from uebersetzer.pruefung import pruefe
from uebersetzer.register import bauteil_liste, soll_uebernehmen

P = "BV Simmering"
TOPS = ["Top 3", "Top 5"]


def soll(bez, art, raum="Bad", top="Top 3", gehoert_zu=None, lage=None):
    return SollElement(bezeichnung=bez, art=art, top=top, raum=raum, lage=lage, anzahl=1, gehoert_zu=gehoert_zu)


def plan(nr, idx):
    return Plan(plan_nr=nr, plan_index=idx, bezeichnung=None, top=None, aenderung=None)


def wand_plan(db):
    soll_uebernehmen(db, P, [
        soll("Wand B1", "wand"),
        soll("Leitung F4 Waschtisch", "leitung", gehoert_zu="Wand B1"),
        soll("Steckdose Waschtisch", "dose", gehoert_zu="Wand B1"),
    ], plan("E-03", "A"), "h-plan", TOPS)
    return {e["bezeichnung"]: e for e in db.elemente(P)}


def e(id_, zeit, art, element_id, schritt, **kw):
    basis = dict(
        id=id_, projekt=P, quelle_hash=f"h-{id_}", nr=1, zeitpunkt=zeit, art=art, person="Marek Novak",
        top="Top 3", raum="Bad", element=None, zusammenfassung=f"Eintrag {id_}", plan_nr=None, plan_index=None,
        unklar=False, konfidenz=0.9, rueckfrage=None, geprueft_am=None, element_id=element_id, schritt=schritt,
    )
    return {**basis, **kw}


def test_soll_uebernehmen_legt_bauteile_mit_wand_an():
    db = SpeicherDB([], [], [])
    el = wand_plan(db)
    assert set(el) == {"Wand B1", "Leitung F4 Waschtisch", "Steckdose Waschtisch"}
    assert el["Steckdose Waschtisch"]["gehoert_zu"] == el["Wand B1"]["id"]
    assert el["Wand B1"]["schluessel"] == element_schluessel("Top 3", "Bad", "Wand B1") == "top 3|bad|wand b1"
    assert "top 3|bad|steckdose waschtisch · dose · in Wand B1 · Plan E-03 A" in bauteil_liste(db.elemente(P))


def test_neuer_index_deaktiviert_entfallene_bauteile_und_alter_ueberschreibt_nicht():
    db = SpeicherDB([], [], [])
    soll_uebernehmen(db, P, [soll("Wohnungsverteiler", "verteiler", raum="Vorraum", top="Top 5")], plan("E-05", "B"), "hB", TOPS)
    b = soll_uebernehmen(db, P, [soll("Wohnungsverteiler", "verteiler", raum="Abstellraum", top="Top 5")], plan("E-05", "C"), "hC", TOPS)
    assert b.neu == 1 and b.deaktiviert == 1
    nach_raum = {x["raum"]: x for x in db.elemente(P)}
    assert not nach_raum["Vorraum"]["soll_aktiv"] and nach_raum["Abstellraum"]["soll_aktiv"]
    # Index B nochmal (z. B. Drive-Datei später importiert) darf C nicht kaputtmachen
    soll_uebernehmen(db, P, [soll("Wohnungsverteiler", "verteiler", raum="Vorraum", top="Top 5")], plan("E-05", "B"), "hB", TOPS)
    nach_raum = {x["raum"]: x for x in db.elemente(P)}
    assert nach_raum["Abstellraum"]["soll_aktiv"]
    assert "ENTFÄLLT" in bauteil_liste(db.elemente(P))


def test_wand_zu_angekuendigt_bevor_installation_fertig_ist_kritisch():
    db = SpeicherDB([], [], [])
    el = wand_plan(db)
    db.eintraege = [
        e("1", "2026-11-13T08:00:00+01:00", "arbeit_erledigt", el["Leitung F4 Waschtisch"]["id"], "leitung_eingezogen"),
        e("2", "2026-11-13T09:00:00+01:00", "arbeit_geplant", el["Wand B1"]["id"], "beplankung"),
    ]
    pruefe(db, None, None)
    [s] = db.signale_liste
    assert s["art"] == "reihenfolge" and s["schwere"] == "kritisch" and s["element_id"] == el["Wand B1"]["id"]
    assert "Steckdose Waschtisch" in s["anruf_text"] and "Abnahme" not in s["anruf_text"]  # Abnahme blockiert nicht
    assert "Leitung F4" not in s["anruf_text"]  # ist schon erledigt
    assert s["anruf_text"].startswith("Servus Marek") and "noch nicht zumachen" in s["anruf_text"]


def test_wand_zu_ist_ok_wenn_installation_drin_ist():
    db = SpeicherDB([], [], [])
    el = wand_plan(db)
    db.eintraege = [
        e("1", "2026-11-13T08:00:00+01:00", "arbeit_erledigt", el["Leitung F4 Waschtisch"]["id"], "leitung_eingezogen"),
        e("2", "2026-11-13T08:10:00+01:00", "arbeit_erledigt", el["Steckdose Waschtisch"]["id"], "gesetzt"),
        e("3", "2026-11-13T08:30:00+01:00", "arbeit_erledigt", el["Wand B1"]["id"], "abnahme"),
        e("4", "2026-11-13T09:00:00+01:00", "arbeit_geplant", el["Wand B1"]["id"], "beplankung"),
    ]
    pruefe(db, None, None)
    assert db.signale_liste == []


def test_reihenfolge_signal_loest_sich_wenn_installation_nachgeholt_wird():
    db = SpeicherDB([], [], [])
    el = wand_plan(db)
    db.eintraege = [
        e("1", "2026-11-13T09:00:00+01:00", "arbeit_geplant", el["Wand B1"]["id"], "beplankung"),
        e("2", "2026-11-13T10:00:00+01:00", "arbeit_erledigt", el["Leitung F4 Waschtisch"]["id"], "leitung_eingezogen"),
        e("3", "2026-11-13T10:10:00+01:00", "arbeit_erledigt", el["Steckdose Waschtisch"]["id"], "gesetzt"),
        e("4", "2026-11-13T11:00:00+01:00", "arbeit_erledigt", el["Wand B1"]["id"], "abnahme"),
    ]
    b = pruefe(db, None, None)
    [s] = db.signale_liste
    assert s["status"] == "geloest" and s["geloest_durch"] == "3" and len(b.geloest) == 1  # mit der letzten fehlenden Dose


def test_arbeit_an_entfallenem_bauteil_und_loesung_am_neuen_ort():
    db = SpeicherDB([], [], [])
    soll_uebernehmen(db, P, [soll("Wohnungsverteiler", "verteiler", raum="Vorraum", top="Top 5")], plan("E-05", "B"), "hB", TOPS)
    soll_uebernehmen(db, P, [soll("Wohnungsverteiler", "verteiler", raum="Abstellraum", top="Top 5")], plan("E-05", "C"), "hC", TOPS)
    raum = {x["raum"]: x["id"] for x in db.elemente(P)}
    db.plaene = [
        {"projekt": P, "plan_nr": "E-05", "plan_index": "B", "gueltig_ab": None},
        {"projekt": P, "plan_nr": "E-05", "plan_index": "C", "gueltig_ab": "2026-11-10T09:12:00+01:00"},
    ]
    db.eintraege = [
        # Übersetzer kennt den Index (B) und das Bauteil → beide Regeln, aber nur ein Signal
        e("1", "2026-11-12T15:41:00+01:00", "arbeit_erledigt", raum["Vorraum"], "gesetzt", top="Top 5", raum="Vorraum",
          plan_nr="E-05", plan_index="B", person="Stefan Huber"),
        e("2", "2026-11-16T12:00:00+01:00", "arbeit_erledigt", raum["Abstellraum"], "gesetzt", top="Top 5", raum="Abstellraum",
          person="Stefan Huber"),
    ]
    pruefe(db, None, None)
    [s] = db.signale_liste
    assert s["art"] == "plan_veraltet" and s["schluessel"] == f"plan_veraltet|{raum['Vorraum']}"
    assert s["status"] == "geloest" and s["geloest_durch"] == "2"


def test_szenario_wand_top5_abstellraum_ohne_wand_im_plan():
    """Santinos Szenario (fake_data/szenarien/wand_top5): Plan E-05 kennt nur den Verteiler, keine Wand.
    Trockenbau kündigt an, im Abstellraum zuzumachen → Signal an den Elektro-Vorarbeiter. Gelöst, sobald der Verteiler gesetzt ist."""
    db = SpeicherDB([], [], [])
    db.personen_liste = [
        {"projekt": P, "name": "Stefan Huber", "aliase": [], "firma": "Elektro Gruber GmbH", "rolle": "vorarbeiter", "darf_soll_aendern": False},
        {"projekt": P, "name": "Marko Novak", "aliase": [], "firma": "Novak Trockenbau", "rolle": "vorarbeiter", "darf_soll_aendern": False},
    ]
    soll_uebernehmen(db, P, [soll("Wohnungsverteiler", "verteiler", raum="Vorraum", top="Top 5")], plan("E-05", "B"), "hB", TOPS)
    soll_uebernehmen(db, P, [soll("Wohnungsverteiler", "verteiler", raum="Abstellraum", top="Top 5")], plan("E-05", "C"), "hC", TOPS)
    wv = next(x for x in db.elemente_liste if x["raum"] == "Abstellraum")
    db.eintraege = [
        e("1", "2026-11-13T17:20:00+01:00", "arbeit_geplant", None, "beplankung", person="Marko Novak (Novak Trockenbau)",
          top="Top 5", raum="Abstellraum, Vorraum"),
        e("2", "2026-11-13T17:22:00+01:00", "arbeit_geplant", None, "beplankung", person="Marko Novak (Novak Trockenbau)",
          top="Top 4", raum="Vorraum, Küche"),  # Falle F1: Top 4 hat keine offene Installation im Register
        e("3", "2026-11-14T06:05:00+01:00", "arbeit_geplant", wv["id"], "verrohrung", top="Top 5", raum="Abstellraum", person="Stefan Huber"),
        e("4", "2026-11-14T06:52:00+01:00", "arbeit_erledigt", wv["id"], "gesetzt", top="Top 5", raum="Abstellraum", person="Ali Demir"),
    ]
    pruefe(db, None, None)
    [s] = db.signale_liste
    assert s["art"] == "reihenfolge" and s["schwere"] == "kritisch" and s["zustaendig"] == "Stefan Huber"
    assert s["anruf_text"].startswith("Servus Stefan") and "Wohnungsverteiler (Plan E-05 C)" in s["anruf_text"]
    assert "Marko Novak" in s["anruf_text"]
    assert s["status"] == "geloest" and s["geloest_durch"] == "4"  # 06:05 ("ziehen jetzt ein") löst noch nicht
