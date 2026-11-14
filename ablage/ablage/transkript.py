"""Transcribe voice messages (SPEC §7.9). OpenAI-compatible interface (Whisper)."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from pathlib import PurePath

import httpx

from .models import AnhangTyp, ParseFehler, RawItem

# bytes, file name, mimetype -> text
Transkribierer = Callable[[bytes, str, str | None], str]

TIMEOUT = 12.0  # Twilio waits at most 15 s for the webhook response
# Whisper invents text on silence ("Vielen Dank."). From this no_speech_prob in ALL segments on,
# the recording counts as silent. Measured with Groq whisper-large-v3: silence 0.70, speech below 0.01.
STILLE_AB = 0.5


class TranskriptFehler(RuntimeError):
    pass


class KeineSprache(TranskriptFehler):
    """Recording without speech: no transcript instead of invented text."""


def ist_stille(segmente: object) -> bool:
    """True only if the response has segments and each of them counts as "no speech"."""
    if not isinstance(segmente, list) or not segmente:
        return False
    werte = [s.get("no_speech_prob") if isinstance(s, dict) else None for s in segmente]
    return all(isinstance(w, (int, float)) and w >= STILLE_AB for w in werte)


class HttpTranskribierer:
    """POST {base_url}/audio/transcriptions (multipart). The key appears only in the header."""

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
        if name.lower().endswith(".opus"):  # Ogg/Opus; the interface rejects ".opus"
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

            # verbose_json returns segments with no_speech_prob (for silence detection).
            r = sende({**felder, "response_format": "verbose_json"})
            if r.status_code == 400:  # model does not know verbose_json: without silence detection
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
    """Empty key = transcription off."""
    if not api_key:
        return None
    return HttpTranskribierer(api_key, base_url, modell, transport=transport)


def ergaenze(
    eintraege: Iterable[RawItem | ParseFehler], transkribierer: Transkribierer | None
) -> list[RawItem | ParseFehler]:
    """Audio without text gets its transcript. Errors go into meta, never upwards."""
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
        except Exception as e:  # message must not be lost
            item.meta["transkript_fehler"] = f"{type(e).__name__}: {e}"
            continue
        item.text = text.strip()
        item.meta["transkript_quelle"] = "whisper"
        modell = getattr(transkribierer, "modell", None)
        if modell:
            item.meta["transkript_modell"] = modell
    return liste
