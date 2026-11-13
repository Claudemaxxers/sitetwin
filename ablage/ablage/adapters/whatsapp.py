"""WhatsApp-Export (SPEC §7.1). Input: Ordner, .zip oder die Exportdatei selbst."""

from __future__ import annotations

import re
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath

from ..models import AnhangTyp, Anhang, ImportKontext, ParseFehler, QuellTyp, RawItem

EXPORT_MUSTER = re.compile(r"^WhatsApp Chat mit (?P<gruppe>.+)\.txt$")
_UNSICHTBAR = re.compile("[‎‏‪- ﻿]")
_ANDROID = re.compile(
    r"^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4}), (\d{1,2}):(\d{2}) - (?P<rest>.*)$"
)
_IOS = re.compile(
    r"^\[(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4}), (\d{1,2}):(\d{2})(?::(\d{2}))?\] (?P<rest>.*)$"
)
_ANHANG = re.compile(r"^(?P<name>.+?) \(Datei angehängt\)$|^<Anhang: (?P<ios>.+?)>$")
_GELOESCHT = ("Diese Nachricht wurde gelöscht.", "Du hast diese Nachricht gelöscht.")
_OHNE_MEDIEN = ("<Medien ausgeschlossen>", "<Medien weggelassen>")


@dataclass(frozen=True)
class Systemzeile:
    ref: str
    text: str


@dataclass
class _Roh:
    zeile: int
    zeitpunkt: datetime
    absender: str
    text: str


class _Quelle:
    """Exportdatei + Mediendateien, egal ob Ordner oder Zip. Schlüssel = Dateiname."""

    def __init__(self, path: Path) -> None:
        self.dateien: dict[str, Callable[[], bytes]] = {}
        self.pfade: dict[str, str] = {}
        if path.is_dir():
            for p in sorted(path.rglob("*")):
                if p.is_file():
                    self._merke(p.name, p.read_bytes, str(p))
        elif path.suffix.lower() == ".zip":
            archiv = zipfile.ZipFile(path)
            for info in archiv.infolist():
                if not info.is_dir():
                    name = PurePosixPath(info.filename).name
                    self._merke(name, lambda i=info: archiv.read(i), f"{path}!{info.filename}")
        else:
            for p in sorted(path.parent.rglob("*")):
                if p.is_file() and (p == path or not EXPORT_MUSTER.match(p.name)):
                    self._merke(p.name, p.read_bytes, str(p))

    def _merke(self, name: str, lies: Callable[[], bytes], pfad: str) -> None:
        self.dateien.setdefault(name, lies)
        self.pfade.setdefault(name, pfad)

    def exporte(self) -> list[str]:
        return [n for n in self.dateien if EXPORT_MUSTER.match(n)]


def _zeit(m: re.Match[str], ctx: ImportKontext) -> datetime:
    tag, monat, jahr, stunde, minute = (int(x) for x in m.groups()[:5])
    sekunde = int(m.group(6)) if m.re is _IOS and m.group(6) else 0
    if jahr < 100:
        jahr += 2000
    return datetime(jahr, monat, tag, stunde, minute, sekunde, tzinfo=ctx.tz)


def _zeilen(
    text: str, exportname: str, ctx: ImportKontext
) -> Iterator[_Roh | Systemzeile | ParseFehler]:
    aktuell: _Roh | None = None
    for nr, zeile in enumerate(text.splitlines(), start=1):
        zeile = _UNSICHTBAR.sub("", zeile)
        m = _ANDROID.match(zeile) or _IOS.match(zeile)
        if not m:
            if aktuell is not None:
                aktuell.text += "\n" + zeile
            elif zeile.strip():
                yield ParseFehler(ref=f"{exportname}#L{nr}", grund="Zeile ohne Datum vor erster Nachricht")
            continue
        if aktuell is not None:
            yield aktuell
            aktuell = None
        try:
            zeitpunkt = _zeit(m, ctx)
        except ValueError as e:
            yield ParseFehler(ref=f"{exportname}#L{nr}", grund=f"Ungültiges Datum: {e}")
            continue
        absender, trenner, inhalt = m.group("rest").partition(": ")
        if not trenner:
            yield Systemzeile(ref=f"{exportname}#L{nr}", text=m.group("rest"))
            continue
        aktuell = _Roh(zeile=nr, zeitpunkt=zeitpunkt, absender=absender, text=inhalt)
    if aktuell is not None:
        yield aktuell


def _item(roh: _Roh, exportname: str, kanal: str, quelle: _Quelle, ctx: ImportKontext) -> RawItem:
    text = roh.text.strip()
    meta: dict = {}
    anhang: Anhang | None = None

    erste, _, rest = text.partition("\n")
    m = _ANHANG.match(erste.strip())
    if m:
        name = m.group("name") or m.group("ios")
        text = rest.strip()  # Bildunterschrift, sonst leer
        lies = quelle.dateien.get(name)
        if lies is None:
            meta["anhang_fehlt"] = True
            meta["anhang_name"] = name
        else:
            anhang = Anhang.aus_bytes(name, lies(), lokaler_pfad=quelle.pfade[name])
            sidecar = quelle.dateien.get(name + ".txt")
            if anhang.typ is AnhangTyp.audio and sidecar is not None:
                text = sidecar().decode("utf-8-sig").strip()
                meta["transkript_quelle"] = "sidecar"
    elif text in _OHNE_MEDIEN:
        meta["medien_ausgeschlossen"] = True
    elif text in _GELOESCHT:
        meta["geloescht"] = True

    return RawItem(
        typ=QuellTyp.whatsapp,
        projekt=ctx.projekt,
        kanal=kanal,
        absender=roh.absender,
        zeitpunkt=roh.zeitpunkt,
        text=text,
        anhang=anhang,
        original_ref=f"{exportname}#L{roh.zeile}",
        meta=meta,
    )


def ereignisse(path: Path, ctx: ImportKontext) -> Iterator[RawItem | ParseFehler | Systemzeile]:
    """Wie `parse`, liefert zusätzlich die übersprungenen Systemzeilen (für Tests/Statistik)."""
    path = Path(path)
    if not path.exists():
        yield ParseFehler(ref=str(path), grund="Pfad nicht gefunden")
        return
    quelle = _Quelle(path)
    exporte = [path.name] if path.is_file() and path.suffix.lower() == ".txt" else quelle.exporte()
    if not exporte:
        yield ParseFehler(ref=str(path), grund="Kein Export 'WhatsApp Chat mit *.txt' gefunden")
        return
    for exportname in exporte:
        m = EXPORT_MUSTER.match(exportname)
        kanal = m.group("gruppe") if m else Path(exportname).stem
        inhalt = quelle.dateien[exportname]().decode("utf-8-sig", errors="replace")
        for e in _zeilen(inhalt, exportname, ctx):
            if isinstance(e, _Roh):
                try:
                    yield _item(e, exportname, kanal, quelle, ctx)
                except Exception as fehler:  # eine kaputte Nachricht bricht den Import nicht ab
                    yield ParseFehler(ref=f"{exportname}#L{e.zeile}", grund=str(fehler))
            else:
                yield e


def parse(path: Path, ctx: ImportKontext) -> Iterator[RawItem | ParseFehler]:
    for e in ereignisse(path, ctx):
        if not isinstance(e, Systemzeile):
            yield e
