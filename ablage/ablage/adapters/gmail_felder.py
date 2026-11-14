"""Gmail über n8n ohne Rohmail (SPEC §7.10).

n8n Cloud lässt die eigene Google-Anmeldung nicht in HTTP-Request-Nodes zu, die Rohmail ist dort
also nicht abrufbar. Der Gmail-Node liefert die Mail aber zerlegt (mailparser, „Simplify“ aus).
Daraus entstehen hier dieselben Zwischenobjekte wie beim `.eml`-Import (`eml.items`), damit Zeilen
und content_hash gleich sind:

- Kopfzeilen: bevorzugt die Rohzeilen aus `headers` (n8n: `{"subject": "Subject: …"}`), die laufen
  durch denselben Python-Parser wie bei `.eml`. Fehlt eine, wird sie aus den Einzelfeldern
  (`subject`, `from`, `to`, `cc`, `date`, `messageId`, `inReplyTo`) nachgebaut.
- Body: `text` (Zeilenenden auf `\\n`, außen getrimmt); reine HTML-Mail → `html` durch denselben
  HTML-zu-Text-Weg wie bei `.eml`.
- Anhänge: Name, Content-Type und Bytes aus dem Request, Reihenfolge wie geliefert.

Die genaue Form des n8n-Items ist nicht an einer echten Ausführung geprüft, deshalb tolerant.
"""

from __future__ import annotations

import email
import email.policy
import json
import re
from collections.abc import Iterable
from datetime import datetime, timezone
from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import format_datetime

from ..models import ImportKontext, RawItem
from . import eml


class FelderFehler(ValueError):
    """Die Mail ist so nicht verwertbar; der Text nennt, was fehlt (→ HTTP 422)."""


# Kopfzeilen, die eml.items liest, plus Content-Type (nur für die Wahl zwischen text und html).
# Schlüssel klein, Wert: (Name im Kopf, Feldnamen im n8n-Item ohne Rücksicht auf Groß/Klein).
_KOEPFE: dict[str, tuple[str, tuple[str, ...]]] = {
    "message-id": ("Message-ID", ("messageId", "message_id", "message-id")),
    "subject": ("Subject", ("subject",)),
    "from": ("From", ("from",)),
    "to": ("To", ("to",)),
    "cc": ("Cc", ("cc",)),
    "date": ("Date", ("date",)),
    "in-reply-to": ("In-Reply-To", ("inReplyTo", "in_reply_to", "in-reply-to")),
    "content-type": ("Content-Type", ()),
}

_UMBRUCH_OHNE_EINZUG = re.compile(r"\r?\n(?![ \t])|\r(?![\n \t])")


def _feld(mail: dict, *namen: str):
    """Erstes nicht leeres Feld unter einem der Namen, erst exakt, dann ohne Groß/Klein."""
    for n in namen:
        if mail.get(n) not in (None, ""):
            return mail[n]
    klein = {str(k).lower(): v for k, v in mail.items()}
    for n in namen:
        if klein.get(n.lower()) not in (None, ""):
            return klein[n.lower()]
    return None


def _kopfzeilen(headers) -> dict[str, str]:
    """Rohzeilen aus `headers` → {name: wert}. Erwartet n8n-Form `{"subject": "Subject: …"}`,
    nimmt auch Werte ohne Präfix und Listen `[{name, value}]` (Gmail-API) bzw. `[{key, line}]`."""
    if isinstance(headers, dict):
        paare = list(headers.items())
    elif isinstance(headers, list):
        paare = [
            (h.get("name") or h.get("key"), h.get("value", h.get("line")))
            for h in headers
            if isinstance(h, dict)
        ]
    else:
        return {}
    zeilen: dict[str, str] = {}
    for name, wert in paare:
        if not isinstance(name, str):
            continue
        name = name.strip().lower()
        if isinstance(wert, list):  # mehrfacher Kopf: wie Python msg[name] den ersten
            wert = wert[0] if wert else None
        if name not in _KOEPFE or not isinstance(wert, str):
            continue
        if wert[: len(name) + 1].lower() == name + ":":
            wert = wert[len(name) + 1 :]
        wert = _UMBRUCH_OHNE_EINZUG.sub("\n ", wert.strip("\r\n"))
        zeilen.setdefault(name, wert)
    return zeilen


def _eine_adresse(a: dict) -> str | None:
    adresse = a.get("address") if isinstance(a.get("address"), str) else ""
    name = a.get("name") if isinstance(a.get("name"), str) else ""
    if not adresse:
        return name or None
    try:
        return str(Address(display_name=name, addr_spec=adresse))
    except Exception:
        return f"{name} <{adresse}>" if name else adresse


def _adressen(wert) -> str | None:
    """mailparser-Adressobjekt `{value: [{address, name}], text}`, Liste davon oder Text."""
    if isinstance(wert, str):
        return wert
    if isinstance(wert, list):
        return ", ".join(t for t in (_adressen(w) for w in wert) if t) or None
    if not isinstance(wert, dict):
        return None
    if isinstance(wert.get("value"), list):
        teile = []
        for a in wert["value"]:
            if not isinstance(a, dict):
                continue
            if isinstance(a.get("group"), list):
                mitglieder = ", ".join(
                    t for t in (_eine_adresse(m) for m in a["group"] if isinstance(m, dict)) if t
                )
                teile.append(f"{a.get('name') or ''}: {mitglieder};")
            elif t := _eine_adresse(a):
                teile.append(t)
        if teile:
            return ", ".join(teile)
    if isinstance(wert.get("text"), str) and wert["text"].strip():
        return wert["text"]
    if "address" in wert:
        return _eine_adresse(wert)
    return None


