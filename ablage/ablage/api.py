"""HTTP-Eingang (SPEC §8). Start: uvicorn ablage.api:app --port 8000"""

from __future__ import annotations

import json
from collections.abc import Iterable
from functools import lru_cache

from fastapi import Body, Depends, FastAPI, HTTPException
from pydantic import ValidationError

from . import config, store
from .adapters import call, whatsapp_live
from .models import ImportErgebnis, ImportKontext, ParseFehler, RawItem

app = FastAPI(title="SiteTwin Ablage", version="0.1.0")


@lru_cache
def get_backend() -> store.Backend:
    return store.supabase_backend()


@lru_cache
def get_kontext() -> ImportKontext:
    cfg = config.laden()
    return ImportKontext(projekt=cfg.default_projekt, tz=cfg.tz)


def _speichern(eintraege: Iterable[RawItem | ParseFehler], backend: store.Backend) -> ImportErgebnis:
    try:
        return store.speichern(eintraege, backend)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Supabase nicht erreichbar: {e}") from e


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/import/call", response_model=ImportErgebnis)
def import_call(
    payload: dict = Body(...),
    backend: store.Backend = Depends(get_backend),
    ctx: ImportKontext = Depends(get_kontext),
) -> ImportErgebnis:
    try:
        item = call.aus_payload(payload, ctx)
    except ValidationError as e:
        detail = json.loads(e.json(include_url=False, include_input=False))
        raise HTTPException(status_code=422, detail=detail) from e
    return _speichern([item], backend)


@app.post("/import/whatsapp/nachricht", response_model=ImportErgebnis)
def import_whatsapp_nachricht(
    nachricht: whatsapp_live.LiveNachricht,
    backend: store.Backend = Depends(get_backend),
    ctx: ImportKontext = Depends(get_kontext),
) -> ImportErgebnis:
    return _speichern([whatsapp_live.aus_nachricht(nachricht, ctx)], backend)
