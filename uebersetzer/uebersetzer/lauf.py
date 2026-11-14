"""One run: translate all sources with status='neu' and write them to eintraege/plaene."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

import anthropic

from . import anhang, prompt, register
from .db import DB, Zeile
from .extraktion import ExtraktionsFehler, baue_anfrage
from .modell import Eintrag, Ergebnis

log = logging.getLogger("uebersetzer")

STAMMDATEN_ENDUNGEN = {".csv", ".xlsx", ".md", ".txt"}

# (system, messages) -> Ergebnis. For real: Claude; in tests: a fake.
Extrahierer = Callable[[list[dict[str, Any]], list[dict[str, Any]]], Ergebnis]


@dataclass
class Bericht:
    verarbeitet: int = 0
    eintraege: int = 0
    plaene: int = 0
    uebersprungen: int = 0
    fehler: list[str] = field(default_factory=list)
    spaeter: int = 0  # transient errors (rate limit, network) – stay 'neu'
    bauteile: int = 0  # newly created Soll components


def _sortkey(q: Zeile) -> tuple:
    z = q.get("zeitpunkt")
    return (z is not None, str(z or ""), q.get("original_ref", ""))


def zeitachse_vor(quelle: Zeile, alle: list[Zeile], anzahl: int) -> list[Zeile]:
    """The last `anzahl` dated sources before this one (master data without a date excluded)."""
    eigener = _sortkey(quelle)
    frueher = [q for q in alle if q.get("zeitpunkt") and q["content_hash"] != quelle["content_hash"] and _sortkey(q) < eigener]
    return frueher[-anzahl:]


def _top_normalisieren(top: str | None, bekannte: list[str]) -> str | None:
    if not top:
        return None
    for b in bekannte:
        if b.lower().replace(" ", "") == top.lower().replace(" ", ""):
            return b
    return top


def eintrag_zeile(
    projekt: str, quelle: Zeile, nr: int, e: Eintrag, tops: list[str], bauteile: dict[str, str] | None = None
) -> Zeile:
    zeile = e.model_dump()
    bauteil = zeile.pop("bauteil", None)
    zeile["taetigkeit"] = zeile.get("taetigkeit") or None
    zeile["einheit"] = zeile.get("einheit") or None
    zeile["menge"] = zeile.get("menge") or None
    zeile.update(
        projekt=projekt,
        quelle_hash=quelle["content_hash"],
        nr=nr,
        zeitpunkt=quelle.get("zeitpunkt"),
        top=_top_normalisieren(e.top, tops),
        konfidenz=round(min(1.0, max(0.0, e.konfidenz)), 2),
        element_id=(bauteile or {}).get(" ".join((bauteil or "").lower().split())),
    )
    return zeile


def ist_plandokument(quelle: Zeile) -> bool:
    name = f"{quelle.get('anhang_name') or ''} {quelle.get('original_ref') or ''}".lower()
    return "plan_" in name or "/plaene/" in name or name.startswith("plaene/")


def _ohne_llm(quelle: Zeile) -> list[Eintrag] | None:
    """Cases that need no Claude call. None = ask Claude."""
    meta = quelle.get("meta") or {}
    text = (quelle.get("text") or "").strip()
    if meta.get("geloescht"):
        return []
    if quelle["typ"] == "drive" and anhang.endung(quelle) in STAMMDATEN_ENDUNGEN and not ist_plandokument(quelle):
        return []  # LV, Tops, project info: stored as master data in their own tables
    if quelle.get("anhang_typ") == "audio" and not text:
        return [Eintrag(
            art="sonstiges",
            zusammenfassung="Sprachnachricht ohne Transkript, Inhalt unbekannt.",
            person=quelle.get("absender"), gewerk=None, top=None, raum=None, element=None,
            taetigkeit="", menge=0, einheit="", lv_pos_nr=None, plan_nr=None, plan_index=None,
            entschieden_von=None, wartet_auf=None, zitat=None, bauteil=None, schritt=None, konfidenz=0.0, unklar=True,
            rueckfrage="Sprachnachricht konnte nicht transkribiert werden – bitte Inhalt schriftlich nachreichen.",
        )]
    if not text and not quelle.get("anhang_pfad"):
        return []
    return None


def verarbeite(db: DB, extrahierer: Extrahierer, projekt_filter: str | None, kontext_quellen: int = 40) -> Bericht:
    bericht = Bericht()
    neue = db.neue_quellen(projekt_filter)
    cache: dict[str, tuple[list[Zeile], str, list[str]]] = {}

    for quelle in neue:
        projekt = quelle["projekt"]
        if projekt not in cache:
            tops, lv = db.stammdaten(projekt)
            cache[projekt] = (db.projekt_quellen(projekt), prompt.stammdaten_block(projekt, tops, lv), [t["top"] for t in tops])
        alle, stammdaten, tops = cache[projekt]
        ref = f"{quelle['typ']} {quelle.get('original_ref')}"

        try:
            eintraege = _ohne_llm(quelle)
            plaene: list = []
            soll_details: dict[int, dict] = {}
            if eintraege is None:
                daten = db.anhang_laden(quelle["anhang_pfad"]) if quelle.get("anhang_pfad") else None
                bloecke, hinweis = anhang.inhaltsbloecke(quelle, daten)
                if ist_plandokument(quelle):
                    hinweis = ((hinweis + " ") if hinweis else "") + (
                        "Das ist ein Plandokument: Trage alle Bauteile, die der Plan vorsieht, in `elemente` ein."
                    )
                system, messages = baue_anfrage(
                    quelle, bloecke, hinweis,
                    zeitachse_vor(quelle, alle, kontext_quellen),
                    db.aktuelle_plaene(projekt),
                    stammdaten,
                    register.bauteil_liste(db.elemente(projekt)),
                    register.soll_aenderungen_liste(db.soll_aenderungen(projekt)),
                )
                ergebnis = extrahierer(system, messages)
                eintraege, plaene = ergebnis.eintraege, ergebnis.plaene
                soll_details = {d.eintrag_nr: d.als_dict() for d in ergebnis.soll}
                if ergebnis.elemente and not ist_plandokument(quelle):
                    # Components from a Soll change: into the register only after approval (soll.py), just remember them here
                    nr = next((i for i, x in enumerate(eintraege, start=1) if x.art == "soll_aenderung"), None)
                    if nr:
                        soll_details.setdefault(nr, {"bezug": None, "freigabe_ja": None, "titel": None,
                                                     "neues_soll": None, "bauteile_entfallen": []})
                        soll_details[nr]["bauteile_neu"] = [x.model_dump() for x in ergebnis.elemente]
                elif ergebnis.elemente:
                    rb = register.soll_uebernehmen(
                        db, projekt, ergebnis.elemente, plaene[0] if plaene else None, quelle["content_hash"], tops
                    )
                    bericht.bauteile += rb.neu
                    log.info("  Bauteile: %d neu, %d aktualisiert, %d entfallen", rb.neu, rb.aktualisiert, rb.deaktiviert)
                if quelle["typ"] == "drive":
                    eintraege = []  # Drive files are master data: only take over plans and components, no events
            else:
                bericht.uebersprungen += 1

            bauteile = {e["schluessel"]: e["id"] for e in db.elemente(projekt)}
            zeilen = [eintrag_zeile(projekt, quelle, i, e, tops, bauteile) for i, e in enumerate(eintraege, start=1)]
            for z in zeilen:
                z["soll"] = soll_details.get(z["nr"]) if z["art"] in ("soll_aenderung", "freigabe", "nachweis") else None
            db.eintraege_ersetzen(quelle["content_hash"], zeilen)
            for p in plaene:
                db.plan_speichern({
                    **p.model_dump(),
                    "top": _top_normalisieren(p.top, tops),
                    "projekt": projekt,
                    "gueltig_ab": quelle.get("zeitpunkt"),
                    "quelle_hash": quelle["content_hash"],
                })
            db.status_setzen(quelle, "verarbeitet")
            bericht.verarbeitet += 1
            bericht.eintraege += len(zeilen)
            bericht.plaene += len(plaene)
            log.info("✓ %s → %d Einträge, %d Pläne", ref, len(zeilen), len(plaene))

        except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.InternalServerError) as err:
            bericht.spaeter += 1
            log.warning("… %s später nochmal (%s)", ref, type(err).__name__)
        except (ExtraktionsFehler, anthropic.APIStatusError, ValueError, OSError) as err:
            meldung = f"{type(err).__name__}: {err}"
            db.status_setzen(quelle, "fehler", meldung)
            bericht.fehler.append(f"{ref}: {meldung}")
            log.error("✗ %s: %s", ref, meldung)

    return bericht
