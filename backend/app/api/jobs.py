from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from .deps import jobs

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("")
def list_jobs(request: Request, project_id: str | None = None):
    return jobs(request).list(project_id)


@router.get("/{job_id}")
def get_job(job_id: int, request: Request):
    try:
        job = jobs(request).get(job_id)
    except KeyError:
        raise HTTPException(404, "Задача не найдена") from None
    job["log"] = jobs(request).log_tail(job_id)
    return job


@router.post("/{job_id}/cancel")
def cancel(job_id: int, request: Request):
    try:
        return jobs(request).cancel(job_id)
    except KeyError:
        raise HTTPException(404, "Задача не найдена") from None


@router.post("/{job_id}/retry", status_code=202)
def retry(job_id: int, request: Request):
    try:
        return jobs(request).retry(job_id)
    except KeyError:
        raise HTTPException(404, "Задача не найдена") from None
