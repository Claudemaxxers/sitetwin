"""Konfiguration aus ablage/.env (SPEC §9)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

ENV_PFAD = Path(__file__).resolve().parents[1] / ".env"


@dataclass(frozen=True)
class Einstellungen:
    supabase_url: str
    supabase_key: str
    bucket: str
    default_projekt: str
    tz: ZoneInfo


def laden() -> Einstellungen:
    load_dotenv(ENV_PFAD)
    return Einstellungen(
        supabase_url=os.environ.get("SUPABASE_URL", "").strip(),
        supabase_key=os.environ.get("SUPABASE_SERVICE_KEY", "").strip(),
        bucket=os.environ.get("ABLAGE_BUCKET", "").strip() or "ablage",
        default_projekt=os.environ.get("DEFAULT_PROJEKT", "").strip() or "BV Simmering",
        tz=ZoneInfo(os.environ.get("TZ", "").strip() or "Europe/Vienna"),
    )
