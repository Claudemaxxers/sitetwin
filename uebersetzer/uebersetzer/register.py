"""Bauteil-Register: Soll-Bauteile aus Plänen übernehmen und für die Zuordnung bereitstellen.

Regeln beim Übernehmen eines Plans (plan_nr X, Index I):
- Bauteile aus dem Plan werden angelegt oder auf Index I aktualisiert (soll_aktiv = true).
- Bauteile, die ein älterer Index von X vorsah und Index I nicht mehr enthält, werden soll_aktiv = false.
  Beispiel: Verteiler im Vorraum (Index B) → nach Index C inaktiv, Verteiler im Abstellraum neu.
- Ein älterer Index überschreibt nie Bauteile eines neueren.
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
            zeile = alt  # neuerer Index hat Vorrang
        else:
            db.element_aendern(alt["id"], felder)
            alt.update(felder)
            zeile = alt
            bericht.aktualisiert += 1
        in_diesem_plan[schluessel] = zeile

    # gehoert_zu auflösen: Bezeichnung des Eltern-Bauteils im selben Top (bevorzugt selber Raum)
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

    # Was ein älterer Index desselben Plans vorsah und dieser nicht mehr: inaktiv
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


def bauteil_liste(elemente: list[Zeile]) -> str:
    """Für den Prompt: Schlüssel, Art, Bezeichnung, Lage, Status im Soll."""
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
