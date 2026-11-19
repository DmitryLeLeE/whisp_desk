from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..editing import timeline as T
from .deps import jobs, pm

router = APIRouter(prefix="/api/projects/{pid}/timeline", tags=["timeline"])


class Op(BaseModel):
    op: Literal["set_action", "set_range", "move_boundary", "split", "merge", "lock", "review", "add_marker", "delete_marker", "reorder"]
    id: str | None = None
    second_id: str | None = None
    action: Literal["KEEP", "CUT"] | None = None
    reason: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    at_ms: int | None = None
    locked: bool | None = None
    ids: list[str] | None = None
    reviewed: bool = True
    time_ms: int | None = None
    label: str | None = None
    color: str | None = None
    marker_id: str | None = None
    sequence: list[str] | None = None


class VersionBody(BaseModel):
    label: str = ""


def _need(**vals):
    missing = [k for k, v in vals.items() if v is None]
    if missing:
        raise T.TimelineError("Не указано: " + ", ".join(missing))


def _payload(m, pid: str, plan: dict) -> dict:
    return {"plan": plan, "stats": T.stats(plan), **m.history_state(pid)}


@router.get("")
def get_plan(pid: str, request: Request):
    m = pm(request)
    return _payload(m, pid, m.load_plan(pid))


@router.post("/ops")
def apply_op(pid: str, body: Op, request: Request):
    m = pm(request)
    busy = jobs(request).active_for(pid)
    if busy and busy["kind"] == "analyze":
        from ..core.job_queue import JobConflict
        raise JobConflict("Идёт анализ: монтажный план временно нельзя менять")

    def run(plan: dict):
        o = body
        if o.op == "set_action":
            _need(id=o.id, action=o.action)
            T.set_action(plan, o.id, o.action, o.reason)
        elif o.op == "set_range":
            _need(start_ms=o.start_ms, end_ms=o.end_ms, action=o.action)
            T.set_range_action(plan, o.start_ms, o.end_ms, o.action, o.reason)
        elif o.op == "move_boundary":
            _need(id=o.id, at_ms=o.at_ms)
            T.move_boundary(plan, o.id, o.at_ms)
        elif o.op == "split":
            _need(id=o.id, at_ms=o.at_ms)
            return T.split(plan, o.id, o.at_ms)
        elif o.op == "merge":
            _need(id=o.id, second_id=o.second_id)
            return T.merge(plan, o.id, o.second_id, o.action)
        elif o.op == "lock":
            _need(id=o.id, locked=o.locked)
            T.set_locked(plan, o.id, o.locked)
        elif o.op == "review":
            T.set_reviewed(plan, o.ids, o.reviewed)
        elif o.op == "add_marker":
            _need(time_ms=o.time_ms)
            return T.add_marker(plan, o.time_ms, o.label or "", o.color or "cyan")
        elif o.op == "delete_marker":
            _need(marker_id=o.marker_id)
            T.delete_marker(plan, o.marker_id)
        elif o.op == "reorder":
            _need(sequence=o.sequence)
            return T.reorder_sequence(plan, o.sequence)

    plan, result = m.edit_plan(pid, body.op, run)
    return {**_payload(m, pid, plan), "result": result}


@router.post("/undo")
def undo(pid: str, request: Request):
    m = pm(request)
    return _payload(m, pid, m.undo(pid))


@router.post("/redo")
def redo(pid: str, request: Request):
    m = pm(request)
    return _payload(m, pid, m.redo(pid))


@router.get("/versions")
def versions(pid: str, request: Request):
    return pm(request).list_versions(pid)


@router.post("/versions", status_code=201)
def save_version(pid: str, body: VersionBody, request: Request):
    return {"name": pm(request).save_version(pid, body.label)}


@router.post("/versions/{name}/restore")
def restore_version(pid: str, name: str, request: Request):
    m = pm(request)
    return _payload(m, pid, m.restore_version(pid, name))
