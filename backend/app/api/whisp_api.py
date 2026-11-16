"""Whisp: модели, языки, глобальные настройки."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..core import config
from ..integrations import auto_editor, ffmpeg, whisp

router = APIRouter(prefix="/api", tags=["whisp"])


@router.get("/whisp/models")
def models(request: Request):
    return {"models": request.app.state.models.status(), "languages": whisp.LANGUAGES,
            "model_dir": str(whisp.model_dir() or ""), "info": whisp.info()}


@router.post("/whisp/models/{name}/download", status_code=202)
def download(name: str, request: Request):
    try:
        request.app.state.models.start(name)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True}


@router.delete("/whisp/models/{name}/download")
def cancel(name: str, request: Request):
    request.app.state.models.cancel(name)
    return {"ok": True}


class SettingsBody(BaseModel):
    whisp_model_dir: str | None = None


@router.get("/settings")
def get_settings():
    s = config.load_settings()
    return {"whisp_model_dir": s.get("whisp_model_dir", ""), "root": str(config.ROOT), "projects_dir": str(config.PROJECTS_DIR),
            "tools": {"ffmpeg": ffmpeg.info(), "auto_editor": auto_editor.info(), "whisp": whisp.info()},
            "frozen": config.FROZEN, "version": config.VERSION}


@router.put("/settings")
def put_settings(body: SettingsBody):
    s = config.load_settings()
    if body.whisp_model_dir is not None:
        value = body.whisp_model_dir.strip()
        if value:
            p = Path(value)
            if not p.is_absolute():
                raise HTTPException(422, "Укажите полный путь к папке")
            try:
                p.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise HTTPException(422, f"Папка недоступна: {exc}") from exc
            s["whisp_model_dir"] = str(p)
        else:
            s.pop("whisp_model_dir", None)
    config.save_settings(s)
    return get_settings()
