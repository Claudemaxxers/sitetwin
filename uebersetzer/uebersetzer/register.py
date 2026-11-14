"""Component register: take over Soll components from plans and provide them for assignment.

Rules when taking over a plan (plan_nr X, index I):
- Components from the plan are created or updated to index I (soll_aktiv = true).
- Components that an older index of X contained and index I no longer does become soll_aktiv = false.
  Example: distribution board in the Vorraum (index B) → inactive after index C, board in the Abstellraum new.
- An older index never overwrites components of a newer one.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from .db import DB, Zeile, element_schluessel
from .modell import Plan, SollElement

log = logging.getLogger("register")


@dataclass
class RegisterBericht:
    neu: int = 0
    aktualisiert: int = 0
    deaktiviert: int = 0
    element_ids: list = None  # newly created or updated components (only filled for Soll changes)


def _top(top: str | None, bekannte: list[str]) -> str | None:
    if not top:
        return None
    for b in bekannte:
        if b.lower().replace(" ", "") == top.lower().replace(" ", ""):
            return b
    return top


def soll_uebernehmen(
    db: DB, projekt: str, soll: list[SollElement], plan: Plan | None, quelle_hash: str, tops: list[str]
) -> RegisterBericht:
    bericht = RegisterBericht()
    if not soll:
        return bericht
    plan_nr = plan.plan_nr if plan else None
    index = plan.plan_index if plan else None
    vorhanden = {e["schluessel"]: e for e in db.elemente(projekt)}
    if plan_nr and index:
        neuester = max((e.get("soll_plan_index") or "" for e in vorhanden.values() if e.get("soll_plan_nr") == plan_nr), default="")
        if neuester > index:
            log.info("  Plan %s Index %s ist älter als bereits übernommener Index %s – ignoriert", plan_nr, index, neuester)
            return bericht
        schon_da = any(
            e.get("soll_plan_nr") == plan_nr and e.get("soll_plan_index") == index and e.get("quelle_hash") != quelle_hash
            for e in vorhanden.values()
        )
        if schon_da:
            log.info("  Plan %s Index %s ist bereits aus einem anderen Dokument übernommen – ignoriert", plan_nr, index)
            return bericht
    in_diesem_plan: dict[str, Zeile] = {}

    for s in soll:
        top = _top(s.top, tops)
        schluessel = element_schluessel(top, s.raum, s.bezeichnung)
        felder = {
            "top": top, "raum": s.raum, "art": s.art, "bezeichnung": s.bezeichnung, "lage": s.lage,
            "anzahl": max(1, s.anzahl), "soll_plan_nr": plan_nr, "soll_plan_index": index,
            "soll_aktiv": True, "quelle_hash": quelle_hash,
        }
        alt = vorhanden.get(schluessel)
        if alt is None:
            zeile = db.element_einfuegen({"projekt": projekt, "schluessel": schluessel, **felder})
            vorhanden[schluessel] = zeile
            bericht.neu += 1
        elif index and alt.get("soll_plan_index") and alt["soll_plan_nr"] == plan_nr and alt["soll_plan_index"] > index:
            zeile = alt  # newer index takes precedence
        else:
            db.element_aendern(alt["id"], felder)
            alt.update(felder)
            zeile = alt
            bericht.aktualisiert += 1
        in_diesem_plan[schluessel] = zeile

    # Resolve gehoert_zu: designation of the parent component in the same Top (preferably the same room)
    for s in soll:
        if not s.gehoert_zu:
            continue
        kind = in_diesem_plan[element_schluessel(_top(s.top, tops), s.raum, s.bezeichnung)]
        kandidaten = [
            z for z in in_diesem_plan.values()
            if z["top"] == kind["top"] and " ".join(z["bezeichnung"].lower().split()) == " ".join(s.gehoert_zu.lower().split())
        ]
        kandidaten.sort(key=lambda z: z["raum"] != kind["raum"])
        if kandidaten and kind.get("gehoert_zu") != kandidaten[0]["id"]:
            db.element_aendern(kind["id"], {"gehoert_zu": kandidaten[0]["id"]})
            kind["gehoert_zu"] = kandidaten[0]["id"]

    # What an older index of the same plan contained and this one no longer does: inactive
    if plan_nr and index:
        for schluessel, e in vorhanden.items():
            if (
                e.get("soll_plan_nr") == plan_nr and e.get("soll_aktiv", True)
                and (e.get("soll_plan_index") or "") < index and schluessel not in in_diesem_plan
            ):
                db.element_aendern(e["id"], {"soll_aktiv": False})
                e["soll_aktiv"] = False
                bericht.deaktiviert += 1
                log.info("  Bauteil entfällt ab Index %s: %s", index, e["bezeichnung"])
    return bericht


def soll_aenderungen_liste(aenderungen: list[Zeile]) -> str:
    """For the prompt: Soll changes that are open or not yet backed by proof."""
    relevant = [
        a for a in aenderungen
        if a["status"] == "vorgeschlagen" or (a["status"] == "freigegeben" and a.get("nachweis_status") == "fehlt")
    ]
    if not relevant:
        return "(keine)"
    return "\n".join(
        f"- {a['schluessel']} · {a['status']}"
        + (" · Nachweis fehlt" if a["status"] == "freigegeben" else "")
        + f" · {a['titel']}" + (f" · {a['top']}" if a.get("top") else "")
        for a in relevant
    )


def soll_aenderung_anwenden(db: DB, projekt: str, sa: Zeile, tops: list[str]) -> RegisterBericht:
    """Apply an approved Soll change to the component register.
    New components get soll_plan_nr = 'Änderung', dropped ones become soll_aktiv = false."""
    bericht = RegisterBericht(element_ids=[])
    vorhanden = {e["schluessel"]: e for e in db.elemente(projekt)}
    for s in sa.get("bauteile_neu") or []:
        el = SollElement.model_validate(s)
        top = _top(el.top, tops)
        schluessel = element_schluessel(top, el.raum, el.bezeichnung)
        felder = {
            "top": top, "raum": el.raum, "art": el.art, "bezeichnung": el.bezeichnung, "lage": el.lage,
            "anzahl": max(1, el.anzahl), "soll_plan_nr": "Änderung", "soll_plan_index": None, "soll_aktiv": True,
        }
        if schluessel in vorhanden:
            db.element_aendern(vorhanden[schluessel]["id"], felder)
            vorhanden[schluessel].update(felder)
            bericht.aktualisiert += 1
        else:
            vorhanden[schluessel] = db.element_einfuegen({"projekt": projekt, "schluessel": schluessel, **felder})
            bericht.neu += 1
        bericht.element_ids.append(vorhanden[schluessel]["id"])
    for schluessel in sa.get("bauteile_entfallen") or []:
        e = vorhanden.get(" ".join(schluessel.lower().split()))
        if e and e.get("soll_aktiv", True):
            db.element_aendern(e["id"], {"soll_aktiv": False})
            bericht.deaktiviert += 1
    return bericht


def bauteil_liste(elemente: list[Zeile]) -> str:
    """For the prompt: key, kind, designation, location, status in the Soll."""
    if not elemente:
        return "(noch keine Bauteile aus Plänen bekannt)"
    nach_id = {e["id"]: e for e in elemente}
    zeilen = []
    for e in sorted(elemente, key=lambda e: e["schluessel"]):
        teile = [f"- {e['schluessel']}", e["art"]]
        if e.get("lage"):
            teile.append(e["lage"])
        if e.get("gehoert_zu") in nach_id:
            teile.append(f"in {nach_id[e['gehoert_zu']]['bezeichnung']}")
        if e.get("soll_plan_index"):
            teile.append(f"Plan {e['soll_plan_nr']} {e['soll_plan_index']}")
        if not e.get("soll_aktiv", True):
            teile.append("ENTFÄLLT laut gültigem Plan")
        zeilen.append(" · ".join(teile))
    return "\n".join(zeilen)
