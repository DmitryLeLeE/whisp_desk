from __future__ import annotations

import json
from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..editing.chapters import generate_smart_chapters, format_chapters_text
from .deps import pm

router = APIRouter(prefix="/api/projects/{pid}/chapters", tags=["chapters"])


class ChapterItem(BaseModel):
    time_ms: int = 0
    source_ms: int | None = 0
    title: str = "Раздел"


class ChaptersBody(BaseModel):
    chapters: list[ChapterItem]


class GenerateBody(BaseModel):
    min_interval_s: int = 60
    lang: str = "ru"


@router.get("")
def get_chapters(pid: str, request: Request):
    m = pm(request)
    ch_path = m.dir(pid) / "exports" / "chapters.json"
    if ch_path.is_file():
        try:
            data = json.loads(ch_path.read_text(encoding="utf-8"))
            if "formatted" not in data and "chapters" in data:
                data["formatted"] = format_chapters_text(data["chapters"])
            return data
        except Exception:
            pass

    # Если ещё не сохранено, генерируем начальные главы
    plan = m.load_plan(pid) if m.get(pid).get("has_plan") else None
    cues = []
    cues_path = m.dir(pid) / "subtitles" / "cues.json"
    if cues_path.is_file():
        try:
            cues = json.loads(cues_path.read_text(encoding="utf-8"))
        except Exception:
            cues = []

    scenes = None
    scenes_path = m.dir(pid) / "analysis" / "scenes.json"
    if scenes_path.is_file():
        try:
            scenes = json.loads(scenes_path.read_text(encoding="utf-8")).get("boundaries_ms")
        except Exception:
            pass

    chapters = generate_smart_chapters(cues, plan, scenes=scenes)
    return {"chapters": chapters, "formatted": format_chapters_text(chapters)}


@router.post("/generate")
def generate_chapters_endpoint(pid: str, body: GenerateBody, request: Request):
    m = pm(request)
    plan = m.load_plan(pid) if m.get(pid).get("has_plan") else None
    cues = []
    cues_path = m.dir(pid) / "subtitles" / "cues.json"
    if cues_path.is_file():
        try:
            cues = json.loads(cues_path.read_text(encoding="utf-8"))
        except Exception:
            cues = []

    scenes = None
    scenes_path = m.dir(pid) / "analysis" / "scenes.json"
    if scenes_path.is_file():
        try:
            scenes = json.loads(scenes_path.read_text(encoding="utf-8")).get("boundaries_ms")
        except Exception:
            pass

    chapters = generate_smart_chapters(cues, plan, scenes=scenes, min_interval_s=body.min_interval_s, lang=body.lang)
    formatted = format_chapters_text(chapters)

    # Сохраняем и JSON, и TXT
    exports = m.dir(pid) / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    (exports / "chapters.json").write_text(json.dumps({"chapters": chapters}, ensure_ascii=False, indent=2), encoding="utf-8")
    (exports / "chapters.txt").write_text(formatted, encoding="utf-8")

    return {"chapters": chapters, "formatted": formatted}


@router.put("")
def update_chapters(pid: str, body: ChaptersBody, request: Request):
    m = pm(request)
    raw = [ch.model_dump() for ch in body.chapters]
    formatted = format_chapters_text(raw)

    exports = m.dir(pid) / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    (exports / "chapters.json").write_text(json.dumps({"chapters": raw}, ensure_ascii=False, indent=2), encoding="utf-8")
    (exports / "chapters.txt").write_text(formatted, encoding="utf-8")

    return {"chapters": raw, "formatted": formatted}
