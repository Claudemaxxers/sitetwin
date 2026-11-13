"""Anhänge für Claude aufbereiten: Fotos als Bild, PDFs als Text (oder als Dokument), Audio nur per Transkript."""

from __future__ import annotations

import base64
import io
from pathlib import PurePosixPath
from typing import Any

BILD_TYPEN = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
MAX_PDF_TEXT = 20_000


def pdf_text(daten: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(daten))
    return "\n".join((seite.extract_text() or "") for seite in reader.pages).strip()


def endung(quelle: dict[str, Any]) -> str:
    name = quelle.get("anhang_name") or quelle.get("anhang_pfad") or ""
    return PurePosixPath(name).suffix.lower()


def inhaltsbloecke(quelle: dict[str, Any], daten: bytes | None) -> tuple[list[dict[str, Any]], str | None]:
    """Content-Blöcke für den Anhang einer Quelle und ggf. ein Hinweis für den Prompt.

    Rückgabe: (blöcke, hinweis). Blöcke stehen im User-Turn vor dem Text.
    """
    typ = quelle.get("anhang_typ")
    if not quelle.get("anhang_pfad") or daten is None:
        return [], None

    if typ == "image" or endung(quelle) in BILD_TYPEN:
        media = BILD_TYPEN.get(endung(quelle))
        if not media:
            return [], f"Foto im Format {endung(quelle)} kann nicht gelesen werden."
        return [{
            "type": "image",
            "source": {"type": "base64", "media_type": media, "data": base64.b64encode(daten).decode()},
        }], "Die Quelle ist ein Foto von der Baustelle (oben angehängt)."

    if typ == "pdf" or endung(quelle) == ".pdf":
        if (quelle.get("text") or "").strip():
            return [], None  # Ablage hat den PDF-Text schon in `text` geschrieben
        text = pdf_text(daten)
        if text:
            return [{"type": "text", "text": f"<pdf_text datei=\"{quelle.get('anhang_name')}\">\n{text[:MAX_PDF_TEXT]}\n</pdf_text>"}], None
        # Gescanntes PDF ohne Textebene: als Dokument schicken, Claude liest es visuell.
        return [{
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(daten).decode()},
        }], None

    return [], None
