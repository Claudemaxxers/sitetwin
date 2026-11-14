"""Data model (SPEC §4)."""

from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path, PurePath
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

from . import hashing


class QuellTyp(str, Enum):
    whatsapp = "whatsapp"
    email = "email"
    drive = "drive"
    call = "call"


class AnhangTyp(str, Enum):
    image = "image"
    audio = "audio"
    pdf = "pdf"
    tabelle = "tabelle"
    text = "text"
    sonstig = "sonstig"


class Status(str, Enum):
    neu = "neu"
    verarbeitet = "verarbeitet"
    fehler = "fehler"


_ENDUNGEN: dict[str, AnhangTyp] = {
    **dict.fromkeys((".jpg", ".jpeg", ".png", ".heic", ".webp"), AnhangTyp.image),
    **dict.fromkeys((".opus", ".ogg", ".m4a", ".mp3", ".wav"), AnhangTyp.audio),
    ".pdf": AnhangTyp.pdf,
    **dict.fromkeys((".csv", ".xlsx"), AnhangTyp.tabelle),
    **dict.fromkeys((".txt", ".md"), AnhangTyp.text),
}

_MIME_EXTRA = {
    ".opus": "audio/ogg",
    ".heic": "image/heic",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".m4a": "audio/mp4",
}


def anhang_typ(dateiname: str) -> AnhangTyp:
    return _ENDUNGEN.get(PurePath(dateiname).suffix.lower(), AnhangTyp.sonstig)


def mime_typ(dateiname: str) -> str:
    endung = PurePath(dateiname).suffix.lower()
    return (
        _MIME_EXTRA.get(endung)
        or mimetypes.guess_type(dateiname)[0]
        or "application/octet-stream"
    )


class Anhang(BaseModel):
    lokaler_pfad: str | None = None  # only during the import
    storage_pfad: str | None = None  # set by store.py
    dateiname: str
    typ: AnhangTyp
    sha256: str
    mimetype: str | None = None
    # File content, only during the import; never serialized.
    inhalt: bytes | None = Field(default=None, exclude=True, repr=False)

    def lies(self) -> bytes:
        """File content: in memory or from disk (CLI import)."""
        if self.inhalt is not None:
            return self.inhalt
        if self.lokaler_pfad:
            return Path(self.lokaler_pfad).read_bytes()
        raise ValueError(f"Anhang {self.dateiname}: kein Inhalt")

    @classmethod
    def aus_bytes(
        cls,
        dateiname: str,
        daten: bytes,
        lokaler_pfad: str | None = None,
        mimetype: str | None = None,
    ) -> Anhang:
        return cls(
            lokaler_pfad=lokaler_pfad,
            dateiname=dateiname,
            typ=anhang_typ(dateiname),
            sha256=hashing.sha256_bytes(daten),
            mimetype=mimetype or mime_typ(dateiname),
            inhalt=daten,
        )


class RawItem(BaseModel):
    typ: QuellTyp
    projekt: str
    kanal: str | None = None
    absender: str | None = None
    zeitpunkt: datetime | None  # timezone-aware, Europe/Vienna; None for Drive
    text: str = ""
    anhang: Anhang | None = None
    original_ref: str
    meta: dict = Field(default_factory=dict)

    def content_hash(self) -> str:
        return hashing.content_hash(self)


class ParseFehler(BaseModel):
    ref: str  # "file#L12"
    grund: str

    def __str__(self) -> str:
        return f"{self.ref}: {self.grund}"


class ImportErgebnis(BaseModel):
    gelesen: int = 0
    neu: int = 0
    duplikate: int = 0
    fehler: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class ImportKontext:
    projekt: str
    tz: ZoneInfo = ZoneInfo("Europe/Vienna")
