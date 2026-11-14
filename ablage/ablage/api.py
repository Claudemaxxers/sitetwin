"""HTTP-Eingang (SPEC §8). Start: uvicorn ablage.api:app --port 8000"""

from __future__ import annotations

import base64
import binascii
import hmac
import json
from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import parse_qs

import httpx
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from . import config, store
from .adapters import call, eml, ordner, whatsapp_live, whatsapp_twilio
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


def token_pruefen(
    x_ablage_token: str | None = Header(default=None),
    cfg: config.Einstellungen = Depends(get_einstellungen),
) -> None:
    """Gemeinsames Token für die n8n-Endpunkte (SPEC §7.7, §7.8). Leer = keine Prüfung."""
    if cfg.import_token and not hmac.compare_digest(
        x_ablage_token.encode() if x_ablage_token else b"", cfg.import_token.encode()
    ):
        raise HTTPException(status_code=401, detail="X-Ablage-Token fehlt oder ist falsch")


class GmailMail(BaseModel):
    raw: str = Field(min_length=1)
    gmail_id: str = Field(min_length=1)
    projekt: str | None = None


def _base64url(roh: str) -> bytes:
    text = "".join(roh.split())
    try:
        daten = base64.b64decode(
            text.replace("-", "+").replace("_", "/") + "=" * (-len(text) % 4), validate=True
        )
    except (binascii.Error, ValueError) as e:
        raise HTTPException(status_code=422, detail=f"raw ist kein gültiges base64url: {e}") from e
    if not daten:
        raise HTTPException(status_code=422, detail="raw ist leer")
    return daten


@app.post("/import/email/gmail", response_model=ImportErgebnis, dependencies=[Depends(token_pruefen)])
def import_email_gmail(
    mail: GmailMail,
    backend: store.Backend = Depends(get_backend),
    ctx: ImportKontext = Depends(get_kontext),
) -> ImportErgebnis:
    daten = _base64url(mail.raw)
    if mail.projekt:
        ctx = ImportKontext(projekt=mail.projekt, tz=ctx.tz)
    try:
        items = list(eml.aus_bytes(daten, f"gmail-{mail.gmail_id}.eml", ctx))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Mail nicht lesbar: {e}") from e
    for item in items:
        item.meta.update({"quelle": "gmail", "gmail_id": mail.gmail_id})
    return _speichern(items, backend)


@app.post("/import/drive/datei", response_model=ImportErgebnis, dependencies=[Depends(token_pruefen)])
async def import_drive_datei(
    request: Request,
    pfad: str = "",
    kanal: str = "Google Drive",
    projekt: str | None = None,
    datei_id: str | None = None,
    geaendert_am: str | None = None,
    backend: store.Backend = Depends(get_backend),
    ctx: ImportKontext = Depends(get_kontext),
) -> ImportErgebnis:
    ref = pfad.replace("\\", "/").strip().lstrip("/")
    if not ref or ref.endswith("/"):
        raise HTTPException(status_code=422, detail="pfad fehlt (relativer Pfad inkl. Dateiname)")
    daten = await request.body()
    if not daten:
        raise HTTPException(status_code=422, detail="Body ist leer")
    if ordner.ignoriert(ref):
        return ImportErgebnis()
    try:
        item = await run_in_threadpool(
            ordner.item_aus_bytes, daten, ref, projekt or ctx.projekt, kanal or "Google Drive",
            geaendert_am or None,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Datei nicht lesbar: {e}") from e
    item.meta["quelle"] = "n8n"
    if datei_id:
        item.meta["drive_id"] = datei_id
    return await run_in_threadpool(_speichern, [item], backend)
