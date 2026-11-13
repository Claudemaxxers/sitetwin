"""Eine einzelne Live-WhatsApp-Nachricht als JSON (SPEC §7.5). Identität = wa_id."""

from __future__ import annotations

import base64 as b64
import binascii
from datetime import datetime
from pathlib import PurePath

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..models import Anhang, ImportKontext, QuellTyp, RawItem


class LiveAnhang(BaseModel):
    model_config = ConfigDict(extra="ignore")
    mimetype: str | None = None
    dateiname: str = Field(min_length=1)
    base64: str = Field(min_length=1)

    @field_validator("base64")
    @classmethod
    def _gueltiges_base64(cls, wert: str) -> str:
        try:
            b64.b64decode(wert, validate=True)
        except (binascii.Error, ValueError) as e:
            raise ValueError(f"kein gültiges Base64: {e}") from e
        return wert


class LiveNachricht(BaseModel):
    model_config = ConfigDict(extra="ignore")
    projekt: str | None = None  # fehlt → DEFAULT_PROJEKT
    kanal: str | None = None
    absender: str = Field(min_length=1)
    zeitpunkt: datetime  # ISO; ohne Offset = Europe/Vienna
    text: str = ""
    wa_id: str = Field(min_length=1)
    anhang: LiveAnhang | None = None


def aus_nachricht(n: LiveNachricht, ctx: ImportKontext) -> RawItem:
    zeit = n.zeitpunkt if n.zeitpunkt.tzinfo else n.zeitpunkt.replace(tzinfo=ctx.tz)
    anhang: Anhang | None = None
    if n.anhang is not None:
        name = PurePath(n.anhang.dateiname.replace("\\", "/")).name or "anhang"
        anhang = Anhang.aus_bytes(name, b64.b64decode(n.anhang.base64), mimetype=n.anhang.mimetype)
    return RawItem(
        typ=QuellTyp.whatsapp,
        projekt=n.projekt or ctx.projekt,
        kanal=n.kanal,
        absender=n.absender,
        zeitpunkt=zeit.astimezone(ctx.tz),
        text=n.text.strip(),
        anhang=anhang,
        original_ref=n.wa_id,
        meta={"wa_id": n.wa_id, "quelle": "live"},
    )
