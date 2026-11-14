"""Storage upload + upsert via content_hash (SPEC §5, §6). Backend via dependency injection."""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from pathlib import PurePath
from typing import Protocol

from . import transkript
from .models import Anhang, ImportErgebnis, ParseFehler, RawItem, Status

TABELLE = "quellen"
BATCH = 500  # rows per insert request
_UMLAUTE = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})


class Backend(Protocol):
    def vorhandene_hashes(self, hashes: Sequence[str]) -> set[str]: ...
    def upload(self, pfad: str, daten: bytes, mimetype: str) -> None: ...
    def einfuegen(self, zeilen: list[dict]) -> int:
        """Inserts, ignores existing content_hash. Returns the number of new rows."""
        ...


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower().translate(_UMLAUTE)).strip("-") or "projekt"


def storage_pfad(item: RawItem, anhang: Anhang) -> str:
    endung = PurePath(anhang.dateiname).suffix.lower()
    return f"{slug(item.projekt)}/{item.typ.value}/{anhang.sha256}{endung}"


def zeile(item: RawItem, content_hash: str) -> dict:
    a = item.anhang
    return {
        "typ": item.typ.value,
        "projekt": item.projekt,
        "kanal": item.kanal,
        "absender": item.absender,
        "zeitpunkt": item.zeitpunkt.isoformat() if item.zeitpunkt else None,
        "text": item.text,
        "anhang_pfad": a.storage_pfad if a else None,
        "anhang_typ": a.typ.value if a else None,
        "anhang_name": a.dateiname if a else None,
        "original_ref": item.original_ref,
        "content_hash": content_hash,
        "status": Status.neu.value,
        "meta": item.meta,
    }


def _inhalt(anhang: Anhang) -> bytes:
    return anhang.lies()


def speichern(
    eintraege: Iterable[RawItem | ParseFehler],
    backend: Backend,
    transkribierer: transkript.Transkribierer | None = None,
) -> ImportErgebnis:
    """Central point of all paths: new voice messages are transcribed before saving."""
    ergebnis = ImportErgebnis()
    kandidaten: dict[str, RawItem] = {}
    for e in eintraege:
        if isinstance(e, ParseFehler):
            ergebnis.fehler.append(str(e))
            continue
        ergebnis.gelesen += 1
        kandidaten.setdefault(e.content_hash(), e)  # duplicates within the same run count as duplicate

    if not kandidaten:
        return ergebnis

    schon_da = backend.vorhandene_hashes(list(kandidaten))
    zeilen: list[dict] = []
    fehlgeschlagen = 0
    neue = {h: i for h, i in kandidaten.items() if h not in schon_da}
    transkript.ergaenze(neue.values(), transkribierer)  # only new items; existing ones stay untouched
    for h, item in neue.items():
        try:
            if item.anhang is not None:
                item.anhang.storage_pfad = storage_pfad(item, item.anhang)
                backend.upload(
                    item.anhang.storage_pfad,
                    _inhalt(item.anhang),
                    item.anhang.mimetype or "application/octet-stream",
                )
            zeilen.append(zeile(item, h))
        except Exception as fehler:  # one broken attachment does not abort the import
            fehlgeschlagen += 1
            ergebnis.fehler.append(f"{item.original_ref}: Upload fehlgeschlagen: {fehler}")

    for start in range(0, len(zeilen), BATCH):  # do not send large exports in one request
        teil = zeilen[start : start + BATCH]
        try:
            ergebnis.neu += backend.einfuegen(teil)
        except Exception:
            for z in teil:  # isolate errors: retry one by one
                try:
                    ergebnis.neu += backend.einfuegen([z])
                except Exception as fehler:
                    fehlgeschlagen += 1
                    ergebnis.fehler.append(f"{z['original_ref']}: Insert fehlgeschlagen: {fehler}")

    ergebnis.duplikate = ergebnis.gelesen - ergebnis.neu - fehlgeschlagen
    return ergebnis


class FakeBackend:
    """In-memory replacement for Supabase (tests, --dry-run)."""

    def __init__(self) -> None:
        self.zeilen: dict[str, dict] = {}
        self.dateien: dict[str, bytes] = {}
        self.uploads = 0

    def vorhandene_hashes(self, hashes: Sequence[str]) -> set[str]:
        return {h for h in hashes if h in self.zeilen}

    def upload(self, pfad: str, daten: bytes, mimetype: str) -> None:
        self.uploads += 1
        self.dateien[pfad] = daten

    def einfuegen(self, zeilen: list[dict]) -> int:
        neu = 0
        for z in zeilen:
            if z["content_hash"] not in self.zeilen:
                self.zeilen[z["content_hash"]] = z
                neu += 1
        return neu


class SupabaseBackend:
    def __init__(self, client, bucket: str = "ablage") -> None:  # client: supabase.Client
        self.client = client
        self.bucket = bucket

    def vorhandene_hashes(self, hashes: Sequence[str]) -> set[str]:
        gefunden: set[str] = set()
        for i in range(0, len(hashes), 100):
            antwort = (
                self.client.table(TABELLE)
                .select("content_hash")
                .in_("content_hash", list(hashes[i : i + 100]))
                .execute()
            )
            gefunden.update(z["content_hash"] for z in antwort.data)
        return gefunden

    def upload(self, pfad: str, daten: bytes, mimetype: str) -> None:
        self.client.storage.from_(self.bucket).upload(
            pfad, daten, {"content-type": mimetype, "upsert": "true"}
        )

    def einfuegen(self, zeilen: list[dict]) -> int:
        antwort = (
            self.client.table(TABELLE)
            .upsert(zeilen, on_conflict="content_hash", ignore_duplicates=True)
            .execute()
        )
        return len(antwort.data or [])


def supabase_backend() -> SupabaseBackend:
    from supabase import create_client

    from . import config

    cfg = config.laden()
    if not cfg.supabase_url or not cfg.supabase_key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY fehlen in ablage/.env")
    return SupabaseBackend(create_client(cfg.supabase_url, cfg.supabase_key), cfg.bucket)
