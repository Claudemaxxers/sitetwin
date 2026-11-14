"""Prüf-Agent (Schritt 4 aus KONZEPT.md): erkennt in neuen Einträgen Abweichungen vom gültigen Plan
und legt Signale an, solange noch jemand eingreifen kann (Talona-Brief: "a change that never reached
the crew, work done out of sequence, a drawing that's out of date").

Zwei Stufen:
1. Feste Regeln – kostenlos, deterministisch, immer aktiv:
   - plan_veraltet: Arbeit nach einem Plan-Index, obwohl zu dem Zeitpunkt schon ein neuerer ausgegeben war.
   - unklar: Nachricht ließ sich nicht sicher zuordnen → Rückfrage statt Raten.
   Plus Lösung: Arbeit nach dem gültigen Index am selben Ort löst ein plan_veraltet-Signal.
2. Claude-Prüfung (optional, kostet Geld): Reihenfolge, Abweichung von Plan/LV, nicht weitergegebene
   Anweisungen – und ob ein neuer Eintrag ein offenes Signal löst.

Lebenszyklus (KONZEPT.md): offen → in_bearbeitung (setzt der Telefon-Agent nach dem Anruf) → geloest.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from itertools import groupby
from typing import Any, Callable

from . import prompt
from .db import DB, Zeile
from .modell import Pruefergebnis
from .soll import SOLL_ARTEN, SollAblauf

log = logging.getLogger("pruefer")

# Arten, bei denen sich eine Claude-Prüfung lohnt (der Rest ist Kontext).
PRUEF_ARTEN = {"arbeit_erledigt", "arbeit_geplant", "anweisung", "problem_behoben", "bestaetigung"}
KONFIDENZ_RUECKFRAGE = 0.5

# (system, messages) -> Pruefergebnis
Pruefer = Callable[[list[dict[str, Any]], list[dict[str, Any]]], Pruefergebnis]


@dataclass
class PruefBericht:
    eintraege: int = 0
    neu: list[str] = field(default_factory=list)
    ergaenzt: int = 0
    wieder_offen: int = 0
    geloest: list[str] = field(default_factory=list)
    claude_aufrufe: int = 0
    fehler: list[str] = field(default_factory=list)
    soll: list[str] = field(default_factory=list)  # Soll-Änderungen: vorgeschlagen/freigegeben/Nachweis
    abgestuft: list[str] = field(default_factory=list)  # Lernschleife: früher als Fehlalarm bewertete Lagen


def _ts(z: Any) -> datetime | None:
    if not z:
        return None
    return z if isinstance(z, datetime) else datetime.fromisoformat(str(z).replace("Z", "+00:00"))


def _vorname(person: str | None) -> str:
    if not person:
        return ""
    name = re.sub(r"\(.*?\)|<.*?>", "", person).strip()
    teile = [t for t in name.split() if not t.endswith(".")]  # "DI", "Dr." überspringen
    return teile[0] if teile else ""


def _ort(e: Zeile) -> str:
    return " / ".join(x for x in (e.get("top"), e.get("raum"), e.get("element")) if x) or "unbekannter Ort"


def _gleich(a: str | None, b: str | None) -> bool:
    return bool(a and b and a.strip().lower() == b.strip().lower())


# --- Stufe 1: feste Regeln ----------------------------------------------------

def neuester_plan(plaene: list[Zeile], plan_nr: str, bis: datetime | None) -> Zeile | None:
    """Jüngster ausgegebene Index eines Plans, der zum Zeitpunkt `bis` schon bekannt war."""
    kandidaten = [
        p for p in plaene
        if p["plan_nr"] == plan_nr and p.get("gueltig_ab") and (bis is None or _ts(p["gueltig_ab"]) <= bis)
    ]
    return max(kandidaten, key=lambda p: (str(p["gueltig_ab"]), p["plan_index"]), default=None)


def regel_plan_veraltet(e: Zeile, plaene: list[Zeile]) -> Zeile | None:
    if not (e.get("plan_nr") and e.get("plan_index")) or e["art"] in ("planaenderung", "frage"):
        return None
    neu = neuester_plan(plaene, e["plan_nr"], _ts(e.get("zeitpunkt")))
    if not neu or neu["plan_index"] <= e["plan_index"]:
        return None
    alt = e["plan_index"]
    dt = _ts(neu["gueltig_ab"]).astimezone(prompt.WIEN)
    seit = f"{dt:%d.%m.}"
    geplant = e["art"] == "arbeit_geplant"
    was = e.get("element") or "die Arbeit"
    aenderung = f". Änderung: {neu['aenderung'].rstrip('.')}" if neu.get("aenderung") else ""
    schluessel = (
        f"plan_veraltet|{e['element_id']}" if e.get("element_id")
        else f"plan_veraltet|{e.get('top') or ''}|{e['plan_nr']}|{(e.get('element') or '').lower()}"
    )
    return {
        "schluessel": schluessel,
        "element_id": e.get("element_id"),
        "art": "plan_veraltet",
        "schwere": "kritisch" if geplant else "hoch",
        "titel": f"{_ort(e)}: nach Index {alt} statt {neu['plan_index']}",
        "begruendung": (
            f"{e.get('person') or 'Jemand'} {'plant' if geplant else 'meldet'} „{was}“ nach Plan {e['plan_nr']} Index {alt}. "
            f"Gültig ist seit {seit} Index {neu['plan_index']}{aenderung}. Die Änderung hat die Ausführenden offenbar nicht erreicht."
        ),
        "anruf_text": (
            f"Servus {_vorname(e.get('person'))}, hier ist SiteTwin. Für {e.get('top') or 'diesen Bereich'} gilt seit {seit} "
            f"Plan {e['plan_nr']} Index {neu['plan_index']}{aenderung}. Laut deiner Meldung arbeitet ihr bei „{was}“ noch nach "
            f"Index {alt}. Bitte dort nicht weiterbauen, bevor ihr Index {neu['plan_index']} habt."
        ).replace("Servus ,", "Servus,"),
        "zustaendig": e.get("person"),
        "top": e.get("top"), "raum": e.get("raum"), "element": e.get("element"),
    }


# --- Regeln auf dem Bauteil-Register -------------------------------------------

ARBEIT = ("arbeit_erledigt", "arbeit_geplant")
# Was an einem Bauteil erledigt sein muss, bevor die Wand, in der es sitzt, geschlossen wird.
VOR_DEM_SCHLIESSEN = {
    "leitung": {"verrohrung", "leitung_eingezogen", "angeschlossen"},
    "dose": {"gesetzt", "angeschlossen"},
    "auslass": {"gesetzt", "angeschlossen"},
    "verteiler": {"gesetzt", "angeschlossen"},
    "schalter": {"gesetzt", "angeschlossen"},
}


def ist_stand(alle: list[Zeile], bis: Any, ausser: str | None = None) -> dict[str, set[str]]:
    """Erledigte Schritte je Bauteil bis zum Zeitpunkt `bis` (inklusive)."""
    stand: dict[str, set[str]] = {}
    grenze = str(bis or "")
    for x in alle:
        if x.get("id") == ausser or x["art"] != "arbeit_erledigt" or not x.get("element_id") or not x.get("schritt"):
            continue
        if str(x.get("zeitpunkt") or "") <= grenze:
            stand.setdefault(x["element_id"], set()).add(x["schritt"])
    return stand


def _wand_von(e: Zeile, elemente: dict[str, Zeile]) -> Zeile | None:
    el = elemente.get(e.get("element_id") or "")
    if not el:
        return None
    if el["art"] == "wand":
        return el
    return elemente.get(el.get("gehoert_zu") or "") if el.get("gehoert_zu") else None


def _n(s: str | None) -> str:
    return " ".join((s or "").lower().split())


def bauteile_im_bereich(top: str | None, raum: str | None, wand_id: str | None, elemente: dict[str, Zeile]) -> list[Zeile]:
    """Installations-Bauteile, die fertig sein müssen, bevor in diesem Bereich zugemacht wird:
    die Bauteile in der Wand (falls bekannt) und alle im selben Raum (Raum darf mehrere nennen, z. B. 'Abstellraum, Vorraum')."""
    if not top:
        return []
    treffer = []
    for k in elemente.values():
        if not k.get("soll_aktiv", True) or k["art"] not in VOR_DEM_SCHLIESSEN:
            continue
        in_wand = wand_id and k.get("gehoert_zu") == wand_id
        im_raum = _n(k.get("top")) == _n(top) and raum and k.get("raum") and _n(k["raum"]) in _n(raum)
        if in_wand or im_raum:
            treffer.append(k)
    return treffer


def offene_installation(bauteile: list[Zeile], stand: dict[str, set[str]]) -> list[Zeile]:
    return [k for k in bauteile if not (stand.get(k["id"], set()) & VOR_DEM_SCHLIESSEN[k["art"]])]


def zustaendig_fuer(fehlend: list[Zeile], personen: list[Zeile], fallback: str | None) -> str | None:
    """Wer muss handeln? Der Vorarbeiter des Gewerks, dessen Installation fehlt (alle Bauteile hier sind Elektro)."""
    if fehlend:
        for p in personen:
            if p.get("rolle") == "vorarbeiter" and "elektro" in _n(p.get("firma")):
                return p["name"]
    return fallback


def regel_wand_zu_vor_installation(
    e: Zeile, elemente: dict[str, Zeile], alle: list[Zeile], personen: list[Zeile] | None = None
) -> Zeile | None:
    """Jemand will zumachen (oder hat zugemacht), obwohl laut Plan noch Installation in Wand/Raum fehlt."""
    if e["art"] not in ARBEIT or e.get("schritt") != "beplankung":
        return None
    wand = _wand_von(e, elemente)
    top = (wand or {}).get("top") or e.get("top")
    raum = e.get("raum") or (wand or {}).get("raum")
    bereich = bauteile_im_bereich(top, raum, wand["id"] if wand else None, elemente)
    fehlt = offene_installation(bereich, ist_stand(alle, e.get("zeitpunkt"), ausser=e.get("id")))
    if not fehlt:
        return None
    geplant = e["art"] == "arbeit_geplant"
    ort = " ".join(x for x in (top, raum) if x)
    was = wand["bezeichnung"] if wand else "die Wand"
    liste = ", ".join(
        k["bezeichnung"] + (f" (Plan {k['soll_plan_nr']} {k['soll_plan_index']})" if k.get("soll_plan_index") else "") for k in fehlt
    )
    akteur = e.get("person") or "Jemand"
    zustaendig = zustaendig_fuer(fehlt, personen or [], e.get("person"))
    if zustaendig and _n(zustaendig) not in _n(akteur):
        anruf = (
            f"Servus {_vorname(zustaendig)}, hier ist SiteTwin. {akteur} {'will' if geplant else 'hat'} in {ort} {was} "
            f"{'zumachen' if geplant else 'zugemacht'}, laut Plan fehlt dort aber noch: {liste}. "
            + ("Bitte das vorher erledigen oder Bescheid geben, dass noch nicht zugemacht wird." if geplant
               else "Bitte klären, ob die Wand wieder geöffnet werden muss.")
        )
    else:
        anruf = (
            f"Servus {_vorname(akteur)}, hier ist SiteTwin. In {ort} bitte "
            f"{'noch nicht zumachen' if geplant else 'nicht weiterarbeiten'}: Laut Plan fehlt noch {liste}. "
            "Sonst muss die Wand später wieder geöffnet werden."
        )
    return {
        "schluessel": f"reihenfolge|{wand['id']}" if wand else "reihenfolge|" + ",".join(sorted(k["id"] for k in fehlt)),
        "element_id": wand["id"] if wand else (fehlt[0]["id"] if len(fehlt) == 1 else None),
        "art": "reihenfolge",
        "schwere": "kritisch" if geplant else "hoch",
        "titel": f"{ort}: {'soll zugemacht werden' if geplant else 'zugemacht'}, Installation fehlt ({liste})",
        "begruendung": (
            f"{akteur} {'will' if geplant else 'meldet'} in {ort} {was} {'schließen' if geplant else 'geschlossen'}. "
            f"Laut Plan muss vorher fertig sein: {liste}."
        ),
        "anruf_text": anruf.replace("Servus ,", "Servus,"),
        "zustaendig": zustaendig,
        "top": top, "raum": raum, "element": wand["bezeichnung"] if wand else None,
    }


def regel_bauteil_entfaellt(e: Zeile, elemente: dict[str, Zeile]) -> Zeile | None:
    """Arbeit an einem Bauteil, das der gültige Plan nicht mehr vorsieht (z. B. Verteiler im Vorraum nach Index C)."""
    el = elemente.get(e.get("element_id") or "")
    if not el or el.get("soll_aktiv", True) or e["art"] not in ARBEIT or e.get("schritt") == "rueckbau":
        return None
    geplant = e["art"] == "arbeit_geplant"
    ersatz = [
        x for x in elemente.values()
        if x.get("soll_aktiv", True) and x["art"] == el["art"] and x.get("top") == el.get("top")
        and x.get("soll_plan_nr") == el.get("soll_plan_nr")
    ]
    raeume = ", ".join(str(x.get("raum")) for x in ersatz)
    wohin = f" Laut gültigem Plan gehört das jetzt in: {raeume}." if ersatz else ""
    return {
        "schluessel": f"plan_veraltet|{el['id']}",
        "element_id": el["id"],
        "art": "plan_veraltet",
        "schwere": "kritisch" if geplant else "hoch",
        "titel": f"{el.get('top')} / {el.get('raum')} / {el['bezeichnung']}: laut gültigem Plan entfallen",
        "begruendung": (
            f"{e.get('person') or 'Jemand'} {'plant' if geplant else 'meldet'} Arbeit an {el['bezeichnung']} ({el.get('raum')}). "
            f"Plan {el.get('soll_plan_nr')} sieht das Bauteil in der gültigen Fassung nicht mehr vor.{wohin}"
        ),
        "anruf_text": (
            f"Servus {_vorname(e.get('person'))}, hier ist SiteTwin. {el['bezeichnung']} im {el.get('raum')} ist laut gültigem Plan "
            f"{el.get('soll_plan_nr')} nicht mehr vorgesehen.{wohin} Bitte dort nicht weiterbauen."
        ).replace("Servus ,", "Servus,"),
        "zustaendig": e.get("person"),
        "top": el.get("top"), "raum": el.get("raum"), "element": el["bezeichnung"],
    }


def loest_bauteil_signal(signal: Zeile, e: Zeile, elemente: dict[str, Zeile], alle: list[Zeile]) -> bool:
    """Bauteil-bezogene Signale lösen:
    - reihenfolge: alle offenen Punkte der Wand sind inzwischen erledigt.
    - plan_veraltet an einem entfallenen Bauteil: gleichartiges Bauteil am gültigen Ort ist erledigt."""
    el_id = signal.get("element_id")
    if e["art"] not in ("arbeit_erledigt", "problem_behoben"):
        return False
    if not el_id and signal["art"] != "reihenfolge":
        return False
    if signal["art"] == "reihenfolge":
        if not _n(e.get("top")) == _n(signal.get("top")) and not _wand_von(e, elemente):
            return False
        wand = elemente.get(el_id or "")
        wand_id = wand["id"] if wand and wand["art"] == "wand" else None
        bereich = bauteile_im_bereich(signal.get("top"), signal.get("raum"), wand_id, elemente)
        betrifft = e.get("element_id") in {k["id"] for k in bereich} or (wand_id and _wand_von(e, elemente) and _wand_von(e, elemente)["id"] == wand_id)
        return bool(betrifft and bereich and not offene_installation(bereich, ist_stand(alle, e.get("zeitpunkt"))))
    if signal["art"] == "plan_veraltet":
        alt, neu = elemente.get(el_id), elemente.get(e.get("element_id") or "")
        fertig = e["art"] == "arbeit_erledigt" and e.get("schritt") in VOR_DEM_SCHLIESSEN.get((neu or {}).get("art"), set())
        if alt and alt["art"] in ("verteiler", "dose", "auslass", "schalter"):
            fertig = fertig and e.get("schritt") in ("gesetzt", "angeschlossen")  # Verrohrung allein reicht nicht
        return bool(
            fertig and alt and neu and not alt.get("soll_aktiv", True) and neu.get("soll_aktiv", True)
            and neu["id"] != alt["id"] and neu["art"] == alt["art"] and neu.get("top") == alt.get("top")
        )
    return False


def regel_unklar(e: Zeile) -> Zeile | None:
    """Nur gemeldete Arbeit, bei der unklar ist, was oder wo ("bin hinten fertig mit dem zeug").
    Kurze Antworten ("ok", "kläre ich"), bei denen nur der Bezug offen ist, lösen keinen Anruf aus."""
    if e["art"] not in ("arbeit_erledigt", "arbeit_geplant") or not e.get("rueckfrage"):
        return None
    if not e.get("unklar") or float(e.get("konfidenz") or 0) >= KONFIDENZ_RUECKFRAGE:
        return None
    return {
        "schluessel": f"unklar|{e['quelle_hash']}|{e['nr']}",
        "art": "unklar",
        "schwere": "mittel",
        "titel": f"Rückfrage: {e['zusammenfassung'][:90]}",
        "begruendung": "Die Nachricht ließ sich nicht sicher zuordnen. SiteTwin fragt nach, statt zu raten.",
        "anruf_text": f"Servus {_vorname(e.get('person'))}, kurze Rückfrage von SiteTwin: {e['rueckfrage']}".replace("Servus ,", "Servus,"),
        "zustaendig": e.get("person"),
        "top": e.get("top"), "raum": e.get("raum"), "element": e.get("element"),
    }


def loest_plan_veraltet(signal: Zeile, e: Zeile, plaene: list[Zeile]) -> bool:
    """Arbeit nach dem gültigen Index am selben Ort löst ein plan_veraltet-Signal (ohne Bauteil-Bezug)."""
    if signal["art"] != "plan_veraltet" or e["art"] not in ("arbeit_erledigt", "problem_behoben"):
        return False
    teile = grundschluessel(signal["schluessel"]).split("|")
    if len(teile) != 4:
        return False  # Bauteil-Signal → loest_bauteil_signal
    _, top, plan_nr, element = teile
    if not _gleich(e.get("top"), top) or e.get("plan_nr") != plan_nr:
        return False
    if element and e.get("element") and element not in e["element"].lower() and e["element"].lower() not in element:
        return False
    aktuell = neuester_plan(plaene, plan_nr, _ts(e.get("zeitpunkt")))
    return bool(aktuell and e.get("plan_index") == aktuell["plan_index"])


# --- Lernschleife: Rückmeldungen der Baustelle ------------------------------------
# Der WhatsApp-Mitleser (ablage/whatsapp-mitleser/bewertung.js) schreibt signale.bewertung
# ('berechtigt' | 'fehlalarm') und bewertung_notiz („per WhatsApp, <Name>, <Zeit>: <Text>“).
#
# Fehlalarm: Das bewertete Signal wird weder ergänzt noch wieder geöffnet. Es bleibt mit seiner Bewertung
# stehen (Beleg, worauf sich das Urteil bezog). Taucht dieselbe Lage wieder auf, entsteht ein Folgesignal
# „<schluessel>#nach-fehlalarm-<n>“: neue Zeile, also neue Warnung im WhatsApp-Melder (der warnt je Signal-ID
# nur einmal) und neuer Anruf, aber abgestuft auf `mittel` und mit sichtbarem Hinweis. Ganz unterdrückt wird
# nichts: ein Fehlalarm-Urteil kann selbst falsch sein, und ein verpasster echter Fehler kostet Nacharbeit.
# Berechtigt: alles wie bisher; die Bewertung bleibt auch beim Wiederöffnen stehen (ein späteres Urteil
# überschreibt sie ohnehin, siehe bewertung.js).

FOLGE = "#nach-fehlalarm-"
RUECKMELDUNGEN_IM_PROMPT = 10


def grundschluessel(schluessel: str) -> str:
    return schluessel.split(FOLGE)[0]


def nach_fehlalarm(vorschlag: Zeile, fehlalarm: Zeile, schluessel: str) -> Zeile:
    """Vorschlag für eine Lage, die die Baustelle schon einmal als Fehlalarm bewertet hat: abgestuft, mit Hinweis."""
    notiz = " ".join((fehlalarm.get("bewertung_notiz") or "").split())
    vorher = vorschlag.get("schwere") or "mittel"
    begruendung = (vorschlag.get("begruendung") or "").strip()
    anruf = (vorschlag.get("anruf_text") or "").strip()
    return {
        **vorschlag,
        "schluessel": schluessel,
        "schwere": "mittel",
        "titel": f"Früher als Fehlalarm bewertet: {vorschlag['titel']}",
        "begruendung": (
            f"{begruendung} Früher als Fehlalarm bewertet ({notiz or 'ohne Notiz'}). "
            f"Deshalb abgestuft auf mittel (sonst {vorher})."
        ).strip(),
        "anruf_text": (
            f"{anruf} Zur Info: Eine gleiche Warnung wurde schon einmal als Fehlalarm zurückgemeldet. "
            "Bitte kurz sagen, ob es diesmal stimmt."
        ).strip(),
    }


def rueckmeldungen(signale: list[Zeile], n: int = RUECKMELDUNGEN_IM_PROMPT) -> list[Zeile]:
    """Die zuletzt bewerteten Signale (jüngste zuerst)."""
    bewertet = [s for s in signale if s.get("bewertung") in ("berechtigt", "fehlalarm")]
    bewertet.sort(key=lambda s: str(s.get("aktualisiert_am") or s.get("erstellt_am") or ""), reverse=True)
    return bewertet[:n]


def rueckmeldungen_block(bewertet: list[Zeile]) -> str:
    zeilen = []
    for s in bewertet:
        notiz = " ".join((s.get("bewertung_notiz") or "").split())
        zeilen.append(f"- {s['bewertung']} · {s['art']} · {s['titel']}" + (f" · {notiz}" if notiz else ""))
    return "\n".join(zeilen) or "(keine)"


# --- Stufe 2: Claude ------------------------------------------------------------

PRUEF_SYSTEM = """Du bist der Prüf-Agent von SiteTwin, einem Live-Protokoll für Baustellen. Du bekommst neue, schon strukturierte Einträge (was, wo, wer, wann, nach welchem Plan) und den bisherigen Stand der Baustelle.

