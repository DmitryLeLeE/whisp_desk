from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..analysis.edit_planner import PROFILES
from ..core.project_manager import ProjectError
from .deps import jobs, pm

router = APIRouter(prefix="/api", tags=["analysis"])


class AnalyzeBody(BaseModel):
    profile: str | None = None
    overrides: dict | None = None
    audio_stream: int | None = None
    detect_scenes: bool | None = None
    scene_threshold: float | None = None
    replace_plan: bool = False
    auto_threshold: bool = False


@router.get("/profiles")
def profiles():
    return PROFILES


@router.post("/projects/{pid}/analyze", status_code=202)
def analyze(pid: str, body: AnalyzeBody, request: Request):
    m = pm(request)
    m.source_path(pid)  # проверяем доступность файла до постановки в очередь
    if m.get(pid)["has_plan"] and not body.replace_plan:
        raise FileExistsError("Монтажный план уже создан. Подтвердите пересоздание (прежний план сохранится как версия).")
    params = {k: v for k, v in body.model_dump().items() if v is not None and k != "replace_plan"}
    if body.profile and body.profile not in PROFILES:
        raise ProjectError(f"Неизвестный профиль: {body.profile}")
    return jobs(request).submit(pid, "analyze", params)


@router.get("/projects/{pid}/analysis/threshold")
def suggested_threshold(pid: str, request: Request):
    """Рекомендованный порог по уже посчитанной аудиоволне."""
    from ..analysis.threshold import suggest_threshold
    from ..core.fsutil import read_json
    wave = read_json(pm(request).path(pid, "analysis", "waveform.json"))
    if not wave:
        raise ProjectError("Аудиоволна ещё не посчитана: запустите анализ или включите автоподбор порога")
    return suggest_threshold(wave["peaks"])
