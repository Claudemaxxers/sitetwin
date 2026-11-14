"""Kommandozeile (aus sitetwin/uebersetzer/ starten):

    uv run python -m uebersetzer lauf --mit-claude          # echte DB: alle quellen mit status='neu'
    uv run python -m uebersetzer lauf --mit-claude --dauerhaft 30
    uv run python -m uebersetzer trockenlauf                # fake_data, ohne Claude (kostenlos)
    uv run python -m uebersetzer trockenlauf --mit-claude --limit 5

HACKATHON-KOSTENSPERRE: Claude-Aufrufe kosten Geld. Ohne --mit-claude ruft kein Befehl die API auf.
Das ist Absicht und bleibt so.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import tempfile
import time
from pathlib import Path

from . import konfig as konfig_mod
from . import testquellen
from .db import SpeicherDB, SupabaseDB
from .extraktion import extrahieren
from .lauf import Bericht, verarbeite
from .modell import Ergebnis

REPO = Path(__file__).resolve().parents[2]


CENT_PRO_AUFRUF = 0.08  # gemessen 13.11.: 49 Aufrufe Haiku 5.5 ≈ 4 Cent


def _kostensperre(args, anzahl_aufrufe: int) -> None:
    """HACKATHON-KOSTENSPERRE: bricht ab, wenn Claude aufgerufen würde, ohne dass --mit-claude gesetzt ist.
    Bleibt bewusst drin (siehe README, Kasten Kosten)."""
    schaetzung = anzahl_aufrufe * CENT_PRO_AUFRUF
    if not args.mit_claude:
        sys.exit(
            f"Kostensperre: {anzahl_aufrufe} Quellen würden an Claude gehen (ca. {schaetzung:.1f} Cent).\n"
            "Nur wenn nötig: mit --mit-claude erneut starten. "
            "Kostenlos testen: uv run pytest oder trockenlauf ohne --mit-claude."
        )
    print(f"Claude wird für {anzahl_aufrufe} Quellen aufgerufen (ca. {schaetzung:.1f} Cent).")


def _claude_aufrufe(db, projekt: str | None) -> int:
    from .lauf import _ohne_llm

    return sum(1 for q in db.neue_quellen(projekt) if _ohne_llm(q) is None)


def _claude_extrahierer(k: konfig_mod.Konfig):
    import anthropic

    try:
        client = anthropic.Anthropic()
    except anthropic.AnthropicError as err:
        sys.exit(f"Kein Claude-Zugang: {err}\n→ ANTHROPIC_API_KEY in uebersetzer/.env eintragen.")
    return lambda system, messages: extrahieren(client, k.modell, k.effort, system, messages)


def _ausgabe(bericht: Bericht) -> None:
    print(
        f"\nverarbeitet: {bericht.verarbeitet} (davon ohne Claude: {bericht.uebersprungen}) · "
        f"Einträge: {bericht.eintraege} · Pläne: {bericht.plaene} · "
        f"später: {bericht.spaeter} · Fehler: {len(bericht.fehler)}"
    )
    for f in bericht.fehler:
        print("  ✗", f)
    from .extraktion import VERBRAUCH as v

    if v["aufrufe"]:
        print(
            f"Claude: {v['aufrufe']} Aufrufe · Input {v['input']:,} · Cache geschrieben {v['cache_write']:,} · "
            f"Cache gelesen {v['cache_read']:,} · Output {v['output']:,} Tokens"
        )


def _supabase(k: konfig_mod.Konfig) -> SupabaseDB:
    if not (k.supabase_url and k.supabase_key):
        sys.exit("SUPABASE_URL und SUPABASE_SERVICE_KEY fehlen in uebersetzer/.env")
    return SupabaseDB(k.supabase_url, k.supabase_key, k.bucket)


def _claude_pruefer(k: konfig_mod.Konfig):
    import anthropic

    from .pruefung import pruefe_mit_claude

    client = anthropic.Anthropic()
    return lambda system, messages: pruefe_mit_claude(client, k.modell, k.effort, system, messages)


def _pruef_ausgabe(b) -> None:
    print(
        f"\nPrüf-Agent: {b.eintraege} Einträge geprüft · neue Signale: {len(b.neu)} · ergänzt: {b.ergaenzt} · "
        f"wieder offen: {b.wieder_offen} · gelöst: {len(b.geloest)} · Claude-Prüfungen: {b.claude_aufrufe} · Fehler: {len(b.fehler)}"
    )
    for s in b.neu:
        print("  ⚑", s)
    for s in b.abgestuft:
        print("  ↓ abgestuft:", s)
    for s in b.geloest:
        print("  ✓", s)
    for s in b.soll:
        print("  ◆ Soll-Änderung", s)
    for f in b.fehler:
        print("  ✗", f)


def cmd_lauf(args, k: konfig_mod.Konfig) -> None:
    """Übersetzen und danach prüfen – die ganze Kette für die Demo."""
    from .pruefung import pruefe

    db = _supabase(k)
    aufrufe = _claude_aufrufe(db, args.projekt)
    if aufrufe:
        _kostensperre(args, aufrufe)
    elif not args.dauerhaft:
        print("Keine neuen Quellen, die Claude brauchen.")
    if not args.mit_claude and args.dauerhaft:
        sys.exit("Kostensperre: --dauerhaft nur zusammen mit --mit-claude.")
    extrahierer = _claude_extrahierer(k) if args.mit_claude else None
    pruefer = _claude_pruefer(k) if args.mit_claude else None
    while True:
        if extrahierer:
            _ausgabe(verarbeite(db, extrahierer, args.projekt, k.kontext_quellen))
        _pruef_ausgabe(pruefe(db, args.projekt, pruefer))
        if not args.dauerhaft:
            return
        time.sleep(args.dauerhaft)


class _NurLesen:
    """Liest aus Supabase, schreibt nichts: Schreibzugriffe werden nur protokolliert."""

    def __init__(self, db: SupabaseDB):
        self._db = db
        self._signale: list[dict] = []

    def __getattr__(self, name):
        return getattr(self._db, name)

    def signale(self, projekt):
        return self._db.signale(projekt) + [s for s in self._signale if s["projekt"] == projekt]

    def signal_einfuegen(self, zeile):
        neu = {"status": "offen", **zeile, "id": f"trocken-{len(self._signale)}"}
        self._signale.append(neu)
        return neu

    def signal_aendern(self, signal_id, felder):
        pass

    def als_geprueft(self, ids):
        pass


def cmd_pruefen(args, k: konfig_mod.Konfig) -> None:
    from .pruefung import PRUEF_ARTEN, pruefe

    db = _supabase(k)
    if args.trocken:
        db = _NurLesen(db)
        print("Trocken: es wird nichts in die Datenbank geschrieben.")
    pruefer = None
    if args.mit_claude:
        from itertools import groupby

        gruppen = sum(
            1 for _, g in groupby(db.ungepruefte_eintraege(args.projekt), key=lambda e: e["quelle_hash"])
            if any(e["art"] in PRUEF_ARTEN for e in g)
        )
        _kostensperre(args, gruppen)
        pruefer = _claude_pruefer(k)
    else:
        print("Nur feste Regeln (kostenlos). Claude-Prüfung mit --mit-claude.")
    while True:
        _pruef_ausgabe(pruefe(db, args.projekt, pruefer))
        if not args.dauerhaft:
            return
        time.sleep(args.dauerhaft)


def cmd_trockenlauf(args, k: konfig_mod.Konfig) -> None:
    fake = Path(args.fake_data)
    with tempfile.TemporaryDirectory() as tmp:
        quellen = testquellen.alle(fake, k.projekt, Path(tmp))
        if args.limit:
            stamm = [q for q in quellen if not q["zeitpunkt"]]
            datiert = sorted((q for q in quellen if q["zeitpunkt"]), key=lambda q: q["zeitpunkt"])
            quellen = stamm + datiert[: args.limit]
        tops, lv = testquellen.stammdaten_aus_csv(fake / "drive" / "Projekt_Simmering", k.projekt)
        db = SpeicherDB(quellen, tops, lv)

        if args.mit_claude:
            _kostensperre(args, _claude_aufrufe(db, None))
        if not args.mit_claude:
            def extrahierer(system, messages):
                teile = messages[0]["content"]
                art = ", ".join(t["type"] for t in teile)
                print(f"   → würde Claude fragen: {len(teile)} Block/Blöcke ({art}), {len(teile[-1]['text'])} Zeichen Text")
                return Ergebnis(eintraege=[], plaene=[], soll=[], elemente=[])
        else:
            extrahierer = _claude_extrahierer(k)

        bericht = verarbeite(db, extrahierer, None, k.kontext_quellen)

    _ausgabe(bericht)
    if args.mit_claude:
        print("\nPläne:")
        for p in db.aktuelle_plaene(k.projekt):
            print(f"  {p['plan_nr']} Index {p['plan_index']} (gültig) – {p.get('aenderung') or ''}")
        bauteile = {el["id"]: el for el in db.elemente(k.projekt)}
        print(f"\nBauteile ({len(bauteile)}):")
        for el in sorted(bauteile.values(), key=lambda x: x["schluessel"]):
            wand = bauteile.get(el.get("gehoert_zu") or "", {}).get("bezeichnung", "")
            aktiv = "" if el.get("soll_aktiv", True) else "  ENTFÄLLT"
            print(f"  {el['schluessel']:60.60} {el['art']:9} {('in ' + wand) if wand else '':16} Plan {el.get('soll_plan_nr')} {el.get('soll_plan_index')}{aktiv}")
        print("\nEinträge:")
        for e in sorted(db.eintraege, key=lambda e: (str(e["zeitpunkt"] or ""), e["nr"])):
            ort = " / ".join(x for x in (e["top"], e["raum"], e["element"]) if x)
            plan = f" [Plan {e['plan_nr'] or ''} {e['plan_index']}]" if e.get("plan_index") else ""
            flag = " ⚠ unklar" if e["unklar"] else ""
            bt = bauteile.get(e.get("element_id") or "")
            zuord = f" → {bt['schluessel']} ({e.get('schritt')})" if bt else ""
            print(f"  {str(e['zeitpunkt'] or '')[:16]:16} {e['art']:16} {ort:35.35} {e['zusammenfassung']}{plan}{flag}{zuord}")
    if args.json:
        Path(args.json).write_text(json.dumps(
            {"eintraege": db.eintraege, "plaene": db.plaene, "elemente": db.elemente_liste}, ensure_ascii=False, indent=2, default=str
        ))
        print(f"\nJSON geschrieben: {args.json}")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    for laut in ("httpx", "httpx2", "httpcore", "httpcore2", "anthropic"):
        logging.getLogger(laut).setLevel(logging.WARNING)
    k = konfig_mod.laden()

    p = argparse.ArgumentParser(prog="python -m uebersetzer")
    sub = p.add_subparsers(dest="cmd", required=True)
    l = sub.add_parser("lauf", help="Neue Quellen aus Supabase übersetzen")
    l.add_argument("--projekt", help="nur dieses Projekt (Standard: alle)")
    l.add_argument("--dauerhaft", type=int, metavar="SEK", help="in Schleife laufen, alle SEK Sekunden")
    t = sub.add_parser("trockenlauf", help="fake_data übersetzen, ohne in die DB zu schreiben")
    t.add_argument("--fake-data", default=str(REPO / "fake_data"))
    pr = sub.add_parser("pruefen", help="Prüf-Agent: neue Einträge gegen den gültigen Plan prüfen, Signale anlegen")
    pr.add_argument("--projekt")
    pr.add_argument("--trocken", action="store_true", help="aus Supabase lesen, nichts schreiben")
    pr.add_argument("--dauerhaft", type=int, metavar="SEK")
    for befehl in (l, t, pr):  # HACKATHON-KOSTENSPERRE
        befehl.add_argument("--mit-claude", action="store_true", help="Claude wirklich aufrufen (kostet Geld)")
    t.add_argument("--limit", type=int, help="nur die ersten N datierten Quellen")
    t.add_argument("--json", help="Ergebnis zusätzlich als JSON speichern")
    args = p.parse_args()

    {"lauf": cmd_lauf, "trockenlauf": cmd_trockenlauf, "pruefen": cmd_pruefen}[args.cmd](args, k)


if __name__ == "__main__":
    main()
