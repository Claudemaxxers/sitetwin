"""Call-JSON, Vertrag v1 (SPEC §7.4). Identität = call_id."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..models import ImportKontext, ParseFehler, QuellTyp, RawItem


class Turn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    rolle: str
    text: str


class CallV1(BaseModel):
    model_config = ConfigDict(extra="ignore")
    call_id: str = Field(min_length=1)
    gestartet_um: datetime
    transkript: list[Turn]
    projekt: str | None = None
    angerufene_person: str | None = None
    telefon: str | None = None
    richtung: str | None = None
    beendet_um: datetime | None = None
    zusammenfassung: str | None = None


def aus_payload(payload: dict, ctx: ImportKontext) -> RawItem:
    """Wirft pydantic.ValidationError bei Verstoß gegen Vertrag v1."""
    call = CallV1.model_validate(payload)
    start = call.gestartet_um
    if start.tzinfo is None:
        start = start.replace(tzinfo=ctx.tz)
    start = start.astimezone(ctx.tz)

    dauer_s: int | None = None
    if call.beendet_um is not None:
        ende = call.beendet_um if call.beendet_um.tzinfo else call.beendet_um.replace(tzinfo=ctx.tz)
        dauer_s = int((ende - start).total_seconds())

    name = call.angerufene_person or "Person"
    zeilen = [
        f"{'Agent' if t.rolle.lower() == 'agent' else name}: {t.text.strip()}"
        for t in call.transkript
    ]
    return RawItem(
        typ=QuellTyp.call,
        projekt=call.projekt or ctx.projekt,
        kanal=call.telefon,
        absender=call.angerufene_person,
        zeitpunkt=start,
        text="\n".join(zeilen),
        original_ref=call.call_id,
        meta={
            "call_id": call.call_id,
            "richtung": call.richtung,
            "dauer_s": dauer_s,
            "zusammenfassung": call.zusammenfassung,
            "roh": payload,
        },
    )


def parse(path: Path, ctx: ImportKontext) -> Iterator[RawItem | ParseFehler]:
    path = Path(path)
    dateien = sorted(path.glob("*.json")) if path.is_dir() else [path]
    for datei in dateien:
        try:
            yield aus_payload(json.loads(datei.read_text(encoding="utf-8-sig")), ctx)
        except (OSError, json.JSONDecodeError, ValidationError) as e:
            yield ParseFehler(ref=datei.name, grund=str(e).replace("\n", " ")[:300])
