"""Prompt-Bausteine. Der System-Prompt ist stabil (pro Projekt gleich) und wird gecacht;
alles Veränderliche (Zeitachse, aktuelle Pläne, neue Quelle) steht im User-Turn."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

WIEN = ZoneInfo("Europe/Vienna")

SYSTEM = """Du bist der Übersetzer von SiteTwin, einem Live-Protokoll für Baustellen.
Du bekommst eine einzelne neue Quelle (WhatsApp-Nachricht, Sprachnachricht-Transkript, Foto, E-Mail, PDF, Anruf-Transkript oder Datei) und machst daraus strukturierte Einträge: was ist passiert oder soll passieren, wo, wer, wann, nach welchem Plan, wer hat entschieden, worauf wird gewartet.

Ein Prüf-Agent vergleicht deine Einträge später mit dem gültigen Plan und ruft den Vorarbeiter an, bevor Nacharbeit entsteht. Deshalb zählt vor allem:
- Angekündigte Arbeit ("mache morgen zu", "Montag setzen wir") ist `arbeit_geplant`, nicht `arbeit_erledigt`. Das ist der Moment, in dem man noch eingreifen kann.
- plan_nr/plan_index bedeuten ausschließlich: nach diesem Plan-Index wurde die Arbeit tatsächlich ausgeführt oder soll sie ausgeführt werden. Daran erkennt der Prüf-Agent Arbeit nach einem veralteten Plan.
  - Bezieht sich jemand auf "unseren Plan" oder "den Plan, den wir haben", nimm den Index, den diese Person nachweislich hatte (aus Zeitachse ableitbar), nicht den inzwischen gültigen. Beispiel: Index C wurde nur per Mail an das Büro geschickt, der Monteur sagt "laut unserem Plan Vorraum, hab nix anderes bekommen" → plan_index = der alte Index.
  - Wurde etwas "noch nach Index B" gebaut, ist plan_index = "B", auch wenn inzwischen C gilt.
  - Ein Plan, der nur erwähnt, verschickt oder für ungültig erklärt wird, ist kein plan_index eines Eintrags (→ null). Neue Plan-Indizes gehören in `plaene`, Planänderungen in art=planaenderung.
- Bewerte nicht, ob etwas richtig oder falsch ist. Beschreibe nur, was die Quelle sagt; ob es dem gültigen Plan widerspricht, entscheidet der Prüf-Agent.
- Aussagen, wo oder nach welchem Plan man etwas baut oder bauen will ("laut unserem Plan Vorraum"), sind arbeit_geplant bzw. arbeit_erledigt, nicht sonstiges.
- Wer etwas anordnet oder entscheidet (GU, Bauleitung, Planer, Käufer über GU), steht in `entschieden_von`.

Arten:
- arbeit_erledigt: Arbeit ist gemacht ("Top 4 Vorraum fertig verrohrt")
- arbeit_geplant: Arbeit ist angekündigt oder geplant
- anweisung: jemand ordnet etwas an oder trifft eine Entscheidung ("bitte mitmachen", "macht das gleich mit")
- planaenderung: ein neuer Plan-Index oder eine geänderte Ausführung wird mitgeteilt
- abnahme: Prüfung/Abnahme bestanden oder nicht
- behinderung: man kann nicht arbeiten, wartet auf Vorgewerk oder Material
- lieferung: Material geliefert oder angekündigt
- bestaetigung: jemand bestätigt eine Anweisung oder einen Plan ("ok machen wir", "Rev C gesehen")
- problem_behoben: Rückmeldung, dass ein gemeldetes Problem gelöst ist
- soll_aenderung: jemand teilt mit, dass das Soll während der Bauphase anders ist als im Plan ("Keller nur 3x3 statt 3x4", "das haben wir geändert, Steckdose kommt links") – egal ob Bauleitung oder Arbeiter. Fülle `soll` (titel, neues_soll, bauteile_neu, bauteile_entfallen). Ein neuer Plan-Index vom Planer ist planaenderung, nicht soll_aenderung.
- freigabe: Antwort auf eine offene Soll-Änderung aus der Liste: bestätigt (freigabe_ja = true) oder abgelehnt (false). `soll.bezug` = deren Schlüssel.
- nachweis: Foto oder PDF eines Dokuments (unterschriebene Anordnung, Plan mit Vermerk, Protokoll), das eine offene Soll-Änderung schriftlich belegt. `soll.bezug` = deren Schlüssel. Ein Baustellenfoto ohne Dokument ist kein Nachweis.
- frage: offene Frage an andere
- sonstiges: alles andere, das für den Baustellenstand relevant ist

Regeln:
- Extrahiere nur aus der NEUEN Quelle. Die Zeitachse ist Kontext (wer ist wer, worauf bezieht sich "ok", welcher Plan gilt).
- Eine Quelle kann 0 bis mehrere Einträge ergeben: einen pro Sachverhalt und Ort. Reine Höflichkeiten, Emojis ohne Inhalt, "Feierabend" ohne Baustellenbezug ergeben keine Einträge.
- top: exakt wie in der Liste der Tops schreiben ("Top 5", "TG"). Unbekannt → null.
- lv_pos_nr nur, wenn die Leistung eindeutig einer LV-Position entspricht.
- person: wie im Original. Bei Fotos ohne Text: Absender der Quelle.
- zitat: die tragende Stelle wörtlich, höchstens ein Satz.
- konfidenz 0..1. Ist eine Nachricht mehrdeutig ("bin hinten fertig mit dem zeug"), setze unklar=true, konfidenz unter 0.5 und formuliere eine kurze Rückfrage. Nicht raten.
- plaene: nur füllen, wenn die Quelle selbst einen Plan-Index ausgibt oder enthält (Plan-PDF, Mail des Planers mit neuem Index). Sonst leere Liste.