Deine Aufgabe: Abweichungen erkennen, solange noch jemand eingreifen kann – bevor daraus Nacharbeit wird. Ein Signal führt zu einem Anruf beim Vorarbeiter. Fehlalarme kosten Vertrauen; melde nur, was eine Fachkraft auf der Baustelle ebenfalls melden würde. Lieber kein Signal als ein schwaches.

Signal-Arten:
- reihenfolge: Arbeit außer Reihenfolge, z. B. Wand schließen/beplanken, bevor die Installation darin fertig oder abgenommen ist; Arbeit in einem Bereich, bevor das Vorgewerk fertig ist; Montage entgegen einer Reihenfolge-Vorgabe im LV oder Protokoll.
- abweichung_plan: Gebautes oder Geplantes weicht vom gültigen Plan oder LV ab UND es gibt keine dokumentierte Anweisung dafür (z. B. Steckdose, wo laut Plan keine hingehört).
- nicht_weitergegeben: Eine Anweisung oder Entscheidung wurde getroffen, aber die ausführende Crew zeigt, dass sie sie nicht kennt.
- sonstiges: andere Abweichung mit klarer Gefahr von Nacharbeit.

Nicht melden (wird anderweitig erledigt oder ist keine Abweichung):
- Arbeit nach einem veralteten Plan-Index (eigene feste Regel).
- Unklare Nachrichten (eigene feste Regel).
- Normaler Fortschritt, Lieferungen, Wartezeiten.
- Termin- und Ablaufpläne allein ("Trockenbau ab Mittwoch", Protokoll-Termine): kein Signal, solange niemand konkret etwas baut, zumacht oder ankündigt.
- Wände oder Räume schließen/zumachen/beplanken, obwohl Installation fehlt: prüft eine feste Regel anhand der Pläne – nicht melden.
- Kosten, Aufträge, Angebote, Freigaben, Abrechnung, Regieberichte – das ist kaufmännisch, keine Abweichung auf der Baustelle.
- Zusatz- oder Mehrleistungen, die GU, Bauleitung, Planer oder Käufer (über den GU) angeordnet haben – auch wenn Auftrag oder Angebot noch fehlen.
- Dinge, die in den offenen Signalen schon gemeldet sind.
- Lagen, die die Baustelle unter <rueckmeldungen_der_baustelle> als fehlalarm bewertet hat, und ähnliche Fälle aus demselben Grund – außer ein neuer Eintrag zeigt klar etwas anderes. Als berechtigt bewertete Signale zeigen, was die Baustelle hören will.

