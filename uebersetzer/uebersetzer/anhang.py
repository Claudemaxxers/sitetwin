"""Prepare attachments for Claude: photos as image, PDFs as text (or as document), audio only via transcript."""

from __future__ import annotations

import base64
import io
from pathlib import PurePosixPath
from typing import Any

BILD_TYPEN = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
HEIC_ENDUNGEN = {".heic", ".heif"}
HEIC_MARKEN = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}
MAX_KANTE = 1568  # longest image edge for Claude; larger images are downscaled there anyway
MAX_PDF_TEXT = 20_000


class BildFehler(Exception):
    pass


def ist_heic(quelle: dict[str, Any], daten: bytes) -> bool:
    """File extension or file header (ISO-BMFF: bytes 4..8 = 'ftyp', followed by the brand)."""
    if endung(quelle) in HEIC_ENDUNGEN:
        return True
    return daten[4:8] == b"ftyp" and daten[8:12] in HEIC_MARKEN


def heic_zu_jpeg(daten: bytes) -> bytes:
    """HEIC/HEIF (default for iPhone photos) → JPEG, because Claude does not accept HEIC.

    Rotates the image upright according to EXIF and downscales it to MAX_KANTE.
    """
    try:
        import pillow_heif
        from PIL import Image, ImageOps

        pillow_heif.register_heif_opener()
        with Image.open(io.BytesIO(daten)) as bild:
            bild = ImageOps.exif_transpose(bild).convert("RGB")
            bild.thumbnail((MAX_KANTE, MAX_KANTE))
            aus = io.BytesIO()
            bild.save(aus, format="JPEG", quality=85)
            return aus.getvalue()
    except Exception as e:  # broken file, unknown variant
        raise BildFehler(f"{type(e).__name__}: {e}") from e


def pdf_text(daten: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(daten))
    return "\n".join((seite.extract_text() or "") for seite in reader.pages).strip()


def endung(quelle: dict[str, Any]) -> str:
    name = quelle.get("anhang_name") or quelle.get("anhang_pfad") or ""
    return PurePosixPath(name).suffix.lower()


def inhaltsbloecke(quelle: dict[str, Any], daten: bytes | None) -> tuple[list[dict[str, Any]], str | None]:
    """Content blocks for a source's attachment and, if applicable, a note for the prompt.

    Returns: (blocks, note). Blocks come before the text in the user turn.
    """
    typ = quelle.get("anhang_typ")
    if not quelle.get("anhang_pfad") or daten is None:
        return [], None

    if (typ == "image" or endung(quelle) in HEIC_ENDUNGEN) and ist_heic(quelle, daten):
        try:
            daten = heic_zu_jpeg(daten)
        except BildFehler:
            return [], f"Foto im Format {endung(quelle) or 'HEIC'} konnte nicht gelesen werden (Datei beschädigt?)."
        return [{
            "type": "image",
            "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(daten).decode()},
        }], "Die Quelle ist ein Foto von der Baustelle (oben angehängt)."

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
            return [], None  # the Ablage has already written the PDF text to `text`
        text = pdf_text(daten)
        if text:
            return [{"type": "text", "text": f"<pdf_text datei=\"{quelle.get('anhang_name')}\">\n{text[:MAX_PDF_TEXT]}\n</pdf_text>"}], None
        # Scanned PDF without a text layer: send as document, Claude reads it visually.
        return [{
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(daten).decode()},
        }], None

    return [], None
