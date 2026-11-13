"""E-Mail (.eml, SPEC §7.2). 1 RawItem pro Mail + 1 pro Anhang. Datei heißt eml.py, nicht email.py."""

from __future__ import annotations

import email
import email.policy
import re
from collections.abc import Iterator
from datetime import datetime, timezone
from email.message import EmailMessage
from html.parser import HTMLParser
from pathlib import Path, PurePath

from ..models import Anhang, AnhangTyp, ImportKontext, ParseFehler, QuellTyp, RawItem
from ..pdf import text_und_meta


class _HtmlText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.teile: list[str] = []
        self._stumm = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("script", "style"):
            self._stumm += 1
        elif tag in ("br", "p", "div", "tr", "li"):
            self.teile.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style") and self._stumm:
            self._stumm -= 1

    def handle_data(self, data: str) -> None:
        if not self._stumm:
            self.teile.append(data)


def _html_zu_text(html: str) -> str:
    p = _HtmlText()
    p.feed(html)
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", "".join(p.teile))).strip()


def _kopf(msg: EmailMessage, name: str) -> str | None:
    wert = msg[name]
    return str(wert).strip() if wert is not None else None


def _zeitpunkt(msg: EmailMessage, ctx: ImportKontext) -> datetime | None:
    try:
        d = msg["Date"].datetime
    except (AttributeError, ValueError):
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(ctx.tz)


def _kanal(msg: EmailMessage) -> str | None:
    try:
        return msg["To"].addresses[0].addr_spec
    except (AttributeError, IndexError):
        return _kopf(msg, "To")


def _body(msg: EmailMessage) -> str:
    teil = msg.get_body(preferencelist=("plain",))
    if teil is not None:
        return teil.get_content().strip()
    teil = msg.get_body(preferencelist=("html",))
    return _html_zu_text(teil.get_content()) if teil is not None else ""


def aus_bytes(daten: bytes, dateiname: str, ctx: ImportKontext) -> Iterator[RawItem]:
    msg: EmailMessage = email.message_from_bytes(daten, policy=email.policy.default)  # type: ignore[assignment]
    message_id = _kopf(msg, "Message-ID") or dateiname
    betreff = _kopf(msg, "Subject") or ""
    absender = _kopf(msg, "From")
    kanal = _kanal(msg)
    zeitpunkt = _zeitpunkt(msg, ctx)

    mail = RawItem(
        typ=QuellTyp.email,
        projekt=ctx.projekt,
        kanal=kanal,
        absender=absender,
        zeitpunkt=zeitpunkt,
        text=f"Betreff: {betreff}\n\n{_body(msg)}".strip(),
        original_ref=message_id,
        meta={
            "message_id": message_id,
            "in_reply_to": _kopf(msg, "In-Reply-To"),
            "to": _kopf(msg, "To"),
            "cc": _kopf(msg, "Cc"),
            "betreff": betreff,
            "datei": dateiname,
        },
    )
    yield mail
    mail_hash = mail.content_hash()

    for nr, teil in enumerate(msg.iter_attachments(), start=1):
        name = PurePath((teil.get_filename() or f"anhang-{nr}").replace("\\", "/")).name
        inhalt = teil.get_payload(decode=True) or b""
        anhang = Anhang.aus_bytes(name, inhalt, mimetype=teil.get_content_type())
        meta: dict = {"gehoert_zu": mail_hash, "message_id": message_id, "betreff": betreff}
        text = ""
        if anhang.typ is AnhangTyp.pdf:
            text, pdf_meta = text_und_meta(inhalt)
            meta.update(pdf_meta)
        yield RawItem(
            typ=QuellTyp.email,
            projekt=ctx.projekt,
            kanal=kanal,
            absender=absender,
            zeitpunkt=zeitpunkt,
            text=text,
            anhang=anhang,
            original_ref=f"{message_id}#{name}",
            meta=meta,
        )


def parse(path: Path, ctx: ImportKontext) -> Iterator[RawItem | ParseFehler]:
    path = Path(path)
    if not path.exists():
        yield ParseFehler(ref=str(path), grund="Pfad nicht gefunden")
        return
    dateien = sorted(path.rglob("*.eml")) if path.is_dir() else [path]
    for datei in dateien:
        try:
            yield from list(aus_bytes(datei.read_bytes(), datei.name, ctx))
        except Exception as e:  # eine kaputte Mail bricht den Import nicht ab
            yield ParseFehler(ref=datei.name, grund=str(e))
