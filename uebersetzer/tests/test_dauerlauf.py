"""Continuous run (lauf --dauerhaft): a network dropout only aborts the cycle, not the run. Without Claude, without Supabase."""

from argparse import Namespace

import httpx
import pytest

from uebersetzer import __main__ as cli
from uebersetzer.db import SpeicherDB
from uebersetzer.konfig import laden


class WackeligeDB(SpeicherDB):
    """Raises a DNS error, like on a hotspot, on the `fehler_bei`-th fetch of new sources."""

    def __init__(self, fehler_bei: int):
        super().__init__([], [], [])
        self.abrufe = 0
        self.fehler_bei = fehler_bei

    def neue_quellen(self, projekt):
        self.abrufe += 1
        if self.abrufe == self.fehler_bei:
            raise httpx.ConnectError("[Errno 8] nodename nor servname provided, or not known")
        return super().neue_quellen(projekt)


class Ende(Exception):
    pass


def _starten(monkeypatch, db, dauerhaft, takte=3):
    monkeypatch.setattr(cli, "_supabase", lambda k: db)
    monkeypatch.setattr(cli, "_claude_extrahierer", lambda k: lambda s, m: None)
    monkeypatch.setattr(cli, "_claude_pruefer", lambda k: lambda s, m: None)
    pausen = []

    def schlafen(sek):
        pausen.append(sek)
        if len(pausen) >= takte:
            raise Ende

    monkeypatch.setattr(cli.time, "sleep", schlafen)
    args = Namespace(projekt="BV Simmering", ohne_claude=False, dauerhaft=dauerhaft)
    return args, pausen


def test_dauerlauf_ueberlebt_netzfehler(monkeypatch, capsys):
    db = WackeligeDB(fehler_bei=2)  # fetch 1: cost estimate at start, fetch 2: first cycle
    args, pausen = _starten(monkeypatch, db, dauerhaft=5)
    with pytest.raises(Ende):
        cli.cmd_lauf(args, laden())
    assert pausen == [5, 5, 5]
    assert db.abrufe == 4  # after the error the loop kept running
    assert "Netz/Supabase nicht erreichbar (ConnectError" in capsys.readouterr().out


def test_einmaliger_lauf_meldet_netzfehler_weiter(monkeypatch):
    db = WackeligeDB(fehler_bei=2)
    args, _ = _starten(monkeypatch, db, dauerhaft=None)
    with pytest.raises(httpx.ConnectError):
        cli.cmd_lauf(args, laden())
