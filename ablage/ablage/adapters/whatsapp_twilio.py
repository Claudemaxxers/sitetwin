"""Twilio-WhatsApp-Webhook (SPEC §7.6). Form-Felder -> RawItem, Identität = MessageSid als wa_id."""

from __future__ import annotations

import base64
import hashlib
import hmac
import mimetypes
from collections.abc import Callable
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from ..models import Anhang, ImportKontext, QuellTyp, RawItem

# Bytes + Content-Type kommen von außen (api.py: HTTP mit Basic Auth, Tests: Fake).
Downloader = Callable[[str], bytes]

_ENDUNG = {"audio/ogg": ".ogg", "audio/opus": ".opus", "audio/mpeg": ".mp3", "image/jpeg": ".jpg"}


class TwilioNachricht(BaseModel):
    model_config = ConfigDict(extra="ignore")
    MessageSid: str = Field(min_length=1)
    From: str = Field(min_length=1)
    ProfileName: str | None = None
    Body: str = ""
    NumMedia: int = 0
    MediaUrl0: str | None = None
    MediaContentType0: str | None = None


def endung(mimetype: str | None) -> str:
    mt = (mimetype or "").split(";")[0].strip().lower()
    if not mt:
        return ".bin"
    return _ENDUNG.get(mt) or mimetypes.guess_extension(mt) or ".bin"


def nummer(von: str) -> str:
    return von.removeprefix("whatsapp:").strip()


def signatur(url: str, params: dict[str, list[str]], token: str) -> str:
    """HMAC-SHA1(token, url + Key+Value sortiert nach Key), Base64."""
    daten = url + "".join(k + v for k in sorted(params) for v in sorted(params[k]))
    mac = hmac.new(token.encode(), daten.encode(), hashlib.sha1).digest()
    return base64.b64encode(mac).decode()


def signatur_gueltig(url: str, params: dict[str, list[str]], token: str, header: str | None) -> bool:
    return hmac.compare_digest(signatur(url, params, token), header or "")


def aus_formular(
    n: TwilioNachricht,
    ctx: ImportKontext,
    jetzt: datetime,
    kanal: str | None = None,
    lade: Downloader | None = None,
) -> RawItem:
    meta: dict = {
        "wa_id": n.MessageSid,
        "quelle": "live",
        "provider": "twilio",
        "absender_nummer": nummer(n.From),
    }
    anhang: Anhang | None = None
    if n.NumMedia >= 1 and n.MediaUrl0:
        name = n.MessageSid + endung(n.MediaContentType0)
        try:
            if lade is None:
                raise RuntimeError("kein Downloader")
            anhang = Anhang.aus_bytes(name, lade(n.MediaUrl0), mimetype=n.MediaContentType0)
        except Exception as e:  # Nachricht darf nicht verloren gehen
            meta["anhang_fehler"] = f"{type(e).__name__}: {e}"
            meta["anhang_url"] = n.MediaUrl0
    return RawItem(
        typ=QuellTyp.whatsapp,
        projekt=ctx.projekt,
        kanal=kanal,
        absender=n.ProfileName or nummer(n.From),
        zeitpunkt=jetzt.astimezone(ctx.tz),
        text=n.Body.strip(),
        anhang=anhang,
        original_ref=n.MessageSid,
        meta=meta,
    )
