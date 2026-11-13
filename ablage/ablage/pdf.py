"""PDF-Text via pypdf – gemeinsam für E-Mail-Anhänge (§7.2) und Drive (§7.3)."""

from __future__ import annotations

import io
import logging

logging.getLogger("pypdf").setLevel(logging.ERROR)


def pdf_text(daten: bytes) -> str:
    """Extrahierter Text aller Seiten. Wirft bei kaputtem PDF (Aufrufer isoliert den Fehler)."""
    from pypdf import PdfReader

    seiten = [(seite.extract_text() or "").strip() for seite in PdfReader(io.BytesIO(daten)).pages]
    return "\n\n".join(s for s in seiten if s)


def text_und_meta(daten: bytes) -> tuple[str, dict]:
    """Nie werfend: ("", {"pdf_fehler": …}) bei kaputtem PDF, sonst (text, {"text_quelle": "pypdf"})."""
    try:
        text = pdf_text(daten)
    except Exception as e:
        return "", {"pdf_fehler": str(e)[:200]}
    return text, {"text_quelle": "pypdf"} if text else {"pdf_ohne_text": True}
