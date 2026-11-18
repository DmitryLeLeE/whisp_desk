from __future__ import annotations

from typing import Any
from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..core.fsutil import read_json
from ..editing import patterns as P
from ..editing import timeline as T
from .deps import jobs, pm

router = APIRouter(prefix="/api/projects/{pid}/patterns", tags=["patterns"])


class ApplyPatternBody(BaseModel):
    pattern_id: str
    params: dict[str, Any] | None = None


def _payload(m, pid: str, plan: dict) -> dict:
    return {"plan": plan, "stats": T.stats(plan), **m.history_state(pid)}


@router.get("")
def list_patterns():
    """Возвращает каталог доступных паттернов авто-монтажа."""
    return {"patterns": P.PATTERNS_CATALOG}


@router.post("/apply")
def apply_pattern(pid: str, body: ApplyPatternBody, request: Request):
    """Применяет выбранный паттерн к монтажному плану проекта."""
    m = pm(request)
    busy = jobs(request).active_for(pid)
    if busy and busy["kind"] == "analyze":
        from ..core.job_queue import JobConflict
        raise JobConflict("Идёт анализ: монтажный план временно нельзя менять")

    # Читаем субтитры и сцены проекта, если они существуют
    subs_data = read_json(m.path(pid, "subtitles", "subtitles.json"))
    cues = subs_data.get("cues") if subs_data else None

    scenes_data = read_json(m.path(pid, "analysis", "scenes.json"))
    scenes = scenes_data.get("boundaries_ms") if scenes_data else None

    def run(plan: dict):
        return P.apply_pattern(
            body.pattern_id,
            plan,
            params=body.params,
            cues=cues,
            scenes=scenes,
        )

    plan, result = m.edit_plan(pid, f"pattern_{body.pattern_id}", run)
    return {**_payload(m, pid, plan), "pattern_result": result}
