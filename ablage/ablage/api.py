"""HTTP-Eingang (SPEC §8). Start: uvicorn ablage.api:app --port 8000"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import parse_qs

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Request, Response
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from . import config, store
from .adapters import call, whatsapp_live, whatsapp_twilio
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


@lru_cache
def get_einstellungen() -> config.Einstellungen:
    return config.laden()


def get_jetzt() -> Callable[[], datetime]:
    return lambda: datetime.now(timezone.utc)


def get_downloader(cfg: config.Einstellungen = Depends(get_einstellungen)) -> whatsapp_twilio.Downloader:
    def lade(url: str) -> bytes:
        # ohne Zugangsdaten kein leerer Basic-Auth-Header (Twilio-Medien sind standardmäßig offen)
        auth = (cfg.twilio_account_sid, cfg.twilio_auth_token) if cfg.twilio_account_sid else None
        r = httpx.get(url, auth=auth, follow_redirects=True, timeout=10.0)
        r.raise_for_status()
        return r.content

    return lade


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


@app.post("/import/whatsapp/twilio")
async def import_whatsapp_twilio(
    request: Request,
    backend: store.Backend = Depends(get_backend),
    ctx: ImportKontext = Depends(get_kontext),
    cfg: config.Einstellungen = Depends(get_einstellungen),
    lade: whatsapp_twilio.Downloader = Depends(get_downloader),
    jetzt: Callable[[], datetime] = Depends(get_jetzt),
) -> Response:
    params = parse_qs((await request.body()).decode("utf-8", "replace"), keep_blank_values=True)
    if cfg.twilio_auth_token and cfg.twilio_webhook_url:
        header = request.headers.get("X-Twilio-Signature")
        if not whatsapp_twilio.signatur_gueltig(cfg.twilio_webhook_url, params, cfg.twilio_auth_token, header):
            raise HTTPException(status_code=403, detail="Twilio-Signatur ungültig")
    try:
        n = whatsapp_twilio.TwilioNachricht.model_validate({k: v[0] for k, v in params.items()})
    except ValidationError as e:
        detail = json.loads(e.json(include_url=False, include_input=False))
        raise HTTPException(status_code=422, detail=detail) from e
    item = await run_in_threadpool(
        whatsapp_twilio.aus_formular, n, ctx, jetzt(), cfg.whatsapp_live_kanal, lade
    )
    await run_in_threadpool(_speichern, [item], backend)
    return Response(content="<Response></Response>", media_type="text/xml")
