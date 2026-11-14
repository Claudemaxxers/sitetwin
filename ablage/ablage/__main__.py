"""CLI: python -m ablage import <whatsapp|email|ordner|call> <path> --projekt "BV Simmering"."""

from __future__ import annotations

import argparse
import importlib
import sys
from datetime import datetime
from pathlib import Path

from . import config, store, transkript
from .models import ImportKontext

ADAPTER = {"whatsapp": "whatsapp", "email": "eml", "ordner": "ordner", "call": "call"}


def main(argv: list[str] | None = None) -> int:
    for strom in (sys.stdout, sys.stderr):
        if hasattr(strom, "reconfigure"):
            strom.reconfigure(encoding="utf-8")

    cfg = config.laden()
    parser = argparse.ArgumentParser(prog="ablage")
    sub = parser.add_subparsers(dest="befehl", required=True)
    imp = sub.add_parser("import", help="Quelle parsen und in Supabase ablegen")
    imp.add_argument("quelle", choices=sorted(ADAPTER))
    imp.add_argument("pfad", type=Path)
    imp.add_argument("--projekt", default=cfg.default_projekt)
    imp.add_argument("--dry-run", action="store_true", help="nur parsen, nichts schreiben")
    aud = sub.add_parser("audit", help="Datenqualität von quellen + Bucket prüfen (liest nur)")
    aud.add_argument("--projekt", default=cfg.default_projekt)
    aud.add_argument(
        "--fake-data",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "fake_data",
        help="Originale zum Abgleich; Ordner fehlt → Abgleich entfällt",
    )
    zeig = sub.add_parser("zeige", help="die zuletzt importierten Zeilen aus quellen anzeigen")
    zeig.add_argument("--projekt", default=cfg.default_projekt)
    zeig.add_argument("--limit", type=int, default=10)
    args = parser.parse_args(argv)

    if args.befehl == "zeige":
        backend = store.supabase_backend()
        zeilen = (
            backend.client.table(store.TABELLE)
            .select("zeitpunkt,typ,absender,anhang_typ,anhang_name,text,status,importiert_am")
            .eq("projekt", args.projekt)
            .order("importiert_am", desc=True)
            .order("zeitpunkt", desc=True)
            .limit(args.limit)
            .execute()
            .data
        )
        for z in reversed(zeilen):
            zeit = ""
            if z["zeitpunkt"]:
                wert = datetime.fromisoformat(z["zeitpunkt"].replace("Z", "+00:00"))
                zeit = wert.astimezone(cfg.tz).strftime("%d.%m.%y %H:%M")
            anhang = f"[{z['anhang_typ']}: {z['anhang_name']}] " if z["anhang_typ"] else ""
            text = " ".join((z["text"] or "").split())
            print(f"{zeit:16} {z['typ']:8} {z['status']:11} {z['absender'] or '-'}: {anhang}{text[:90]}")
        print(f"{len(zeilen)} Zeilen in Projekt '{args.projekt}'")
        return 0

    if args.befehl == "audit":
        from . import audit

        zeilen, dateien = audit.lade_supabase(store.supabase_backend(), args.projekt)
        ctx = ImportKontext(projekt=args.projekt, tz=cfg.tz)
        hat_originale = args.fake_data.is_dir()
        befunde = audit.pruefe(
            zeilen,
            dateien,
            quelle=audit.originale(args.fake_data, ctx) if hat_originale else None,
            belege=audit.belege_aus_erwartet(args.fake_data / "ERWARTET.md"),
        )
        print(audit.bericht(befunde))
        return 1 if any(b.stufe == audit.FEHLER for b in befunde) else 0

    try:
        adapter = importlib.import_module(f"ablage.adapters.{ADAPTER[args.quelle]}")
    except ModuleNotFoundError:
        print(f"Adapter '{args.quelle}' ist noch nicht gebaut.", file=sys.stderr)
        return 2

    backend = store.FakeBackend() if args.dry_run else store.supabase_backend()
    ctx = ImportKontext(projekt=args.projekt, tz=cfg.tz)
    transkribierer = None  # --dry-run calls no external interface
    if not args.dry_run:
        transkribierer = transkript.transkribierer_aus(
            cfg.transkript_api_key, cfg.transkript_base_url, cfg.transkript_modell
        )
    ergebnis = store.speichern(adapter.parse(args.pfad, ctx), backend, transkribierer)
    print(ergebnis.model_dump_json(indent=2))
    return 1 if ergebnis.fehler else 0


if __name__ == "__main__":
    raise SystemExit(main())