zustaendig: die Person, die die betroffene Arbeit ausführt oder ihr Team anweist (Vorarbeiter/Obermonteur des ausführenden Gewerks) – nie der GU, der etwas angeordnet hat.

Lösungen: Wenn ein neuer Eintrag belegt, dass die Abweichung auf der Baustelle tatsächlich behoben ist (z. B. "Abnahme ok, jetzt zu", "Verteiler im Abstellraum gesetzt"), trage das Signal in `geloest` ein. Dass ein Problem erkannt, gemeldet oder geklärt wurde, ist noch keine Lösung. Nur Signale aus der Liste `loesbar` dürfen in `geloest` stehen.

anruf_text: 2–3 Sätze in Du-Form an die zuständige Person, konkret, was nicht passieren soll und warum. Kein Smalltalk."""

# Signale der festen Regeln löst nur die Regel selbst; Claude darf nur seine eigenen ("ki|…") lösen.
def _von_claude(s: Zeile) -> bool:
    return s["schluessel"].startswith("ki|")


def eintrag_kurz(e: Zeile, nr: int | None = None) -> str:
    plan = f" [nach Plan {e['plan_nr']} {e['plan_index']}]" if e.get("plan_index") else ""
    kopf = f"#{nr} " if nr is not None else ""
    wer = e.get("person") or "?"
    return f"{kopf}[{prompt.zeit(e.get('zeitpunkt'))}] {e['art']} · {wer} · {_ort(e)} · {e['zusammenfassung']}{plan}"


def baue_pruefanfrage(
    neue: list[Zeile], stand: list[Zeile], offene: list[Zeile], plaene: list[Zeile], stammdaten: str,
    bewertet: list[Zeile] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    system = [
        {"type": "text", "text": PRUEF_SYSTEM},
        {"type": "text", "text": stammdaten, "cache_control": {"type": "ephemeral"}},
    ]
    gueltig = [neuester_plan(plaene, nr, None) for nr in sorted({p["plan_nr"] for p in plaene})]
    loesbar = [s for s in offene if _von_claude(s)]
    andere = [s for s in offene if not _von_claude(s)]
    loesbar_txt = "\n".join(f"- {s['schluessel']} · {s['art']} · {s['titel']}" for s in loesbar) or "(keine)"
    andere_txt = "\n".join(f"- {s['art']} · {s['titel']}" for s in andere) or "(keine)"
    text = (
        f"<gueltige_plaene>\n{prompt.plaene_block([p for p in gueltig if p])}\n</gueltige_plaene>\n\n"
        f"<stand_der_baustelle>\n" + ("\n".join(eintrag_kurz(e) for e in stand) or "(noch nichts)") + "\n</stand_der_baustelle>\n\n"
        f"<offene_signale loesbar=\"ja\">\n{loesbar_txt}\n</offene_signale>\n\n"
        f"<offene_signale loesbar=\"nein\" hinweis=\"nur Kontext, nicht erneut melden\">\n{andere_txt}\n</offene_signale>\n\n"
        f"<rueckmeldungen_der_baustelle hinweis=\"Bewertungen früherer Warnungen, jüngste zuerst\">\n"
        f"{rueckmeldungen_block(bewertet or [])}\n</rueckmeldungen_der_baustelle>\n\n"
        "<neue_eintraege hinweis=\"nur diese prüfen\">\n"
        + "\n".join(eintrag_kurz(e, i) for i, e in enumerate(neue, start=1))
        + "\n</neue_eintraege>"
    )
    return system, [{"role": "user", "content": text}]


def pruefe_mit_claude(client, modell: str, effort: str, system, messages) -> Pruefergebnis:
    from .extraktion import ExtraktionsFehler, VERBRAUCH

    response = client.messages.parse(
        model=modell, max_tokens=16000, system=system, messages=messages,
        output_format=Pruefergebnis, output_config={"effort": effort},
    )
    u = response.usage
    VERBRAUCH["aufrufe"] += 1
    VERBRAUCH["input"] += u.input_tokens or 0
    VERBRAUCH["cache_write"] += u.cache_creation_input_tokens or 0
    VERBRAUCH["cache_read"] += u.cache_read_input_tokens or 0
    VERBRAUCH["output"] += u.output_tokens or 0
    if response.stop_reason in ("refusal", "max_tokens") or response.parsed_output is None:
        raise ExtraktionsFehler(f"Prüfung ohne gültige Ausgabe (stop_reason={response.stop_reason})")
    return response.parsed_output


# --- Ablauf ---------------------------------------------------------------------

class _Signale:
    """Signale eines Projekts im Speicher halten und Änderungen in die DB schreiben."""

    def __init__(self, db: DB, projekt: str, bericht: PruefBericht):
        self.db, self.projekt, self.bericht = db, projekt, bericht
        self.nach_schluessel = {s["schluessel"]: s for s in db.signale(projekt)}

    def offene(self) -> list[Zeile]:
        return [s for s in self.nach_schluessel.values() if s["status"] != "geloest"]

    def melden(self, vorschlag: Zeile, eintraege: list[Zeile]) -> None:
        ids = [e["id"] for e in eintraege]
        hashes = sorted({e["quelle_hash"] for e in eintraege})
        alt = self.nach_schluessel.get(vorschlag["schluessel"])
        # Lernschleife: eine als Fehlalarm bewertete Lage nie stumm übernehmen (siehe nach_fehlalarm)
        fehlalarm, n, schluessel = None, 0, vorschlag["schluessel"]
        while alt is not None and alt.get("bewertung") == "fehlalarm":
            if set(ids) <= set(alt.get("eintrag_ids") or []):
                return  # Beleg gehört schon zum bewerteten Signal (erneute Prüfung)
            fehlalarm, n = alt, n + 1
            schluessel = f"{grundschluessel(vorschlag['schluessel'])}{FOLGE}{n}"
            alt = self.nach_schluessel.get(schluessel)
        if fehlalarm is not None:
            vorschlag = nach_fehlalarm(vorschlag, fehlalarm, schluessel)
            log.info("↓ abgestuft (früher Fehlalarm): %s", vorschlag["titel"])
            self.bericht.abgestuft.append(vorschlag["titel"])
        if alt is None:
            zeile = {**vorschlag, "projekt": self.projekt, "eintrag_ids": ids, "quelle_hashes": hashes}
            self.nach_schluessel[vorschlag["schluessel"]] = self.db.signal_einfuegen(zeile)
            self.bericht.neu.append(f"{vorschlag['schwere']:8} {vorschlag['titel']}")
            log.info("⚑ neues Signal (%s): %s", vorschlag["schwere"], vorschlag["titel"])
            return
        felder: Zeile = {
            "eintrag_ids": list(dict.fromkeys([*(alt.get("eintrag_ids") or []), *ids])),
            "quelle_hashes": sorted({*(alt.get("quelle_hashes") or []), *hashes}),
        }
        rang = {"mittel": 0, "hoch": 1, "kritisch": 2}
        if rang.get(vorschlag.get("schwere"), 0) > rang.get(alt.get("schwere"), 0):
            # Die schwerere Meldung beschreibt die Lage besser (z. B. "will Samstag zumachen" → noch Zeit zu handeln)
            felder.update({k: vorschlag[k] for k in ("schwere", "titel", "begruendung", "anruf_text", "zustaendig") if vorschlag.get(k)})
        if felder["eintrag_ids"] == list(alt.get("eintrag_ids") or []) and alt["status"] != "geloest" and "schwere" not in felder:
            return  # nichts Neues (z. B. erneute Prüfung)
        if alt["status"] == "geloest":
            # Anruf-Felder leeren: der Telefon-Agent ruft nur bei status='offen' und angerufen_am null an
            felder.update(status="offen", geloest_am=None, geloest_durch=None, angerufen_am=None, anruf_id=None)
            self.bericht.wieder_offen += 1
            log.info("⚑ wieder offen: %s", alt["titel"])
        else:
            self.bericht.ergaenzt += 1
        self.db.signal_aendern(alt["id"], felder)
        alt.update(felder)

    def loesen(self, signal: Zeile, e: Zeile, grund: str) -> None:
        if signal["status"] == "geloest":
            return
        felder = {"status": "geloest", "geloest_durch": e["id"], "geloest_am": e.get("zeitpunkt")}
        self.db.signal_aendern(signal["id"], felder)
        signal.update(felder)
        self.bericht.geloest.append(signal["titel"])
        log.info("✓ gelöst: %s (%s)", signal["titel"], grund)


def pruefe(db: DB, projekt_filter: str | None, pruefer: Pruefer | None, stand_eintraege: int = 80) -> PruefBericht:
    """Alle ungeprüften Einträge prüfen, gruppiert nach Quelle, in zeitlicher Reihenfolge."""
    bericht = PruefBericht()
    ungeprueft = db.ungepruefte_eintraege(projekt_filter)
    bericht.eintraege = len(ungeprueft)

    for projekt in sorted({e["projekt"] for e in ungeprueft}):
        plaene = db.alle_plaene(projekt)
        alle = db.projekt_eintraege(projekt)
        signale = _Signale(db, projekt, bericht)
        stammdaten = prompt.stammdaten_block(projekt, *db.stammdaten(projekt)) if pruefer else ""
        elemente = {x["id"]: x for x in db.elemente(projekt)}
        eigene = [e for e in ungeprueft if e["projekt"] == projekt]
        tops = [t["top"] for t in db.stammdaten(projekt)[0]]
        quellen = {q["content_hash"]: q for q in db.projekt_quellen(projekt)}
        soll_ablauf = SollAblauf(db, projekt, signale, quellen, tops, bericht, alle)
        personen = soll_ablauf.personen

        for quelle_hash, gruppe_iter in groupby(eigene, key=lambda e: e["quelle_hash"]):
            gruppe = list(gruppe_iter)
            raeume = list(dict.fromkeys(x["raum"] for x in gruppe if x.get("raum")))
            for x in gruppe:  # z. B. Sprachnachricht: "Ständerwerk im Abstellraum und Vorraum … Samstag machen wir zu"
                if not x.get("raum") and x.get("schritt") == "beplankung" and raeume:
                    x["raum"] = ", ".join(raeume)
            try:
                for e in gruppe:
                    if e["art"] in SOLL_ARTEN:
                        soll_ablauf.verarbeiten(e)
                        elemente = {x["id"]: x for x in db.elemente(projekt)}  # Register kann sich geändert haben
                    for vorschlag in (
                        regel_bauteil_entfaellt(e, elemente),
                        regel_plan_veraltet(e, plaene),
                        regel_wand_zu_vor_installation(e, elemente, alle, personen),
                        regel_unklar(e),
                    ):
                        if vorschlag:
                            signale.melden(vorschlag, [e])
                    for s in signale.offene():
                        if loest_plan_veraltet(s, e, plaene) or loest_bauteil_signal(s, e, elemente, alle):
                            signale.loesen(s, e, "feste Regel: Abweichung behoben")

                if pruefer and any(e["art"] in PRUEF_ARTEN for e in gruppe):
                    zeit_gruppe = str(gruppe[0].get("zeitpunkt") or "")
                    stand = [x for x in alle if x["quelle_hash"] != quelle_hash and str(x.get("zeitpunkt") or "") <= zeit_gruppe]
                    offene = signale.offene()
                    bewertet = rueckmeldungen(list(signale.nach_schluessel.values()))
                    system, messages = baue_pruefanfrage(gruppe, stand[-stand_eintraege:], offene, plaene, stammdaten, bewertet)
                    ergebnis = pruefer(system, messages)
                    bericht.claude_aufrufe += 1
                    for v in ergebnis.signale:
                        if v.art == "reihenfolge":
                            log.info("  Claude-Vorschlag verworfen (Reihenfolge prüfen die festen Regeln): %s", v.titel)
                            continue
                        ausloeser = [gruppe[i - 1] for i in v.eintrag_nrs if 1 <= i <= len(gruppe)] or gruppe
                        zeile = v.model_dump(exclude={"kurzschluessel", "eintrag_nrs"})
                        zeile["schluessel"] = f"ki|{v.top or ''}|{v.kurzschluessel.strip().lower()}"
                        signale.melden(zeile, ausloeser)
                    nach_schluessel = {s["schluessel"]: s for s in offene if _von_claude(s)}
                    for g in ergebnis.geloest:
                        if g.schluessel in nach_schluessel and 1 <= g.eintrag_nr <= len(gruppe):
                            signale.loesen(nach_schluessel[g.schluessel], gruppe[g.eintrag_nr - 1], g.begruendung)

                db.als_geprueft([e["id"] for e in gruppe])
            except Exception as err:  # Gruppe bleibt ungeprüft und wird beim nächsten Lauf wiederholt
                import anthropic

                bericht.fehler.append(f"{quelle_hash[:12]}: {type(err).__name__}: {err}")
                log.error("✗ Prüfung %s: %s", quelle_hash[:12], err)
                if isinstance(err, (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.AuthenticationError)):
                    return bericht

    return bericht
