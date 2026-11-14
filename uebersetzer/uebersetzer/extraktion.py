"""The actual Claude call: one source + context → Ergebnis (entries, plans)."""

from __future__ import annotations

from typing import Any

import anthropic

from . import prompt
from .modell import Ergebnis


class ExtraktionsFehler(Exception):
    pass


# Token usage across all calls of this process (for the cost display).
VERBRAUCH = {"aufrufe": 0, "input": 0, "cache_write": 0, "cache_read": 0, "output": 0}


def baue_anfrage(
    quelle: dict[str, Any],
    anhang_bloecke: list[dict[str, Any]],
    hinweis: str | None,
    zeitachse: list[dict[str, Any]],
    plaene: list[dict[str, Any]],
    stammdaten: str,
    bauteile: str = "(noch keine Bauteile aus Plänen bekannt)",
    soll_aenderungen: str = "(keine)",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Returns (system, messages). Separate from the call so tests can check the prompt."""
    system = [
        {"type": "text", "text": prompt.SYSTEM},
        # Master data hardly changes per project → cache it together with the system prompt.
        {"type": "text", "text": stammdaten, "cache_control": {"type": "ephemeral"}},
    ]
    kontext = "\n".join(prompt.quelle_kurz(q) for q in zeitachse) or "(noch nichts)"
    text = (
        f"<gueltige_plaene>\n{prompt.plaene_block(plaene)}\n</gueltige_plaene>\n\n"
        f"<bauteile hinweis=\"Soll laut Plänen; für das Feld bauteil den Schlüssel exakt übernehmen\">\n{bauteile}\n</bauteile>\n\n"
        f"<offene_soll_aenderungen hinweis=\"für soll.bezug den Schlüssel exakt übernehmen\">\n{soll_aenderungen}\n</offene_soll_aenderungen>\n\n"
        f"<zeitachse hinweis=\"Kontext, ältere Quellen, nicht extrahieren\">\n{kontext}\n</zeitachse>\n\n"
        f"{prompt.neue_quelle_block(quelle, hinweis)}"
    )
    messages = [{"role": "user", "content": [*anhang_bloecke, {"type": "text", "text": text}]}]
    return system, messages


def extrahieren(
    client: anthropic.Anthropic,
    modell: str,
    effort: str,
    system: list[dict[str, Any]],
    messages: list[dict[str, Any]],
) -> Ergebnis:
    response = client.messages.parse(
        model=modell,
        max_tokens=16000,
        system=system,
        messages=messages,
        output_format=Ergebnis,
        output_config={"effort": effort},
    )
    u = response.usage
    VERBRAUCH["aufrufe"] += 1
    VERBRAUCH["input"] += u.input_tokens or 0
    VERBRAUCH["cache_write"] += u.cache_creation_input_tokens or 0
    VERBRAUCH["cache_read"] += u.cache_read_input_tokens or 0
    VERBRAUCH["output"] += u.output_tokens or 0
    if response.stop_reason == "refusal":
        kategorie = getattr(response.stop_details, "category", None) if response.stop_details else None
        raise ExtraktionsFehler(f"Claude hat abgelehnt (Kategorie: {kategorie})")
    if response.stop_reason == "max_tokens":
        raise ExtraktionsFehler("Antwort abgeschnitten (max_tokens)")
    if response.parsed_output is None:
        raise ExtraktionsFehler(f"Keine gültige Ausgabe (stop_reason={response.stop_reason})")
    return response.parsed_output
