"""Drive-Ordner (SPEC §7.3). 1 RawItem pro Datei, zeitpunkt = None, Identität = Pfad + Inhalt."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from pathlib import Path

from ..models import Anhang, AnhangTyp, ImportKontext, ParseFehler, QuellTyp, RawItem
from ..pdf import text_und_meta

_STEUERDATEIEN = {"desktop.ini", "thumbs.db"}
_TEXT_ENDUNGEN = {".csv", ".md", ".txt"}


def _ignorieren(relativ: Path) -> bool:
    return any(
        teil.startswith((".", "~$")) or teil.lower() in _STEUERDATEIEN for teil in relativ.parts
    )


def dekodiere(daten: bytes) -> str:
    try:
        return daten.decode("utf-8-sig")
    except UnicodeDecodeError:
        return daten.decode("cp1252", errors="replace")


def parse(path: Path, ctx: ImportKontext) -> Iterator[RawItem | ParseFehler]:
    wurzel = Path(path)
    if not wurzel.is_dir():
        yield ParseFehler(ref=str(path), grund="Ordner nicht gefunden")
        return
    for datei in sorted(p for p in wurzel.rglob("*") if p.is_file()):
        relativ = datei.relative_to(wurzel)
        if _ignorieren(relativ):
            continue
        ref = relativ.as_posix()
        try:
            daten = datei.read_bytes()
            anhang = Anhang.aus_bytes(datei.name, daten, lokaler_pfad=str(datei))
            meta: dict = {
                "mtime": datetime.fromtimestamp(datei.stat().st_mtime, tz=ctx.tz).isoformat(),
                "groesse": len(daten),
            }
            text = ""
            if datei.suffix.lower() in _TEXT_ENDUNGEN:
                text = dekodiere(daten).strip()
            elif anhang.typ is AnhangTyp.pdf:
                text, pdf_meta = text_und_meta(daten)
                meta.update(pdf_meta)
            yield RawItem(
                typ=QuellTyp.drive,
                projekt=ctx.projekt,
                kanal=wurzel.resolve().name,
                absender=None,
                zeitpunkt=None,
                text=text,
                anhang=anhang,
                original_ref=ref,
                meta=meta,
            )
        except Exception as e:  # eine kaputte Datei bricht den Import nicht ab
            yield ParseFehler(ref=ref, grund=str(e))
