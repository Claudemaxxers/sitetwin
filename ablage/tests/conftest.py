from pathlib import Path

import pytest

from ablage.models import ImportKontext

FAKE_DATA = Path(__file__).resolve().parents[2] / "fake_data"
WA = FAKE_DATA / "whatsapp"
CALL = FAKE_DATA / "calls" / "call_2026-11-13_1610_huber.json"


@pytest.fixture
def ctx() -> ImportKontext:
    return ImportKontext(projekt="BV Simmering")
