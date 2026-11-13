"""Konfiguration aus uebersetzer/.env (nie committen) bzw. Umgebungsvariablen."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


@dataclass(frozen=True)
class Konfig:
    supabase_url: str | None
    supabase_key: str | None
    bucket: str
    projekt: str
    modell: str
    effort: str
    kontext_quellen: int


def laden() -> Konfig:
    return Konfig(
        supabase_url=os.getenv("SUPABASE_URL"),
        supabase_key=os.getenv("SUPABASE_SERVICE_KEY"),
        bucket=os.getenv("ABLAGE_BUCKET", "ablage"),
        projekt=os.getenv("DEFAULT_PROJEKT", "BV Simmering"),
        modell=os.getenv("UEBERSETZER_MODELL", "claude-haiku-5-5"),
        effort=os.getenv("UEBERSETZER_EFFORT", "medium"),
        kontext_quellen=int(os.getenv("UEBERSETZER_KONTEXT", "40")),
    )
