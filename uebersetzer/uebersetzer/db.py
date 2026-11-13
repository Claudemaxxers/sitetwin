"""Datenbankzugriff. Zwei Implementierungen mit derselben Schnittstelle:

- SupabaseDB: das echte Projekt (Service-Key aus .env)
- SpeicherDB: alles im Speicher, für Tests und Trockenläufe mit fake_data

Vertrag mit der Ablage (ablage/SPEC.md §5): In `quellen` schreiben wir nur `status`
und `meta.fehler`. Belege referenzieren wir über `content_hash`, nie über `id`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

Zeile = dict[str, Any]


def _eintrag_sort(e: Zeile) -> tuple:
    return (str(e.get("zeitpunkt") or ""), e.get("quelle_hash", ""), e.get("nr", 0))


class DB(Protocol):
    # Prüf-Agent
    def ungepruefte_eintraege(self, projekt: str | None) -> list[Zeile]: ...
    def projekt_eintraege(self, projekt: str) -> list[Zeile]: ...
    def alle_plaene(self, projekt: str) -> list[Zeile]: ...
    def signale(self, projekt: str) -> list[Zeile]: ...
    def signal_einfuegen(self, zeile: Zeile) -> Zeile: ...
    def signal_aendern(self, signal_id: str, felder: Zeile) -> None: ...
    def als_geprueft(self, eintrag_ids: list[str]) -> None: ...
    # Übersetzer
    def neue_quellen(self, projekt: str | None) -> list[Zeile]: ...
    def projekt_quellen(self, projekt: str) -> list[Zeile]: ...
    def anhang_laden(self, pfad: str) -> bytes: ...
    def stammdaten(self, projekt: str) -> tuple[list[Zeile], list[Zeile]]: ...
    def aktuelle_plaene(self, projekt: str) -> list[Zeile]: ...
    def eintraege_ersetzen(self, quelle_hash: str, zeilen: list[Zeile]) -> None: ...
    def plan_speichern(self, zeile: Zeile) -> None: ...
    def status_setzen(self, quelle: Zeile, status: str, fehler: str | None = None) -> None: ...
    # Bauteil-Register
    def elemente(self, projekt: str) -> list[Zeile]: ...
    def element_einfuegen(self, zeile: Zeile) -> Zeile: ...
    def element_aendern(self, element_id: str, felder: Zeile) -> None: ...


def element_schluessel(top: str | None, raum: str | None, bezeichnung: str) -> str:
    return "|".join(" ".join((x or "").lower().split()) for x in (top, raum, bezeichnung))


def _sortierschluessel(q: Zeile) -> tuple:
    # Stammdaten (zeitpunkt = null) zuerst, dann chronologisch.
    z = q.get("zeitpunkt")
    return (z is not None, str(z or ""), q.get("original_ref", ""))


def _plan_mergen(alt: Zeile | None, neu: Zeile) -> Zeile:
    """Leere Felder eines bestehenden Plans auffüllen, gesetzte nicht überschreiben –
    außer gueltig_ab: das früheste bekannte Ausgabedatum gewinnt."""
    if not alt:
        return neu
    zeile = dict(alt)
    for k, v in neu.items():
        if v is not None and zeile.get(k) in (None, ""):
            zeile[k] = v
    if neu.get("gueltig_ab") and alt.get("gueltig_ab"):
        zeile["gueltig_ab"] = min(str(neu["gueltig_ab"]), str(alt["gueltig_ab"]))
    return zeile


class SupabaseDB:
    def __init__(self, url: str, key: str, bucket: str):
        from supabase import create_client

        self.client = create_client(url, key)
        self.bucket = bucket

    def neue_quellen(self, projekt: str | None) -> list[Zeile]:
        q = self.client.table("quellen").select("*").eq("status", "neu")
        if projekt:
            q = q.eq("projekt", projekt)
        return sorted(q.execute().data, key=_sortierschluessel)

    def projekt_quellen(self, projekt: str) -> list[Zeile]:
        zeilen: list[Zeile] = []
        start = 0
        while True:
            seite = (
                self.client.table("quellen").select("*").eq("projekt", projekt)
                .order("importiert_am").range(start, start + 999).execute().data
            )
            zeilen += seite
            if len(seite) < 1000:
                return sorted(zeilen, key=_sortierschluessel)
            start += 1000

    def anhang_laden(self, pfad: str) -> bytes:
        return self.client.storage.from_(self.bucket).download(pfad)

    def stammdaten(self, projekt: str) -> tuple[list[Zeile], list[Zeile]]:
        tops = self.client.table("tops").select("*").eq("projekt", projekt).order("top").execute().data
        lv = self.client.table("lv_positionen").select("*").eq("projekt", projekt).order("pos_nr").execute().data
        return tops, lv

    def aktuelle_plaene(self, projekt: str) -> list[Zeile]:
        return self.client.table("plaene_aktuell").select("*").eq("projekt", projekt).execute().data

    def eintraege_ersetzen(self, quelle_hash: str, zeilen: list[Zeile]) -> None:
        self.client.table("eintraege").delete().eq("quelle_hash", quelle_hash).execute()
        if zeilen:
            self.client.table("eintraege").insert(zeilen).execute()

    def plan_speichern(self, zeile: Zeile) -> None:
        alt = (
            self.client.table("plaene").select("*")
            .eq("projekt", zeile["projekt"]).eq("plan_nr", zeile["plan_nr"]).eq("plan_index", zeile["plan_index"])
            .execute().data
        )
        neu = _plan_mergen(alt[0] if alt else None, zeile)
        neu = {k: v for k, v in neu.items() if k not in ("id", "erstellt_am")}
        self.client.table("plaene").upsert(neu, on_conflict="projekt,plan_nr,plan_index").execute()

    def status_setzen(self, quelle: Zeile, status: str, fehler: str | None = None) -> None:
        update: Zeile = {"status": status}
        if fehler is not None:
            update["meta"] = {**(quelle.get("meta") or {}), "fehler": fehler[:2000]}
        self.client.table("quellen").update(update).eq("content_hash", quelle["content_hash"]).execute()

    # --- Prüf-Agent ---
    def _alle(self, tabelle: str, projekt: str | None, **filter_) -> list[Zeile]:
        zeilen: list[Zeile] = []
        start = 0
        while True:
            q = self.client.table(tabelle).select("*")
            if projekt:
                q = q.eq("projekt", projekt)
            for k, v in filter_.items():
                q = q.is_(k, "null") if v is None else q.eq(k, v)
            seite = q.range(start, start + 999).execute().data
            zeilen += seite
            if len(seite) < 1000:
                return zeilen
            start += 1000

    def ungepruefte_eintraege(self, projekt: str | None) -> list[Zeile]:
        return sorted(self._alle("eintraege", projekt, geprueft_am=None), key=_eintrag_sort)

    def projekt_eintraege(self, projekt: str) -> list[Zeile]:
        return sorted(self._alle("eintraege", projekt), key=_eintrag_sort)

    def alle_plaene(self, projekt: str) -> list[Zeile]:
        return self._alle("plaene", projekt)

    def signale(self, projekt: str) -> list[Zeile]:
        return self._alle("signale", projekt)

    def signal_einfuegen(self, zeile: Zeile) -> Zeile:
        return self.client.table("signale").insert(zeile).execute().data[0]

    def signal_aendern(self, signal_id: str, felder: Zeile) -> None:
        self.client.table("signale").update(felder).eq("id", signal_id).execute()

    def elemente(self, projekt: str) -> list[Zeile]:
        return self._alle("elemente", projekt)

    def element_einfuegen(self, zeile: Zeile) -> Zeile:
        return self.client.table("elemente").insert(zeile).execute().data[0]

    def element_aendern(self, element_id: str, felder: Zeile) -> None:
        from datetime import datetime, timezone

        felder = {**felder, "aktualisiert_am": datetime.now(timezone.utc).isoformat()}
        self.client.table("elemente").update(felder).eq("id", element_id).execute()

    def als_geprueft(self, eintrag_ids: list[str]) -> None:
        from datetime import datetime, timezone

        jetzt = datetime.now(timezone.utc).isoformat()
        for i in range(0, len(eintrag_ids), 200):
            self.client.table("eintraege").update({"geprueft_am": jetzt}).in_("id", eintrag_ids[i : i + 200]).execute()


class SpeicherDB:
    """In-Memory-Ersatz. Anhänge liegen als lokale Dateipfade in `anhang_pfad`."""

    def __init__(self, quellen: list[Zeile], tops: list[Zeile], lv: list[Zeile]):
        self.quellen = quellen
        self.tops = tops
        self.lv = lv
        self.eintraege: list[Zeile] = []
        self.plaene: list[Zeile] = []
        self.signale_liste: list[Zeile] = []
        self.elemente_liste: list[Zeile] = []

    def neue_quellen(self, projekt: str | None) -> list[Zeile]:
        return sorted(
            (q for q in self.quellen if q["status"] == "neu" and (not projekt or q["projekt"] == projekt)),
            key=_sortierschluessel,
        )

    def projekt_quellen(self, projekt: str) -> list[Zeile]:
        return sorted((q for q in self.quellen if q["projekt"] == projekt), key=_sortierschluessel)

    def anhang_laden(self, pfad: str) -> bytes:
        return Path(pfad).read_bytes()

    def stammdaten(self, projekt: str) -> tuple[list[Zeile], list[Zeile]]:
        return self.tops, self.lv

    def aktuelle_plaene(self, projekt: str) -> list[Zeile]:
        aktuell: dict[str, Zeile] = {}
        for p in self.plaene:
            if p["projekt"] != projekt:
                continue
            bisher = aktuell.get(p["plan_nr"])
            if bisher is None or _plan_neuer(p, bisher):
                aktuell[p["plan_nr"]] = p
        return list(aktuell.values())

    def plan_speichern(self, zeile: Zeile) -> None:
        schluessel = (zeile["projekt"], zeile["plan_nr"], zeile["plan_index"])
        for i, p in enumerate(self.plaene):
            if (p["projekt"], p["plan_nr"], p["plan_index"]) == schluessel:
                self.plaene[i] = _plan_mergen(p, zeile)
                return
        self.plaene.append(zeile)

    def status_setzen(self, quelle: Zeile, status: str, fehler: str | None = None) -> None:
        quelle["status"] = status
        if fehler is not None:
            quelle["meta"] = {**(quelle.get("meta") or {}), "fehler": fehler}

    # --- Prüf-Agent ---
    def ungepruefte_eintraege(self, projekt: str | None) -> list[Zeile]:
        return sorted((e for e in self.eintraege if not e.get("geprueft_am") and (not projekt or e["projekt"] == projekt)), key=_eintrag_sort)

    def projekt_eintraege(self, projekt: str) -> list[Zeile]:
        return sorted((e for e in self.eintraege if e["projekt"] == projekt), key=_eintrag_sort)

    def alle_plaene(self, projekt: str) -> list[Zeile]:
        return [p for p in self.plaene if p["projekt"] == projekt]

    def signale(self, projekt: str) -> list[Zeile]:
        return [s for s in self.signale_liste if s["projekt"] == projekt]

    def signal_einfuegen(self, zeile: Zeile) -> Zeile:
        import uuid

        if any(s["projekt"] == zeile["projekt"] and s["schluessel"] == zeile["schluessel"] for s in self.signale_liste):
            raise ValueError("unique (projekt, schluessel) verletzt")
        neu = {"status": "offen", **zeile, "id": str(uuid.uuid4())}
        self.signale_liste.append(neu)
        return neu

    def signal_aendern(self, signal_id: str, felder: Zeile) -> None:
        for s in self.signale_liste:
            if s["id"] == signal_id:
                s.update(felder)

    def elemente(self, projekt: str) -> list[Zeile]:
        return [e for e in self.elemente_liste if e["projekt"] == projekt]

    def element_einfuegen(self, zeile: Zeile) -> Zeile:
        import uuid

        if any(e["projekt"] == zeile["projekt"] and e["schluessel"] == zeile["schluessel"] for e in self.elemente_liste):
            raise ValueError("unique (projekt, schluessel) verletzt")
        neu = {"soll_aktiv": True, "gehoert_zu": None, **zeile, "id": str(uuid.uuid4())}
        self.elemente_liste.append(neu)
        return neu

    def element_aendern(self, element_id: str, felder: Zeile) -> None:
        for e in self.elemente_liste:
            if e["id"] == element_id:
                e.update(felder)

    def als_geprueft(self, eintrag_ids: list[str]) -> None:
        ids = set(eintrag_ids)
        for e in self.eintraege:
            if e.get("id") in ids:
                e["geprueft_am"] = "jetzt"

    def eintraege_ersetzen(self, quelle_hash: str, zeilen: list[Zeile]) -> None:
        import uuid  # IDs wie in Postgres, damit der Prüf-Agent darauf verweisen kann

        for z in zeilen:
            z.setdefault("id", str(uuid.uuid4()))
        self.eintraege = [e for e in self.eintraege if e["quelle_hash"] != quelle_hash] + zeilen


def _plan_neuer(a: Zeile, b: Zeile) -> bool:
    """Gleiche Logik wie die Sicht plaene_aktuell: jüngstes gueltig_ab, sonst höherer Index."""
    ga, gb = a.get("gueltig_ab"), b.get("gueltig_ab")
    if ga and gb and ga != gb:
        return str(ga) > str(gb)
    if ga and not gb:
        return True
    if gb and not ga:
        return False
    return a["plan_index"] > b["plan_index"]
