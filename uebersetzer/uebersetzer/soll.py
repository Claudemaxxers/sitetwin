"""Soll-Änderungen während der Bauphase: wer darf das Soll ändern, und ist es schriftlich belegt?

Hintergrund (ÖNORM B 2110): Der Auftraggeber kann Leistungsänderungen anordnen, auch mündlich –
für den Beweis zählt aber die Schriftform. Deshalb:

- Nur Personen mit `personen.darf_soll_aendern` (Bauleitung des GU) ordnen an oder geben frei.
- Meldet die Bauleitung eine Änderung → sofort `freigegeben`, Register wird angepasst.
- Meldet sie jemand anderes ("das haben wir geändert") → `vorgeschlagen`. Zugehörige Signale
  bleiben offen, der Arbeiter ist erst nach der Freigabe frei.
- Freigabe/Ablehnung durch die Bauleitung → `freigegeben` bzw. `abgelehnt`.
- Schriftlicher Nachweis = Foto oder PDF eines Dokuments von der Bauleitung. Bis dahin steht
  die Änderung in der Sicht `offene_aufgaben`. Eine Sprachnachricht ist nie ein Nachweis.
"""

from __future__ import annotations

import logging
from typing import Any

from . import register
from .db import DB, Zeile

log = logging.getLogger("soll")

SOLL_ARTEN = {"soll_aenderung", "freigabe", "nachweis", "anweisung"}
DOKUMENT_ANHAENGE = {"image", "pdf"}


def _norm(s: str | None) -> str:
    return " ".join((s or "").lower().split())


def person_finden(name: str | None, personen: list[Zeile]) -> Zeile | None:
    """Ordnet einen Absender/Personennamen einer Person zu (Name, Alias, oder Name im Absender enthalten)."""
    n = _norm(name)
    if not n:
        return None
    for p in personen:
        if n == _norm(p["name"]) or n in {_norm(a) for a in p.get("aliase") or []}:
            return p
    for p in personen:
        if _norm(p["name"]) in n:
            return p
    return None


def darf_soll_aendern(name: str | None, personen: list[Zeile]) -> bool:
    p = person_finden(name, personen)
    return bool(p and p.get("darf_soll_aendern"))


def ist_dokument(quelle: Zeile | None) -> bool:
    return bool(quelle and quelle.get("anhang_pfad") and quelle.get("anhang_typ") in DOKUMENT_ANHAENGE)