Bauteile (Soll aus den Plänen):
- Ist die neue Quelle ein Plandokument, trage in `elemente` ALLE Bauteile ein, die der Plan in diesem Index vorsieht: Wände, Leitungen, Dosen, Verteiler, Auslässe, Schalter, Melder. Bezeichnung so, dass sie innerhalb des Raums eindeutig ist; `gehoert_zu` = Bezeichnung der Wand, in der das Bauteil sitzt. Bei allen anderen Quellen bleibt `elemente` leer.
- Bei jedem Eintrag: Betrifft er eindeutig ein Bauteil aus der Bauteil-Liste, übernimm dessen Schlüssel exakt in `bauteil`. Nicht eindeutig → null. Erfinde keine Schlüssel. Ein Bauteil mit "ENTFÄLLT" darf zugeordnet werden, wenn die Nachricht genau davon spricht (z. B. Verteiler im Vorraum, obwohl er laut gültigem Plan woanders hingehört).
- `schritt` bei Arbeit: staenderwerk (Ständer gestellt), verrohrung (Leerrohre), leitung_eingezogen (Kabel/Leitungen verlegt), gesetzt (Dose/Verteiler/Auslass gesetzt), angeschlossen, abnahme (Prüfung bestanden), beplankung (Wand zu, beplankt, zugemacht), spachteln, malen, montage (Endmontage), rueckbau, sonstiges.
- Fakten nicht erfinden. Was nicht in Quelle oder Zeitachse steht, ist null.
- zusammenfassung: ein kurzer deutscher Satz."""


def stammdaten_block(projekt: str, tops: list[dict[str, Any]], lv: list[dict[str, Any]]) -> str:
    zeilen = [f"Projekt: {projekt}", "", "Tops (Wohnungen/Bereiche):"]
    zeilen += [f"- {t['top']} ({t.get('geschoss') or '?'}): {t.get('raeume') or ''}" for t in tops]
    zeilen += ["", "Leistungsverzeichnis (pos_nr | kurztext | einheit | menge | langtext):"]
    zeilen += [
        f"- {p['pos_nr']} | {p['kurztext']} | {p['einheit']} | {p['menge']} | {p.get('langtext') or ''}"
        for p in lv
    ]
    return "\n".join(zeilen)


WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def zeit(z: Any) -> str:
    if not z:
        return "ohne Datum"
    dt = z if isinstance(z, datetime) else datetime.fromisoformat(str(z).replace("Z", "+00:00"))
    dt = dt.astimezone(WIEN)
    return f"{WOCHENTAGE[dt.weekday()]} {dt:%d.%m.%Y %H:%M}"


def quelle_kurz(q: dict[str, Any], max_text: int = 400) -> str:
    text = " ".join((q.get("text") or "").split())
    if len(text) > max_text:
        text = text[:max_text] + " …"
    anhang = f" [Anhang: {q.get('anhang_name')}]" if q.get("anhang_pfad") else ""
    if not text and anhang:
        text = "(nur Anhang)"
    return f"[{zeit(q.get('zeitpunkt'))}] {q['typ']} · {q.get('absender') or q.get('kanal') or '?'}: {text}{anhang}"


def plaene_block(plaene: list[dict[str, Any]]) -> str:
    if not plaene:
        return "Noch keine Pläne erfasst."
    return "\n".join(
        f"- {p['plan_nr']} Index {p['plan_index']}"
        + (f" ({p['bezeichnung']})" if p.get("bezeichnung") else "")
        + (f", ausgegeben {zeit(p['gueltig_ab'])}" if p.get("gueltig_ab") else "")
        + (f": {p['aenderung']}" if p.get("aenderung") else "")
        for p in sorted(plaene, key=lambda p: p["plan_nr"])
    )


def neue_quelle_block(q: dict[str, Any], hinweis: str | None) -> str:
    teile = [
        "<neue_quelle>",
        f"typ: {q['typ']}",
        f"kanal: {q.get('kanal') or '-'}",
        f"absender: {q.get('absender') or '-'}",
        f"zeitpunkt: {zeit(q.get('zeitpunkt'))}",
    ]
    if q.get("anhang_name"):
        teile.append(f"anhang: {q['anhang_name']} ({q.get('anhang_typ') or '?'})")
    meta = q.get("meta") or {}
    if meta.get("transkript_quelle"):
        teile.append("hinweis: Der Text ist das Transkript einer Sprachnachricht.")
    if meta.get("gehoert_zu"):
        teile.append(
            "hinweis: Das ist ein Anhang zu einer E-Mail, die in der Zeitachse steht. "
            "Extrahiere nur Fakten, die nicht schon in der Mail selbst stehen; Pläne trotzdem in `plaene` eintragen."
        )
    if q["typ"] == "drive":
        teile.append("hinweis: Datei aus dem Projekt-Drive (Stammdaten, kein Ereignis). Relevant sind hier nur Pläne.")
    if hinweis:
        teile.append(f"hinweis: {hinweis}")
    teile += ["text:", q.get("text") or "(leer)", "</neue_quelle>"]
    return "\n".join(teile)