def _datum(wert) -> str | None:
    """ISO (mailparser: `2026-11-10T08:12:00.000Z`), Epoch-ms oder schon RFC 2822 → Date-Kopf."""
    if isinstance(wert, bool) or wert is None:
        return None
    if isinstance(wert, (int, float)) or (isinstance(wert, str) and wert.strip().isdigit()):
        d = datetime.fromtimestamp(int(wert) / 1000, tz=timezone.utc)
    elif isinstance(wert, str):
        try:
            d = datetime.fromisoformat(wert.strip().replace("Z", "+00:00"))
        except ValueError:
            return wert  # vielleicht schon RFC 2822; der Kopf-Parser versucht es
    else:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return format_datetime(d)


def _aus_feld(name: str, wert) -> str | None:
    if name in ("from", "to", "cc"):
        text = _adressen(wert)
    elif name == "date":
        text = _datum(wert)
    elif isinstance(wert, str):
        text = wert.strip()
        if name == "message-id" and text and not text.startswith("<"):
            text = f"<{text}>"
    else:
        text = None
    return re.sub(r"[\r\n]+[ \t]*", " ", text) if text else None


def _kopf_nachricht(mail: dict) -> tuple[EmailMessage, dict[str, str]]:
    zeilen = _kopfzeilen(_feld(mail, "headers"))
    roh = "".join(_KOEPFE[n][0] + ": " + w.lstrip(" \t") + "\n" for n, w in zeilen.items())
    # Bytes wie beim .eml-Import (8-Bit-UTF-8 im Kopf wird dann gleich behandelt)
    msg: EmailMessage = email.message_from_bytes(  # type: ignore[assignment]
        roh.encode("utf-8", "surrogateescape") + b"\n", policy=email.policy.default
    )
    for name, (kopfname, aliase) in _KOEPFE.items():
        if name in zeilen or not aliase:
            continue
        text = _aus_feld(name, _feld(mail, *aliase, kopfname))
        if text:
            try:
                msg[kopfname] = text
            except Exception:  # unbrauchbarer Einzelwert: wie ein fehlender Kopf behandeln
                pass
    return msg, zeilen


def _body(mail: dict, msg: EmailMessage, zeilen: dict[str, str]) -> str:
    text = _feld(mail, "text")
    html = _feld(mail, "html")
    nur_html = "content-type" in zeilen and msg.get_content_type() == "text/html"
    if isinstance(html, str) and html.strip() and (nur_html or not isinstance(text, str)):
        return eml._html_zu_text(html)
    if isinstance(text, str):
        return text.replace("\r\n", "\n").replace("\r", "\n").strip()
    return ""


def _auspacken(mail) -> dict:
    if isinstance(mail, str):
        try:
            mail = json.loads(mail)
        except ValueError as e:
            raise FelderFehler(f"mail ist Text, aber kein JSON: {e}") from e
    if not isinstance(mail, dict) or not mail:
        raise FelderFehler("mail fehlt oder ist kein JSON-Objekt (erwartet: $json des Gmail-Nodes)")
    # ganzes n8n-Item statt nur $json
    if isinstance(mail.get("json"), dict) and set(mail) <= {"json", "binary", "pairedItem"}:
        mail = mail["json"]
    return mail


def aus_felder(
    mail, anhaenge: Iterable[eml.Teil], ctx: ImportKontext
) -> list[RawItem]:
    """n8n-Gmail-Item (Simplify aus) + Anhänge → dieselben RawItems wie `eml.aus_bytes`."""
    mail = _auspacken(mail)
    text, html = _feld(mail, "text"), _feld(mail, "html")
    if (
        not isinstance(text, str)
        and not isinstance(html, str)
        and _feld(mail, "headers") is None
        and _feld(mail, "snippet") is not None
    ):
        raise FelderFehler(
            "Mail kommt vereinfacht an (nur snippet, kein text/html/headers). "
            "Im Gmail Trigger „Simplify“ ausschalten."
        )

    msg, zeilen = _kopf_nachricht(mail)
    gmail_id = _feld(mail, "id")
    gmail_id = str(gmail_id).strip() if isinstance(gmail_id, (str, int)) else ""
    if msg["Message-ID"] is None and not gmail_id:
        raise FelderFehler("messageId (bzw. Kopfzeile Message-ID) und Gmail-id fehlen beide")
    if msg["From"] is None and msg["Date"] is None:
        raise FelderFehler(
            "from und date fehlen (weder in headers noch als Feld). "
            f"Gefundene Felder: {', '.join(sorted(map(str, mail))[:20]) or '-'}"
        )

    dateiname = f"gmail-{gmail_id}.eml" if gmail_id else "gmail.eml"
    items = list(eml.items(msg, _body(mail, msg, zeilen), anhaenge, dateiname, ctx))
    for item in items:
        item.meta.update({"quelle": "gmail", "gmail_weg": "felder"})
        if gmail_id:
            item.meta["gmail_id"] = gmail_id
    return items