class SollAblauf:
    """Verarbeitet Einträge der Arten soll_aenderung, freigabe und nachweis eines Projekts."""

    def __init__(self, db: DB, projekt: str, signale, quellen: dict[str, Zeile], tops: list[str], bericht,
                 alle_eintraege: list[Zeile] | None = None):
        self.db, self.projekt, self.signale, self.quellen, self.tops, self.bericht = db, projekt, signale, quellen, tops, bericht
        self.alle = alle_eintraege if alle_eintraege is not None else []
        self.personen = db.personen(projekt)
        self.nach_schluessel = {a["schluessel"]: a for a in db.soll_aenderungen(projekt)}

    # --- Hilfen -----------------------------------------------------------------
    def _betroffene_signale(self, sa: Zeile, e: Zeile) -> list[Zeile]:
        el_ids = set(sa.get("element_ids") or [])
        treffer = []
        for s in self.signale.offene():
            if s.get("element_id") and s["element_id"] in el_ids:
                treffer.append(s)
            elif sa.get("top") and s.get("top") == sa["top"] and (not sa.get("raum") or not s.get("raum") or _norm(s["raum"]) == _norm(sa["raum"])):
                treffer.append(s)
        return treffer

    def _freigeben(self, sa: Zeile, e: Zeile, quelle: Zeile | None) -> None:
        felder: Zeile = {
            "status": "freigegeben", "freigegeben_von": e.get("person"),
            "freigegeben_am": e.get("zeitpunkt"), "freigabe_eintrag": e["id"],
        }
        if ist_dokument(quelle):
            felder.update(nachweis_status="vorhanden", nachweis_quelle_hash=quelle["content_hash"], nachweis_am=e.get("zeitpunkt"))
        self.db.soll_aenderung_aendern(sa["id"], felder)
        sa.update(felder)
        rb = register.soll_aenderung_anwenden(self.db, self.projekt, sa, self.tops)
        self.bericht.soll.append(f"freigegeben: {sa['titel']} (Bauteile {rb.neu} neu, {rb.deaktiviert} entfallen)")
        self._ist_nachtragen(rb.element_ids or [], sa)
        log.info("✓ Soll-Änderung freigegeben: %s", sa["titel"])
        for s in self._betroffene_signale(sa, e):
            self.signale.loesen(s, e, "Soll-Änderung von der Bauleitung freigegeben")
        if sa.get("nachweis_status") != "vorhanden":
            log.info("  → offene Aufgabe: schriftlicher Nachweis fehlt")

    def _ist_nachtragen(self, element_ids: list[str], sa: Zeile) -> None:
        """Meldungen, die vor dem Anlegen des Bauteils übersetzt wurden ("3 Stk zusätzlich gesetzt"), nachträglich
        zuordnen: gleiches Top und gleicher Raum, ab der Soll-Änderung, eindeutig ein neues Bauteil dort."""
        neue = [x for x in self.db.elemente(self.projekt) if x["id"] in set(element_ids)]
        for el in neue:
            gleicher_ort = [x for x in neue if _norm(x.get("top")) == _norm(el.get("top")) and _norm(x.get("raum")) == _norm(el.get("raum"))]
            if len(gleicher_ort) != 1:
                continue
            for e in self.alle:
                passend = {"verrohrung", "leitung_eingezogen", "gesetzt", "angeschlossen", "montage", "rueckbau"}
                if (
                    not e.get("element_id") and e.get("schritt") in passend and e["art"] in ("arbeit_erledigt", "arbeit_geplant")
                    and _norm(e.get("top")) == _norm(el.get("top")) and _norm(e.get("raum")) == _norm(el.get("raum"))
                    and str(e.get("zeitpunkt") or "") >= str(sa.get("vorgeschlagen_am") or "")
                ):
                    self.db.eintrag_element_setzen(e["id"], el["id"])
                    e["element_id"] = el["id"]
                    log.info("  Meldung nachträglich zugeordnet: %s → %s", e["zusammenfassung"][:60], el["bezeichnung"])

    def _gleiche_aenderung(self, e: Zeile) -> Zeile | None:
        """Bereits erfasste Soll-Änderung am selben Ort (z. B. Anordnung GU + "ok machen wir" des Vorarbeiters)."""
        if not e.get("top"):
            return None
        for a in self.nach_schluessel.values():
            if a["status"] == "abgelehnt" or _norm(a.get("top")) != _norm(e.get("top")):
                continue
            if e.get("raum") and a.get("raum") and _norm(a["raum"]) == _norm(e["raum"]):
                return a
            if e.get("element_id") and e["element_id"] in (a.get("element_ids") or []):
                return a
        return None

    # --- Arten ------------------------------------------------------------------
    def verarbeiten(self, e: Zeile) -> None:
        if e["art"] not in SOLL_ARTEN:
            return
        details: dict[str, Any] = e.get("soll") or {}
        quelle = self.quellen.get(e["quelle_hash"])
        berechtigt = darf_soll_aendern(e.get("person"), self.personen)

        if e["art"] == "anweisung":
            # "Ja macht das bitte gleich mit" der Bauleitung zu einer vorgeschlagenen Änderung am selben Ort
            gleich = self._gleiche_aenderung(e) if berechtigt else None
            if gleich and gleich["status"] == "vorgeschlagen":
                self._freigeben(gleich, e, quelle)
            return

        if e["art"] == "soll_aenderung":
            schluessel = f"sa|{e['quelle_hash']}|{e['nr']}"
            if schluessel in self.nach_schluessel:
                return
            gleich = self._gleiche_aenderung(e)
            if gleich:
                if berechtigt and gleich["status"] == "vorgeschlagen":
                    self._freigeben(gleich, e, quelle)  # Bauleitung bestätigt eine vorgeschlagene Änderung
                else:
                    log.info("  Soll-Änderung am selben Ort schon erfasst (%s) – keine zweite", gleich["titel"])
                return
            elemente = {x["schluessel"]: x["id"] for x in self.db.elemente(self.projekt)}
            element_ids = [x for x in [e.get("element_id")] if x] + [
                elemente[_norm(k)] for k in details.get("bauteile_entfallen") or [] if _norm(k) in elemente
            ]
            sa = self.db.soll_aenderung_einfuegen({
                "projekt": self.projekt, "schluessel": schluessel,
                "titel": details.get("titel") or e["zusammenfassung"][:120],
                "neues_soll": details.get("neues_soll"), "top": e.get("top"), "raum": e.get("raum"),
                "element_ids": list(dict.fromkeys(element_ids)),
                "bauteile_neu": details.get("bauteile_neu") or [],
                "bauteile_entfallen": details.get("bauteile_entfallen") or [],
                "status": "vorgeschlagen", "vorgeschlagen_von": e.get("person"),
                "vorgeschlagen_am": e.get("zeitpunkt"), "vorschlag_eintrag": e["id"],
            })
            self.nach_schluessel[schluessel] = sa
            betroffen = self._betroffene_signale(sa, e)
            if betroffen:
                ids = [s["id"] for s in betroffen]
                self.db.soll_aenderung_aendern(sa["id"], {"signal_ids": ids})
                sa["signal_ids"] = ids
            if berechtigt:
                self._freigeben(sa, e, quelle)
            else:
                self.bericht.soll.append(f"vorgeschlagen (wartet auf Bauleitung): {sa['titel']}")
                log.info("⚑ Soll-Änderung vorgeschlagen von %s, wartet auf Freigabe: %s", e.get("person"), sa["titel"])
            return

        sa = self.nach_schluessel.get(details.get("bezug") or "")
        if not sa:
            log.info("  %s ohne erkennbaren Bezug zu einer offenen Soll-Änderung – ignoriert", e["art"])
            return
        if not berechtigt:
            log.info("  %s von %s ignoriert: nicht berechtigt, das Soll zu ändern", e["art"], e.get("person"))
            return

        if e["art"] == "freigabe" and sa["status"] == "vorgeschlagen":
            if details.get("freigabe_ja") is False:
                felder = {"status": "abgelehnt", "freigegeben_von": e.get("person"), "freigegeben_am": e.get("zeitpunkt"), "freigabe_eintrag": e["id"]}
                self.db.soll_aenderung_aendern(sa["id"], felder)
                sa.update(felder)
                self.bericht.soll.append(f"abgelehnt: {sa['titel']}")
                log.info("✗ Soll-Änderung abgelehnt: %s", sa["titel"])
            else:
                self._freigeben(sa, e, quelle)

        elif e["art"] == "nachweis" and ist_dokument(quelle):
            if sa["status"] == "vorgeschlagen":
                self._freigeben(sa, e, quelle)  # unterschriebenes Dokument der Bauleitung = Freigabe mit Nachweis
            elif sa["status"] == "freigegeben" and sa.get("nachweis_status") != "vorhanden":
                felder = {"nachweis_status": "vorhanden", "nachweis_quelle_hash": quelle["content_hash"], "nachweis_am": e.get("zeitpunkt")}
                self.db.soll_aenderung_aendern(sa["id"], felder)
                sa.update(felder)
                self.bericht.soll.append(f"Nachweis eingereicht: {sa['titel']}")
                log.info("✓ Nachweis eingereicht: %s", sa["titel"])
