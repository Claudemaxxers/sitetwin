"""PDF text via pypdf – shared by email attachments (§7.2) and Drive (§7.3)."""

from __future__ import annotations

import io
import logging

logging.getLogger("pypdf").setLevel(logging.ERROR)


def pdf_text(daten: bytes) -> str:
    """Extracted text of all pages. Raises on a broken PDF (the caller isolates the error)."""
    from pypdf import PdfReader

    seiten = [(seite.extract_text() or "").strip() for seite in PdfReader(io.BytesIO(daten)).pages]
    return "\n\n".join(s for s in seiten if s)


def text_und_meta(daten: bytes) -> tuple[str, dict]:
    """Never raises: ("", {"pdf_fehler": …}) on a broken PDF, otherwise (text, {"text_quelle": "pypdf"})."""
    try:
        text = pdf_text(daten)
    except Exception as e:
        return "", {"pdf_fehler": str(e)[:200]}
    return text, {"text_quelle": "pypdf"} if text else {"pdf_ohne_text": True}
