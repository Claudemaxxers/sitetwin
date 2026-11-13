"""Soll-Änderungen während der Bauphase: Rollen, Freigabe, Nachweis – ohne Claude und ohne Supabase."""

from uebersetzer.db import SpeicherDB
from uebersetzer.modell import Plan, SollElement
from uebersetzer.pruefung import pruefe
from uebersetzer.register import soll_aenderungen_liste, soll_uebernehmen
from uebersetzer.soll import darf_soll_aendern, person_finden

P = "BV Simmering"
PERSONEN = [
    {"projekt": P, "name": "Thomas Meier", "aliase": ["Thomas Meier (Krenn Bau)"], "rolle": "bauleitung", "darf_soll_aendern": True},
    {"projekt": P, "name": "Stefan Huber", "aliase": [], "rolle": "vorarbeiter", "darf_soll_aendern": False},
]
DOSE_ALT = "top 3|bad|steckdose ip44 waschtisch"
DOSE_NEU = {"bezeichnung": "Steckdose IP44 Waschtisch links", "art": "dose", "top": "Top 3", "raum": "Bad",
            "lage": "40 cm weiter links", "anzahl": 1, "gehoert_zu": "Wand W3-02"}


def neue_db():
    db = SpeicherDB([], [{"projekt": P, "top": "Top 3"}], [])
    db.personen_liste = [dict(p) for p in PERSONEN]
    soll_uebernehmen(db, P, [
        SollElement(bezeichnung="Wand W3-02", art="wand", top="Top 3", raum="Bad", lage=None, anzahl=1, gehoert_zu=None),
        SollElement(bezeichnung="Steckdose IP44 Waschtisch", art="dose", top="Top 3", raum="Bad", lage=None, anzahl=1, gehoert_zu="Wand W3-02"),
    ], Plan(plan_nr="E-03", plan_index="A", bezeichnung=None, top=None, aenderung=None), "h-plan", ["Top 3"])
    return db


def quelle(hash_, anhang_typ=None):
    return {"content_hash": hash_, "projekt": P, "typ": "whatsapp", "anhang_typ": anhang_typ,
            "anhang_pfad": f"x/{hash_}" if anhang_typ else None, "zeitpunkt": None, "original_ref": hash_}


def e(id_, zeit, art, person, soll=None, element_id=None, top="Top 3", raum="Bad", **kw):
    return {
        "id": id_, "projekt": P, "quelle_hash": f"h-{id_}", "nr": 1, "zeitpunkt": zeit, "art": art, "person": person,
        "top": top, "raum": raum, "element": None, "zusammenfassung": f"Eintrag {id_}", "plan_nr": None, "plan_index": None,
        "unklar": False, "konfidenz": 0.9, "rueckfrage": None, "geprueft_am": None, "element_id": element_id,
        "schritt": None, "soll": soll, **kw,
    }


def aenderung(**kw):
    return {"bezug": None, "freigabe_ja": None, "titel": "Waschtisch-Steckdose 40 cm nach links", "neues_soll": "Steckdose 40 cm links",
            "bauteile_neu": [DOSE_NEU], "bauteile_entfallen": [DOSE_ALT], **kw}


def test_person_und_berechtigung():
    assert person_finden("Thomas Meier (Krenn Bau)", PERSONEN)["name"] == "Thomas Meier"
    assert person_finden("Thomas Meier <t.meier@krenn-bau.example>", PERSONEN)["name"] == "Thomas Meier"
    assert darf_soll_aendern("Thomas Meier (Krenn Bau)", PERSONEN)
    assert not darf_soll_aendern("Stefan Huber", PERSONEN) and not darf_soll_aendern("Unbekannt", PERSONEN)


def test_bauleitung_aendert_soll_direkt_aber_nachweis_fehlt():
    db = neue_db()
    db.quellen = [quelle("h-1", "audio")]
    db.eintraege = [e("1", "2026-11-13T09:00:00+01:00", "soll_aenderung", "Thomas Meier (Krenn Bau)", aenderung())]
    b = pruefe(db, None, None)
    [sa] = db.soll_liste
    assert sa["status"] == "freigegeben" and sa["nachweis_status"] == "fehlt"  # Sprachnachricht ist kein Nachweis
    nach = {x["schluessel"]: x for x in db.elemente_liste}
    assert not nach[DOSE_ALT]["soll_aktiv"]
    assert nach["top 3|bad|steckdose ip44 waschtisch links"]["soll_plan_nr"] == "Änderung"
    assert any("freigegeben" in s for s in b.soll)
    assert "Nachweis fehlt" in soll_aenderungen_liste(db.soll_liste)


