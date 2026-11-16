from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..core.project_manager import PROJECT_TYPES
from .deps import jobs, pm

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: str = "lecture"
    description: str = ""


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = None
    settings: dict | None = None


class SourceBody(BaseModel):
    path: str


@router.get("/types")
def types():
    return PROJECT_TYPES


@router.get("")
def list_projects(request: Request):
    return pm(request).list()


@router.post("", status_code=201)
def create_project(body: ProjectCreate, request: Request):
    return pm(request).create(body.name, body.type, body.description)


@router.post("/rescan")
def rescan(request: Request):
    return {"added": pm(request).rescan()}


@router.get("/{pid}")
def get_project(pid: str, request: Request):
    p = pm(request).get(pid)
    p["active_job"] = jobs(request).active_for(pid)
    p["metadata"] = pm(request).metadata(pid)
    return p


@router.patch("/{pid}")
def update_project(pid: str, body: ProjectUpdate, request: Request):
    return pm(request).update(pid, name=body.name, description=body.description, settings=body.settings)


@router.delete("/{pid}", status_code=204)
def delete_project(pid: str, request: Request):
    if jobs(request).active_for(pid):
        from ..core.job_queue import JobConflict
        raise JobConflict("Нельзя удалить проект во время обработки")
    pm(request).delete(pid)


@router.put("/{pid}/source")
def set_source(pid: str, body: SourceBody, request: Request):
    """Добавляет или заново указывает путь к исходному файлу. Файл не копируется и не изменяется."""
    return pm(request).set_source(pid, body.path)


@router.get("/{pid}/history")
def history(pid: str, request: Request):
    return pm(request).history(pid)
