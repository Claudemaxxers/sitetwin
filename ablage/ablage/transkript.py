"""Sprachnachrichten transkribieren (SPEC §7.9). OpenAI-kompatible Schnittstelle (Whisper)."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from pathlib import PurePath

import httpx

from .models import AnhangTyp, ParseFehler, RawItem

# Bytes, Dateiname, Mimetype -> Text
Transkribierer = Callable[[bytes, str, str | None], str]

TIMEOUT = 12.0  # Twilio wartet höchstens 15 s auf die Webhook-Antwort
# Whisper erfindet bei Stille Text ("Vielen Dank."). Ab diesem no_speech_prob in ALLEN Segmenten
# gilt die Aufnahme als stumm. Gemessen bei Groq whisper-large-v3: Stille 0,70, Sprache unter 0,01.
STILLE_AB = 0.5


class TranskriptFehler(RuntimeError):
    pass


class KeineSprache(TranskriptFehler):
    """Aufnahme ohne Sprache: kein Transkript statt erfundenem Text."""


def ist_stille(segmente: object) -> bool:
    """True nur, wenn die Antwort Segmente hat und jedes davon als "keine Sprache" gilt."""
    if not isinstance(segmente, list) or not segmente:
        return False
    werte = [s.get("no_speech_prob") if isinstance(s, dict) else None for s in segmente]
    return all(isinstance(w, (int, float)) and w >= STILLE_AB for w in werte)


class HttpTranskribierer:
    """POST {base_url}/audio/transcriptions (multipart). Der Schlüssel steht nur im Header."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        modell: str = "whisper-1",
        timeout: float = TIMEOUT,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._key = api_key
        self.url = base_url.rstrip("/") + "/audio/transcriptions"
        self.modell = modell
        self._timeout = timeout
        self._transport = transport

    def __repr__(self) -> str:
        return f"HttpTranskribierer(url={self.url!r}, modell={self.modell!r})"

    def __call__(self, daten: bytes, dateiname: str, mimetype: str | None) -> str:
        name = PurePath(dateiname).name or "audio.ogg"
        if name.lower().endswith(".opus"):  # Ogg/Opus; die Schnittstelle lehnt ".opus" ab
            name = name[: -len(".opus")] + ".ogg"
            mimetype = "audio/ogg"
        felder = {"model": self.modell, "language": "de"}
        with httpx.Client(timeout=self._timeout, transport=self._transport) as client:

            def sende(data: dict[str, str]) -> httpx.Response:
                return client.post(
                    self.url,
                    headers={"Authorization": f"Bearer {self._key}"},
                    data=data,
                    files={"file": (name, daten, mimetype or "application/octet-stream")},
                )

            # verbose_json liefert Segmente mit no_speech_prob (für die Stille-Erkennung).
            r = sende({**felder, "response_format": "verbose_json"})
            if r.status_code == 400:  # Modell kennt verbose_json nicht: ohne Stille-Erkennung
                r = sende(felder)
        if r.status_code >= 400:
            raise TranskriptFehler(f"HTTP {r.status_code}")
        try:
            antwort = r.json()
            text = antwort.get("text")
        except (ValueError, AttributeError) as e:
            raise TranskriptFehler("Antwort ist kein JSON-Objekt") from e
        if ist_stille(antwort.get("segments")):
            raise KeineSprache("keine Sprache erkannt")
        if not isinstance(text, str) or not text.strip():
            raise TranskriptFehler("leere Antwort (kein Feld text)")
        return text.strip()


def transkribierer_aus(
    api_key: str, base_url: str, modell: str, transport: httpx.BaseTransport | None = None
) -> Transkribierer | None:
    """Leerer Schlüssel = Transkription aus."""
    if not api_key:
        return None
    return HttpTranskribierer(api_key, base_url, modell, transport=transport)


def ergaenze(
    eintraege: Iterable[RawItem | ParseFehler], transkribierer: Transkribierer | None
) -> list[RawItem | ParseFehler]:
    """Audio ohne Text bekommt sein Transkript. Fehler gehen nach meta, nie nach oben."""
    liste = list(eintraege)
    if transkribierer is None:
        return liste
    for item in liste:
        if isinstance(item, ParseFehler):
            continue
        a = item.anhang
        if a is None or a.typ is not AnhangTyp.audio or item.text:
            continue
        try:
            daten = a.lies()
            if not daten:
                continue
            text = transkribierer(daten, a.dateiname, a.mimetype)
            if not text or not text.strip():
                raise TranskriptFehler("leere Antwort")
        except Exception as e:  # Nachricht darf nicht verloren gehen
            item.meta["transkript_fehler"] = f"{type(e).__name__}: {e}"
            continue
        item.text = text.strip()
        item.meta["transkript_quelle"] = "whisper"
        modell = getattr(transkribierer, "modell", None)
        if modell:
            item.meta["transkript_modell"] = modell
    return liste
