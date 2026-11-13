"""CLI: python -m ablage import <whatsapp|email|ordner|call> <pfad> --projekt "BV Simmering"."""

from __future__ import annotations

import argparse
import importlib
import sys
from pathlib import Path

from . import config, store
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
    args = parser.parse_args(argv)

    try:
        adapter = importlib.import_module(f"ablage.adapters.{ADAPTER[args.quelle]}")
    except ModuleNotFoundError:
        print(f"Adapter '{args.quelle}' ist noch nicht gebaut.", file=sys.stderr)
        return 2

    backend = store.FakeBackend() if args.dry_run else store.supabase_backend()
    ctx = ImportKontext(projekt=args.projekt, tz=cfg.tz)
    ergebnis = store.speichern(adapter.parse(args.pfad, ctx), backend)
    print(ergebnis.model_dump_json(indent=2))
    return 1 if ergebnis.fehler else 0


if __name__ == "__main__":
    raise SystemExit(main())
