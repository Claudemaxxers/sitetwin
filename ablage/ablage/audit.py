"""Datenqualitäts-Audit für `quellen` + Bucket. Liest nur, schreibt nie.

`pruefe()` ist eine reine Funktion (Zeilen + Bucket-Inhalt rein, Befunde raus) und läuft damit
auch gegen den FakeBackend. `lade_supabase()` holt die echten Daten.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath

from . import hashing, store
from .models import Anhang, AnhangTyp, ImportKontext, QuellTyp, RawItem, Status

FEHLER, WARNUNG, OK = "FEHLER", "WARNUNG", "ok"
_UNSICHTBAR = re.compile("[\u200e\u200f\u202a-\u202f\ufeff\r]")
_PFAD = re.compile(r"^(?P<slug>[a-z0-9-]+)/(?P<typ>[a-z]+)/(?P<sha>[0-9a-f]{64})(?P<endung>\.[a-z0-9]+)?$")
_BELEG = re.compile(r"\b((?:IMG|PTT)-\d{8}-WA\d{4}|[\w-]+\.pdf)\b")


@dataclass(frozen=True)
class Befund:
    pruefung: str
    stufe: str
    detail: str = ""

    def __str__(self) -> str:
        return f"[{self.stufe:7}] {self.pruefung}" + (f": {self.detail}" if self.detail else "")


def _kurz(werte: list[str], n: int = 3) -> str:
    werte = sorted(werte)
    return ", ".join(w[:60] for w in werte[:n]) + (f" … (+{len(werte) - n})" if len(werte) > n else "")


def _zeit(wert: str | None) -> datetime | None:
    return datetime.fromisoformat(wert.replace("Z", "+00:00")) if wert else None


def item_aus_zeile(z: dict) -> RawItem:
    """Baut das RawItem aus den Spalten zurück – Grundlage für die Hash-Nachrechnung."""
    anhang = None
    if z.get("anhang_pfad"):
        m = _PFAD.match(z["anhang_pfad"])
        anhang = Anhang(
            dateiname=z.get("anhang_name") or "",
            typ=AnhangTyp(z.get("anhang_typ") or "sonstig"),
            sha256=m.group("sha") if m else "",
        )
    return RawItem(
        typ=QuellTyp(z["typ"]),
        projekt=z["projekt"],
        kanal=z.get("kanal"),
        absender=z.get("absender"),
        zeitpunkt=_zeit(z.get("zeitpunkt")),
        text=z.get("text") or "",
        anhang=anhang,
        original_ref=z["original_ref"],
        meta=z.get("meta") or {},
    )


def pruefe(
    zeilen: list[dict],
    dateien: dict[str, bytes],
    quelle: list[RawItem] | None = None,
    belege: list[str] | None = None,
    jetzt: datetime | None = None,
) -> list[Befund]:
    """`dateien` = Bucket-Inhalt (Pfad → Bytes). `quelle` = frisch geparste Originale zum Abgleich."""
    befunde: list[Befund] = []

    def melde(name: str, kaputt: list[str], stufe: str = FEHLER, gut: str = "") -> None:
        befunde.append(Befund(name, stufe, _kurz(kaputt)) if kaputt else Befund(name, OK, gut))

    ref = {z["content_hash"]: z.get("original_ref", "?") for z in zeilen}
    hashes = Counter(z["content_hash"] for z in zeilen)

    # 1 Eindeutigkeit
    melde("content_hash eindeutig", [h for h, n in hashes.items() if n > 1], gut=f"{len(zeilen)} Zeilen")

    # 2 Hash aus den eigenen Spalten nachrechenbar
    nicht_nachrechenbar = []
    for z in zeilen:
        try:
            if item_aus_zeile(z).content_hash() != z["content_hash"]:
                nicht_nachrechenbar.append(z["original_ref"])
        except Exception as e:
            nicht_nachrechenbar.append(f"{z.get('original_ref')}: {e}")
    melde("content_hash aus Spalten nachrechenbar", nicht_nachrechenbar)

    # 3 Wertebereiche und Pflichtfelder
    typen, status = {t.value for t in QuellTyp}, {s.value for s in Status}
    melde("typ/status im Wertebereich", [z["original_ref"] for z in zeilen if z["typ"] not in typen or z["status"] not in status])
    melde("projekt und original_ref gesetzt", [z["content_hash"][:12] for z in zeilen if not z.get("projekt") or not z.get("original_ref")])
    melde(
        "zeitpunkt fehlt nur bei drive",
        [z["original_ref"] for z in zeilen if (z.get("zeitpunkt") is None) != (z["typ"] == "drive")],
    )
    felder = ("anhang_pfad", "anhang_typ", "anhang_name")
    melde("anhang_* vollständig oder leer", [z["original_ref"] for z in zeilen if len({bool(z.get(f)) for f in felder}) > 1])

    # 4 Zeitplausibilität
    jetzt = jetzt or datetime.now(timezone.utc)
    melde(
        "zeitpunkt plausibel (2020 … morgen)",
        [
            z["original_ref"]
            for z in zeilen
            if (t := _zeit(z.get("zeitpunkt"))) is not None
            and not (datetime(2020, 1, 1, tzinfo=timezone.utc) <= t <= jetzt + timedelta(days=1))
        ],
        stufe=WARNUNG,
    )

    # 5 Text: Inhalt vorhanden, keine Steuerzeichen
    ausnahmen = ("anhang_fehlt", "medien_ausgeschlossen")
    melde(
        "Nachricht ohne Anhang hat Text",
        [z["original_ref"] for z in zeilen if not z.get("anhang_pfad") and not (z.get("text") or "").strip()
         and not any((z.get("meta") or {}).get(a) for a in ausnahmen)],
        stufe=WARNUNG,
    )
    melde(
        "keine unsichtbaren Zeichen / CR in text und absender",
        [z["original_ref"] for z in zeilen if _UNSICHTBAR.search((z.get("text") or "") + (z.get("absender") or ""))],
    )
    melde(
        "PDF-Zeilen haben Text",
        [z["original_ref"] for z in zeilen if z.get("anhang_typ") == "pdf" and not (z.get("text") or "").strip()],
        stufe=WARNUNG,
    )
    melde(
        "Sprachnachrichten haben Transkript",
        [z["original_ref"] for z in zeilen if z.get("anhang_typ") == "audio" and not (z.get("text") or "").strip()],
        stufe=WARNUNG,
    )

    # 6 Storage: Pfadformat, jede Zeile hat ihre Datei, keine Waisen, Inhalt = Hash im Pfad
    pfade = {z["anhang_pfad"]: z for z in zeilen if z.get("anhang_pfad")}
    falsch = []
    for pfad, z in pfade.items():
        m = _PFAD.match(pfad)
        if not m or m.group("slug") != store.slug(z["projekt"]) or m.group("typ") != z["typ"]:
            falsch.append(pfad)
    melde("anhang_pfad = {projekt_slug}/{typ}/{sha256}{endung}", falsch)
    melde("jede Anhang-Zeile hat ihre Datei im Bucket", [p for p in pfade if p not in dateien], gut=f"{len(pfade)} Dateien")
    melde("keine verwaisten Dateien im Bucket", [p for p in dateien if p not in pfade], stufe=WARNUNG)
    melde(
        "Dateiinhalt im Bucket = sha256 im Pfad",
        [p for p, daten in dateien.items() if (m := _PFAD.match(p)) and hashing.sha256_bytes(daten) != m.group("sha")],
    )
    melde("keine leeren Dateien", [p for p, daten in dateien.items() if not daten], stufe=WARNUNG)

    # 7 Verweise innerhalb der Tabelle
    melde(
        "meta.gehoert_zu zeigt auf vorhandene Mail",
        [z["original_ref"] for z in zeilen if (g := (z.get("meta") or {}).get("gehoert_zu")) and g not in hashes],
    )
    message_ids = {(z.get("meta") or {}).get("message_id") for z in zeilen if z["typ"] == "email"}
    melde(
        "in_reply_to zeigt auf importierte Mail",
        [z["original_ref"] for z in zeilen if (r := (z.get("meta") or {}).get("in_reply_to")) and r not in message_ids],
        stufe=WARNUNG,
    )

    # 8 Abgleich mit den Originalen: nichts verloren, nichts verfälscht
    if quelle is not None:
        soll = {i.content_hash(): i for i in quelle}
        melde("alles aus den Originalen ist in der Tabelle", [soll[h].original_ref for h in soll if h not in hashes], gut=f"{len(soll)} Items")
        melde("nichts in der Tabelle ohne Original", [ref[h] for h in hashes if h not in soll], stufe=WARNUNG)
        abweichung = []
        for z in zeilen:
            i = soll.get(z["content_hash"])
            if i is None:
                continue
            gleich = (
                (z.get("text") or "") == i.text
                and z.get("absender") == i.absender
                and z.get("kanal") == i.kanal
                and z.get("original_ref") == i.original_ref
                and _zeit(z.get("zeitpunkt")) == i.zeitpunkt
                and z.get("anhang_name") == (i.anhang.dateiname if i.anhang else None)
            )
            if not gleich:
                abweichung.append(z["original_ref"])
        melde("Felder byte-gleich zum Original (Umlaute, Emoji, Zeit)", abweichung)

    # 9 Belege aus dem Golden Set auffindbar
    if belege:
        namen = " ".join((z.get("anhang_name") or "") for z in zeilen)
        melde("Belege aus ERWARTET.md vorhanden", [b for b in belege if b not in namen], gut=f"{len(belege)} Belege")

    return befunde


def belege_aus_erwartet(pfad: Path) -> list[str]:
    return sorted(set(_BELEG.findall(pfad.read_text(encoding="utf-8")))) if pfad.exists() else []


def originale(fake_data: Path, ctx: ImportKontext) -> list[RawItem]:
    from .adapters import call, eml, ordner, whatsapp

    paare = ((whatsapp, "whatsapp"), (eml, "email"), (ordner, "drive"), (call, "calls"))
    wurzeln = [fake_data, *sorted(p for p in (fake_data / "szenarien").glob("*") if p.is_dir())]
    return [i for wurzel in wurzeln for adapter, ordnername in paare if (wurzel / ordnername).exists()
            for i in adapter.parse(wurzel / ordnername, ctx) if isinstance(i, RawItem)]


def lade_supabase(backend: store.SupabaseBackend, projekt: str) -> tuple[list[dict], dict[str, bytes]]:
    zeilen: list[dict] = []
    while True:  # paginiert, PostgREST liefert max. 1000 Zeilen
        teil = (
            backend.client.table(store.TABELLE).select("*").eq("projekt", projekt)
            .order("content_hash").range(len(zeilen), len(zeilen) + 999).execute().data
        )
        zeilen.extend(teil)
        if len(teil) < 1000:
            break
    bucket = backend.client.storage.from_(backend.bucket)
    dateien: dict[str, bytes] = {}
    praefix = store.slug(projekt)
    for typ in (t.value for t in QuellTyp):
        for obj in bucket.list(f"{praefix}/{typ}", {"limit": 1000}):
            if obj.get("id"):  # Ordner haben keine id
                pfad = str(PurePosixPath(praefix, typ, obj["name"]))
                dateien[pfad] = bucket.download(pfad)
    return zeilen, dateien


def bericht(befunde: list[Befund]) -> str:
    zaehler = Counter(b.stufe for b in befunde)
    kopf = f"{zaehler[OK]} ok, {zaehler[WARNUNG]} Warnungen, {zaehler[FEHLER]} Fehler"
    return "\n".join([*(str(b) for b in befunde), kopf])
