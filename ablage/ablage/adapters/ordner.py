"""Drive-Ordner (SPEC §7.3). 1 RawItem pro Datei, zeitpunkt = None, Identität = Pfad + Inhalt."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from pathlib import Path, PurePosixPath

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


def ignoriert(relativ: Path | str) -> bool:
    return _ignorieren(Path(relativ))


def item_aus_bytes(
    daten: bytes,
    ref: str,
    projekt: str,
    kanal: str,
    mtime: str | None = None,
    lokaler_pfad: str | None = None,
) -> RawItem:
    """Ein Drive-Item aus Dateibytes. `ref` = relativer Pfad inkl. Dateiname (original_ref)."""
    name = PurePosixPath(ref).name
    anhang = Anhang.aus_bytes(name, daten, lokaler_pfad=lokaler_pfad)
    meta: dict = {"groesse": len(daten)}
    if mtime:
        meta["mtime"] = mtime
    text = ""
    if PurePosixPath(name).suffix.lower() in _TEXT_ENDUNGEN:
        text = dekodiere(daten).strip()
    elif anhang.typ is AnhangTyp.pdf:
        text, pdf_meta = text_und_meta(daten)
        meta.update(pdf_meta)
    return RawItem(
        typ=QuellTyp.drive,
        projekt=projekt,
        kanal=kanal,
        absender=None,
        zeitpunkt=None,
        text=text,
        anhang=anhang,
        original_ref=ref,
        meta=meta,
    )


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
            mtime = datetime.fromtimestamp(datei.stat().st_mtime, tz=ctx.tz).isoformat()
            yield item_aus_bytes(
                daten, ref, ctx.projekt, wurzel.resolve().name, mtime, lokaler_pfad=str(datei)
            )
        except Exception as e:  # eine kaputte Datei bricht den Import nicht ab
            yield ParseFehler(ref=ref, grund=str(e))
