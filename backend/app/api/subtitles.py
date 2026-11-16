from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ..core import tasks
from ..editing import subtitles as subs
from .deps import jobs, pm

router = APIRouter(prefix="/api/projects/{pid}/subtitles", tags=["subtitles"])
MAX_UPLOAD = 20 * 2**20


class TranscribeBody(BaseModel):
    model: str = "small"
    language: str = "auto"
    overwrite: bool = False


@router.get("")
def get_cues(pid: str, request: Request):
    m = pm(request)
    cues = tasks.load_cues(m, pid)
    return {"cues": [c.to_dict() for c in cues]}


@router.post("/import")
async def import_cues(pid: str, request: Request, file: UploadFile = File(...)):
    m = pm(request)
    m.dir(pid)
    name = Path(file.filename or "subtitles.srt").name
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "Файл субтитров слишком большой")
    tmp = m.path(pid, "subtitles", f".upload_{name}")
    tmp.write_bytes(raw)
    try:
        cues = subs.load_subtitles(tmp)
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, f"Не удалось прочитать субтитры: {exc}") from exc
    finally:
        tmp.unlink(missing_ok=True)
    tasks.save_cues(m, pid, cues, name, raw)
    return {"cues": len(cues)}


@router.post("/transcribe", status_code=202)
def transcribe(pid: str, body: TranscribeBody, request: Request):
    pm(request).source_path(pid)
    return jobs(request).submit(pid, "transcribe", body.model_dump())


@router.get("/remapped")
def remapped(pid: str, request: Request):
    """Реплики на временной шкале нового видео (для проверки пересчёта)."""
    m = pm(request)
    cues = tasks.load_cues(m, pid)
    return {"cues": [c.to_dict() for c in subs.remap_cues(cues, m.load_plan(pid))]}


@router.get("/search")
def search(pid: str, q: str, request: Request):
    needle = q.strip().lower()
    if not needle:
        return {"results": []}
    cues = tasks.load_cues(pm(request), pid)
    return {"results": [c.to_dict() for c in cues if needle in c.text.lower()][:200]}
