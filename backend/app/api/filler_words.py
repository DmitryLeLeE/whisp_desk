from __future__ import annotations

import json
from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..editing.filler_words import scan_filler_words, clean_filler_words
from .deps import pm
from .timeline import _payload

router = APIRouter(prefix="/api/projects/{pid}/filler-words", tags=["filler-words"])


class CleanBody(BaseModel):
    ids: list[str] | None = None  # None = clean all matches


@router.get("")
def get_filler_words(pid: str, request: Request):
    m = pm(request)
    cues_path = m.dir(pid) / "subtitles" / "cues.json"
    cues = []
    if cues_path.is_file():
        try:
            cues = json.loads(cues_path.read_text(encoding="utf-8"))
        except Exception:
            cues = []

    matches = scan_filler_words(cues)
    saved_ms = sum(item["duration_ms"] for item in matches)
    return {
        "matches": matches,
        "count": len(matches),
        "saved_ms": saved_ms,
    }


@router.post("/clean")
def clean_filler_words_endpoint(pid: str, body: CleanBody, request: Request):
    m = pm(request)
    if not m.get(pid).get("has_plan"):
        return {"cleaned_count": 0, "plan": None, "message": "Монтажный план ещё не создан"}

    cues_path = m.dir(pid) / "subtitles" / "cues.json"
    cues = []
    if cues_path.is_file():
        try:
            cues = json.loads(cues_path.read_text(encoding="utf-8"))
        except Exception:
            cues = []

    matches = scan_filler_words(cues)
    if body.ids is not None:
        selected_ids = set(body.ids)
        matches = [m_item for m_item in matches if m_item["id"] in selected_ids]

    def op(plan: dict):
        return clean_filler_words(plan, matches)

    plan, cleaned_count = m.edit_plan(pid, "clean_filler_words", op)
    return {
        **_payload(m, pid, plan),
        "cleaned_count": cleaned_count,
    }
