from __future__ import annotations

from fastapi import Request

from ..core.job_queue import JobQueue
from ..core.project_manager import ProjectManager


def pm(request: Request) -> ProjectManager:
    return request.app.state.pm


def jobs(request: Request) -> JobQueue:
    return request.app.state.jobs
