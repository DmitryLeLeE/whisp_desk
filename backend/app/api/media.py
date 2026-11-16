from __future__ import annotations

import os
import string
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from ..integrations import auto_editor, ffmpeg, whisp
from ..media.ffprobe import SUPPORTED_CONTAINERS
from ..core.config import find_tool
from ..core.fsutil import read_json
from .deps import pm

router = APIRouter(prefix="/api", tags=["media"])


@router.get("/system")
def system():
    return {"ffmpeg": ffmpeg.info(), "ffprobe": bool(find_tool("ffprobe")), "auto_editor": auto_editor.info(),
            "whisp": whisp.info()}


@router.get("/fs")
def browse(path: str = ""):
    """Простой обзор папок для выбора файла. Сервер доступен только с 127.0.0.1."""
    if not path:
        if sys.platform == "win32":
            roots = [f"{d}:\\" for d in string.ascii_uppercase if Path(f"{d}:\\").exists()]
            return {"path": "", "parent": None, "entries": [{"name": r, "dir": True, "path": r} for r in roots]}
        path = str(Path.home())
    p = Path(path).expanduser()
    if not p.is_dir():
        raise HTTPException(404, "Папка не найдена")
    entries = []
    try:
        for e in sorted(os.scandir(p), key=lambda e: (not e.is_dir(), e.name.lower())):
            if e.name.startswith("."):
                continue
            is_dir = e.is_dir()
            if is_dir or Path(e.name).suffix.lower() in SUPPORTED_CONTAINERS | {".mp3", ".wav", ".m4a", ".flac", ".srt"}:
                entries.append({"name": e.name, "dir": is_dir, "path": str(Path(e.path))})
    except PermissionError:
        raise HTTPException(403, "Нет доступа к папке") from None
    parent = str(p.parent) if p.parent != p else None
    return {"path": str(p), "parent": parent, "entries": entries}


@router.get("/projects/{pid}/media/{kind}")
def media_file(pid: str, kind: str, request: Request):
    m = pm(request)
    if kind == "proxy":
        f = m.path(pid, "analysis", "proxy.mp4")
        if not f.is_file():
            raise HTTPException(404, "Proxy ещё не создан")
        return FileResponse(f, media_type="video/mp4")
    if kind == "source":
        return FileResponse(m.source_path(pid))
    raise HTTPException(404)


@router.get("/projects/{pid}/analysis/{name}")
def analysis_data(pid: str, name: str, request: Request):
    if name not in ("metadata", "silence", "scenes", "waveform", "thumbnails", "compare"):
        raise HTTPException(404)
    data = read_json(pm(request).path(pid, "analysis", f"{name}.json"))
    if data is None:
        raise HTTPException(404, "Данные ещё не получены: запустите анализ")
    return data


@router.get("/projects/{pid}/thumbnails/{file}")
def thumbnail(pid: str, file: str, request: Request):
    if "/" in file or "\\" in file or not file.startswith("thumb_"):
        raise HTTPException(404)
    f = pm(request).path(pid, "analysis", "thumbnails", file)
    if not f.is_file():
        raise HTTPException(404)
    return FileResponse(f, media_type="image/jpeg")
