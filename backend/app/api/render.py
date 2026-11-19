from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..core import tasks
from ..core.templates import list_templates
from .deps import jobs, pm

router = APIRouter(prefix="/api", tags=["render"])


class RenderBody(BaseModel):
    mode: str = "final"
    template: str | None = None
    burn_subtitles: bool = False
    overwrite: bool = False
    package: bool | None = None
    engine: str | None = None
    options: dict | None = None
    range_start_ms: int | None = None
    range_end_ms: int | None = None


class ExportBody(BaseModel):
    formats: list[str]
    overwrite: bool = False


@router.get("/templates")
def templates():
    return list_templates()


@router.post("/projects/{pid}/render", status_code=202)
def render(pid: str, body: RenderBody, request: Request):
    m = pm(request)
    m.load_plan(pid)
    m.source_path(pid)
    if body.mode not in ("fast", "final"):
        raise HTTPException(422, "mode: fast или final")
    if body.engine not in (None, "ffmpeg", "auto-editor"):
        raise HTTPException(422, "engine: ffmpeg или auto-editor")
    params = {k: v for k, v in body.model_dump().items() if v is not None}
    return jobs(request).submit(pid, "render", params)


@router.post("/projects/{pid}/export")
def export(pid: str, body: ExportBody, request: Request):
    return tasks.export_package(pm(request), pid, body.formats, body.overwrite)


ALLOWED_EXPORT_SUFFIXES = {
    ".mp4", ".xml", ".fcpxml", ".edl", ".otio", ".v3",
    ".csv", ".txt", ".srt", ".vtt", ".ass", ".json",
}


@router.get("/projects/{pid}/exports")
def list_exports(pid: str, request: Request):
    d = pm(request).path(pid, "exports")
    s = pm(request).path(pid, "subtitles")
    out = []
    for base in (d, s):
        if not base.is_dir():
            continue
        for f in sorted(base.glob("*")):
            if f.is_file() and not f.name.endswith(".part.mp4") and not f.name.endswith(".tmp") and f.suffix.lower() in ALLOWED_EXPORT_SUFFIXES:
                if base is s and not (f.name.startswith("edited") or f.name.startswith("translated")):
                    continue
                out.append({"name": f.name, "size": f.stat().st_size, "where": base.name})
    return out


@router.get("/projects/{pid}/exports/{name}")
def download(pid: str, name: str, request: Request):
    m = pm(request)
    for base in ("exports", "subtitles"):
        f = m.path(pid, base, name)
        if f.is_file() and f.parent.name == base and "/" not in name and "\\" not in name:
            return FileResponse(f, filename=name)
    raise HTTPException(404)


@router.get("/projects/{pid}/log")
def log(pid: str, request: Request, lines: int = 300):
    f = pm(request).path(pid, "logs", "processing.log")
    if not f.is_file():
        return {"lines": []}
    return {"lines": f.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]}
