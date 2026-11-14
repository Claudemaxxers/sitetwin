"""Identity and duplicates (SPEC §6)."""

from __future__ import annotations

import hashlib
from datetime import timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import RawItem


def sha256_bytes(daten: bytes) -> str:
    return hashlib.sha256(daten).hexdigest()


def normalisiere_text(text: str | None) -> str:
    if not text:
        return ""
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


def _verbinde(*felder: str | None) -> str:
    roh = "|".join("" if f is None else str(f) for f in felder)
    return hashlib.sha256(roh.encode("utf-8")).hexdigest()


def content_hash(item: RawItem) -> str:
    typ = item.typ.value
    anhang_sha = item.anhang.sha256 if item.anhang else ""

    if typ == "call":
        # Identity is call_id: retries / a summary delivered later → no second row.
        return _verbinde(typ, item.projekt, item.meta.get("call_id") or item.original_ref)

    if typ == "drive":
        # Path + file content, no mtime.
        return _verbinde(typ, item.projekt, item.kanal, item.original_ref, anhang_sha)

    if typ == "whatsapp" and item.meta.get("wa_id"):
        # Live message: identity is the WhatsApp message ID.
        return _verbinde(typ, item.projekt, item.meta["wa_id"])

    zeit = item.zeitpunkt.astimezone(timezone.utc).isoformat() if item.zeitpunkt else ""
    # Derived text (transcript, PDF text) must not change the identity.
    text = "" if item.anhang else normalisiere_text(item.text)
    return _verbinde(typ, item.projekt, item.kanal, item.absender, zeit, text, anhang_sha)
