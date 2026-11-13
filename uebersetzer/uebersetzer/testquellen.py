"""Baut `quellen`-Zeilen direkt aus fake_data/ – NUR für Tests und Trockenläufe des Übersetzers,
solange Santinos Ablage noch nichts importiert hat. Ersetzt die Ablage nicht:
vereinfachtes Parsing, vereinfachter content_hash (typ|original_ref statt SPEC §6).
"""

from __future__ import annotations

import csv
import email
import email.policy
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import anhang

WIEN = ZoneInfo("Europe/Vienna")
WA_ZEILE = re.compile(r"^(\d{2}\.\d{2}\.\d{2}), (\d{2}:\d{2}) - (.*)$")
WA_ANHANG = re.compile(r"^(\S+\.\w+) \(Datei angehängt\)$")
TYP_NACH_ENDUNG = {".jpg": "image", ".jpeg": "image", ".png": "image", ".opus": "audio", ".ogg": "audio",
                   ".m4a": "audio", ".mp3": "audio", ".pdf": "pdf", ".csv": "tabelle", ".md": "text", ".txt": "text"}


def _hash(*teile: str) -> str:
    return hashlib.sha256("|".join(teile).encode()).hexdigest()


def _zeile(typ, projekt, kanal, absender, zeitpunkt, text, original_ref, pfad=None, meta=None) -> dict:
    p = Path(pfad) if pfad else None
    return {
        "typ": typ, "projekt": projekt, "kanal": kanal, "absender": absender,
        "zeitpunkt": zeitpunkt.isoformat() if zeitpunkt else None,
        "text": text or "", "anhang_pfad": str(p) if p else None,
        "anhang_typ": TYP_NACH_ENDUNG.get(p.suffix.lower(), "sonstig") if p else None,
        "anhang_name": p.name if p else None, "original_ref": original_ref,
        "content_hash": _hash(typ, original_ref), "status": "neu", "meta": meta or {},
    }


def whatsapp(ordner: Path, projekt: str) -> list[dict]:
    export = next(ordner.glob("WhatsApp Chat mit *.txt"))
    kanal = export.stem.removeprefix("WhatsApp Chat mit ")
    medien = ordner / "media"
    zeilen: list[dict] = []
    for nr, roh in enumerate(export.read_text(encoding="utf-8-sig").splitlines(), start=1):
        roh = roh.replace("‎", "").replace(" ", " ")
        m = WA_ZEILE.match(roh)
        if not m:
            if zeilen and roh.strip():
                zeilen[-1]["text"] += "\n" + roh
            continue
        datum, uhrzeit, rest = m.groups()
        if ": " not in rest:
            continue  # Systemzeile
        absender, text = rest.split(": ", 1)
        zp = datetime.strptime(f"{datum} {uhrzeit}", "%d.%m.%y %H:%M").replace(tzinfo=WIEN)
        ref = f"{export.name}#L{nr}"
        meta = {}
        a = WA_ANHANG.match(text.strip())
        if a:
            datei = medien / a.group(1)
            sidecar = datei.with_name(datei.name + ".txt")
            inhalt = sidecar.read_text(encoding="utf-8").strip() if sidecar.exists() else ""
            if inhalt:
                meta["transkript_quelle"] = "sidecar"
            zeilen.append(_zeile("whatsapp", projekt, kanal, absender, zp, inhalt, ref, datei, meta))
        else:
            if text.strip() == "Diese Nachricht wurde gelöscht.":
                meta["geloescht"] = True
            zeilen.append(_zeile("whatsapp", projekt, kanal, absender, zp, text, ref, None, meta))
    return zeilen


def emails(ordner: Path, projekt: str, anhang_ordner: Path) -> list[dict]:
    zeilen: list[dict] = []
    for datei in sorted(ordner.glob("*.eml")):
        msg = email.message_from_bytes(datei.read_bytes(), policy=email.policy.default)
        zp = email.utils.parsedate_to_datetime(msg["Date"])
        body = msg.get_body(preferencelist=("plain", "html"))
        text = f"Betreff: {msg['Subject']}\n\n{body.get_content() if body else ''}"
        mid = msg["Message-ID"] or datei.name
        mail = _zeile("email", projekt, msg["To"], msg["From"], zp, text, mid,
                      meta={"betreff": str(msg["Subject"]), "in_reply_to": msg["In-Reply-To"]})
        zeilen.append(mail)
        for teil in msg.iter_attachments():
            name = teil.get_filename()
            ziel = anhang_ordner / name
            ziel.parent.mkdir(parents=True, exist_ok=True)
            ziel.write_bytes(teil.get_content())
            pdf = anhang.pdf_text(ziel.read_bytes()) if ziel.suffix.lower() == ".pdf" else ""
            zeilen.append(_zeile("email", projekt, msg["To"], msg["From"], zp, pdf, f"{mid}#{name}", ziel,
                                 {"gehoert_zu": mail["content_hash"]}))
    return zeilen


def drive(ordner: Path, projekt: str) -> list[dict]:
    zeilen = []
    for datei in sorted(p for p in ordner.rglob("*") if p.is_file() and not p.name.startswith(".")):
        rel = str(datei.relative_to(ordner))
        if datei.suffix.lower() in {".csv", ".md", ".txt"}:
            text = datei.read_text(encoding="utf-8")
        elif datei.suffix.lower() == ".pdf":
            text = anhang.pdf_text(datei.read_bytes())
        else:
            text = ""
        zeilen.append(_zeile("drive", projekt, ordner.name, None, None, text, rel, datei))
    return zeilen


def calls(ordner: Path, projekt: str) -> list[dict]:
    zeilen = []
    for datei in sorted(ordner.glob("*.json")):
        d = json.loads(datei.read_text(encoding="utf-8"))
        name = d.get("angerufene_person") or "Person"
        text = "\n".join(f"{'Agent' if t['rolle'] == 'agent' else name}: {t['text']}" for t in d["transkript"])
        zp = datetime.fromisoformat(d["gestartet_um"].replace("Z", "+00:00"))
        zeilen.append(_zeile("call", d.get("projekt") or projekt, d.get("telefon"), name, zp, text, d["call_id"],
                             meta={"call_id": d["call_id"], "richtung": d.get("richtung")}))
    return zeilen


def stammdaten_aus_csv(drive_projekt: Path, projekt: str) -> tuple[list[dict], list[dict]]:
    def lesen(name):
        with open(drive_projekt / name, encoding="utf-8") as f:
            return [{**r, "projekt": projekt} for r in csv.DictReader(f, delimiter=";")]
    return lesen("Tops.csv"), lesen("LV_Elektro.csv")


def alle(fake_data: Path, projekt: str, tmp: Path) -> list[dict]:
    return (
        drive(fake_data / "drive", projekt)
        + whatsapp(fake_data / "whatsapp", projekt)
        + emails(fake_data / "email", projekt, tmp / "email_anhaenge")
        + calls(fake_data / "calls", projekt)
    )