def test_arbeiter_meldet_aenderung_signal_bleibt_bis_freigabe():
    db = neue_db()
    dose_id = next(x["id"] for x in db.elemente_liste if x["schluessel"] == DOSE_ALT)
    db.signale_liste = [{"id": "s1", "projekt": P, "schluessel": "ki|Top 3|dose-falsch", "art": "abweichung_plan",
                         "titel": "Dose woanders", "status": "offen", "element_id": dose_id, "top": "Top 3", "raum": "Bad",
                         "eintrag_ids": [], "quelle_hashes": []}]
    db.quellen = [quelle("h-1"), quelle("h-2")]
    db.eintraege = [e("1", "2026-11-13T09:00:00+01:00", "soll_aenderung", "Stefan Huber", aenderung(), element_id=dose_id)]
    pruefe(db, None, None)
    [sa] = db.soll_liste
    assert sa["status"] == "vorgeschlagen" and sa["signal_ids"] == ["s1"]
    assert db.signale_liste[0]["status"] == "offen"  # Arbeiter ist noch nicht freigegeben
    assert next(x for x in db.elemente_liste if x["schluessel"] == DOSE_ALT)["soll_aktiv"]  # Register unverändert

    db.eintraege.append(e("2", "2026-11-13T09:30:00+01:00", "freigabe", "Thomas Meier (Krenn Bau)",
                          {**aenderung(), "bezug": sa["schluessel"], "freigabe_ja": True}))
    pruefe(db, None, None)
    assert sa["status"] == "freigegeben" and sa["freigegeben_von"] == "Thomas Meier (Krenn Bau)"
    assert db.signale_liste[0]["status"] == "geloest" and db.signale_liste[0]["geloest_durch"] == "2"
    assert not next(x for x in db.elemente_liste if x["schluessel"] == DOSE_ALT)["soll_aktiv"]


def test_freigabe_durch_unberechtigte_wird_ignoriert_und_ablehnung_wirkt():
    db = neue_db()
    db.quellen = [quelle("h-1"), quelle("h-2"), quelle("h-3")]
    db.eintraege = [e("1", "2026-11-13T09:00:00+01:00", "soll_aenderung", "Stefan Huber", aenderung())]
    pruefe(db, None, None)
    [sa] = db.soll_liste
    db.eintraege.append(e("2", "2026-11-13T09:10:00+01:00", "freigabe", "Stefan Huber",
                          {**aenderung(), "bezug": sa["schluessel"], "freigabe_ja": True}))
    pruefe(db, None, None)
    assert sa["status"] == "vorgeschlagen"
    db.eintraege.append(e("3", "2026-11-13T09:20:00+01:00", "freigabe", "Thomas Meier",
                          {**aenderung(), "bezug": sa["schluessel"], "freigabe_ja": False}))
    pruefe(db, None, None)
    assert sa["status"] == "abgelehnt"
    assert soll_aenderungen_liste(db.soll_liste) == "(keine)"


def test_nachweis_nur_als_dokument_der_bauleitung():
    db = neue_db()
    db.quellen = [quelle("h-1", "audio"), quelle("h-2", "image"), quelle("h-3", "image")]
    db.eintraege = [e("1", "2026-11-13T09:00:00+01:00", "soll_aenderung", "Thomas Meier", aenderung())]
    pruefe(db, None, None)
    [sa] = db.soll_liste
    # Foto vom Vorarbeiter zählt nicht
    db.eintraege.append(e("2", "2026-11-13T10:00:00+01:00", "nachweis", "Stefan Huber", {**aenderung(), "bezug": sa["schluessel"]}))
    pruefe(db, None, None)
    assert sa["nachweis_status"] == "fehlt"
    # Foto des Dokuments von der Bauleitung zählt
    db.eintraege.append(e("3", "2026-11-13T11:00:00+01:00", "nachweis", "Thomas Meier", {**aenderung(), "bezug": sa["schluessel"]}))
    b = pruefe(db, None, None)
    assert sa["nachweis_status"] == "vorhanden" and sa["nachweis_quelle_hash"] == "h-3"
    assert any("Nachweis" in s for s in b.soll)


def test_zweite_pruefung_legt_soll_aenderung_nicht_doppelt_an():
    db = neue_db()
    db.quellen = [quelle("h-1")]
    db.eintraege = [e("1", "2026-11-13T09:00:00+01:00", "soll_aenderung", "Stefan Huber", aenderung())]
    pruefe(db, None, None)
    db.eintraege[0]["geprueft_am"] = None
    pruefe(db, None, None)
    assert len(db.soll_liste) == 1
