from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ..core import fsutil, tasks
from ..editing import subtitles as subs
from ..integrations import whisp
from .deps import jobs, pm

router = APIRouter(prefix="/api/projects/{pid}/subtitles", tags=["subtitles"])
MAX_UPLOAD = 20 * 2**20


class TranscribeBody(BaseModel):
    model: str = "small"
    language: str = "auto"
    overwrite: bool = False
    device: str = "auto"
    task: str = "transcribe"
    translate_to: str = ""
    vad: bool = True
    max_line_chars: int = 0
    max_lines: int = 2
    max_duration: float = 0.0


class TranslateOnlyBody(BaseModel):
    target_lang: str = "en"
    source_lang: str = "auto"
    device: str = "auto"


class CueItem(BaseModel):
    start_ms: int
    end_ms: int
    text: str


class UpdateCuesBody(BaseModel):
    cues: list[CueItem]
    lang: str = "original"


@router.get("")
def get_cues(pid: str, request: Request):
    m = pm(request)
    cues = tasks.load_cues(m, pid)
    translations: dict[str, list[dict]] = {}
    sub_dir = m.dir(pid) / "subtitles"
    if sub_dir.is_dir():
        for f in sorted(sub_dir.glob("translated.*.srt")):
            lang = f.stem.split(".", 1)[1]
            try:
                translations[lang] = [c.to_dict() for c in subs.load_subtitles(f)]
            except Exception:
                pass
    return {
        "cues": [c.to_dict() for c in cues],
        "translations": translations,
    }


@router.put("")
def update_cues(pid: str, body: UpdateCuesBody, request: Request):
    m = pm(request)
    cues_objs = [subs.Cue(c.start_ms, c.end_ms, c.text) for c in body.cues]
    if body.lang == "original" or not body.lang:
        tasks.save_cues(m, pid, cues_objs, "manual_edit")
    else:
        sub_dir = m.dir(pid) / "subtitles"
        sub_dir.mkdir(exist_ok=True)
        dst = sub_dir / f"translated.{body.lang}.srt"
        fsutil.write_text_atomic(dst, subs.render_srt(cues_objs))
        m.log_history(pid, "subtitles:edit_translation", f"{body.lang}: {len(cues_objs)}")
    return {"ok": True, "count": len(cues_objs), "lang": body.lang}


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
    if body.model not in {m["name"] for m in whisp.MODELS}:
        raise HTTPException(422, "Неизвестная модель")
    if body.device not in ("auto", "cpu", "cuda") or body.task not in ("transcribe", "translate"):
        raise HTTPException(422, "Некорректные параметры расшифровки")
    if body.translate_to and body.task == "translate":
        raise HTTPException(422, "Выберите либо перевод Whisper на английский, либо машинный перевод")
    return jobs(request).submit(pid, "transcribe", body.model_dump())


@router.post("/translate", status_code=202)
def translate(pid: str, body: TranslateOnlyBody, request: Request):
    """Отдельный быстрый перевод уже имеющихся субтитров."""
    cues = tasks.load_cues(pm(request), pid)
    if not cues:
        raise HTTPException(400, "Сначала распознайте или загрузите субтитры")
    return jobs(request).submit(pid, "translate_subtitles", body.model_dump())


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
