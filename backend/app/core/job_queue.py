"""Последовательная очередь фоновых задач с отменой, прогрессом и сохранением статуса в SQLite."""
from __future__ import annotations

import json
import queue
import threading
import time
import traceback
from collections import deque
from typing import Callable

from .db import Database
from .proc import CancelToken, Cancelled
from .project_manager import ProjectManager, now

STATUSES = ("QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED")
ACTIVE = ("QUEUED", "RUNNING")
LOG_LINES = 300


class JobConflict(Exception):
    pass


class JobContext:
    def __init__(self, queue_: "JobQueue", job_id: int, project_id: str, token: CancelToken):
        self._q, self.job_id, self.project_id, self.token = queue_, job_id, project_id, token

    def progress(self, fraction: float, stage: str | None = None, message: str | None = None) -> None:
        self._q._update(self.job_id, progress=max(0.0, min(1.0, fraction)),
                        **({"stage": stage} if stage is not None else {}),
                        **({"message": message} if message is not None else {}))

    def stage(self, stage: str, message: str = "") -> None:
        self._q._update(self.job_id, stage=stage, message=message or stage)
        self.log(stage)

    def log(self, line: str) -> None:
        self._q._log(self.job_id, self.project_id, line)

    def check(self) -> None:
        self.token.check()


Handler = Callable[[JobContext, dict], dict | None]


class JobQueue:
    def __init__(self, db: Database, projects: ProjectManager):
        self.db, self.projects = db, projects
        self._handlers: dict[str, Handler] = {}
        self._q: "queue.Queue[int | None]" = queue.Queue()
        self._tokens: dict[int, CancelToken] = {}
        self._logs: dict[int, deque] = {}
        self._lock = threading.RLock()
        self._worker: threading.Thread | None = None
        # Задачи, оборванные закрытием приложения, не могут продолжиться.
        self.db.execute("UPDATE jobs SET status='FAILED', error='Прервано: приложение было закрыто', finished=? "
                        "WHERE status IN ('QUEUED','RUNNING')", (now(),))

    def register(self, kind: str, handler: Handler) -> None:
        self._handlers[kind] = handler

    def start(self) -> None:
        if self._worker and self._worker.is_alive():
            return
        self._worker = threading.Thread(target=self._run, name="job-worker", daemon=True)
        self._worker.start()

    def stop(self) -> None:
        for tok in list(self._tokens.values()):
            tok.cancel()
        self._q.put(None)

    # ----- постановка -----
    def submit(self, project_id: str, kind: str, params: dict | None = None) -> dict:
        if kind not in self._handlers:
            raise ValueError(f"Неизвестный тип задачи: {kind}")
        self.projects.dir(project_id)
        with self._lock:
            busy = self.db.query("SELECT id, kind FROM jobs WHERE project_id=? AND status IN ('QUEUED','RUNNING')",
                                 (project_id,))
            if busy:
                raise JobConflict(f"Проект уже обрабатывается (задача #{busy[0]['id']}: {busy[0]['kind']})")
            cur = self.db.execute(
                "INSERT INTO jobs(project_id, kind, status, params, created) VALUES (?,?,?,?,?)",
                (project_id, kind, "QUEUED", json.dumps(params or {}, ensure_ascii=False), now()))
            job_id = cur.lastrowid
            self._tokens[job_id] = CancelToken()
            self._logs[job_id] = deque(maxlen=LOG_LINES)
        self._q.put(job_id)
        return self.get(job_id)

    def retry(self, job_id: int) -> dict:
        job = self.get(job_id)
        if job["status"] not in ("FAILED", "CANCELLED"):
            raise JobConflict("Повторить можно только неудачную или отменённую задачу")
        return self.submit(job["project_id"], job["kind"], job["params"])

    def cancel(self, job_id: int) -> dict:
        job = self.get(job_id)
        if job["status"] not in ACTIVE:
            return job
        tok = self._tokens.get(job_id)
        if tok:
            tok.cancel()
        if job["status"] == "QUEUED":
            self._update(job_id, status="CANCELLED", finished=now(), message="Отменено")
        return self.get(job_id)

    # ----- чтение -----
    def get(self, job_id: int) -> dict:
        rows = self.db.query("SELECT * FROM jobs WHERE id=?", (job_id,))
        if not rows:
            raise KeyError(job_id)
        return self._decode(rows[0])

    def list(self, project_id: str | None = None, limit: int = 50) -> list[dict]:
        if project_id:
            rows = self.db.query("SELECT * FROM jobs WHERE project_id=? ORDER BY id DESC LIMIT ?", (project_id, limit))
        else:
            rows = self.db.query("SELECT * FROM jobs ORDER BY id DESC LIMIT ?", (limit,))
        return [self._decode(r) for r in rows]

    def active_for(self, project_id: str) -> dict | None:
        rows = self.db.query("SELECT * FROM jobs WHERE project_id=? AND status IN ('QUEUED','RUNNING') LIMIT 1",
                             (project_id,))
        return self._decode(rows[0]) if rows else None

    def log_tail(self, job_id: int) -> list[str]:
        return list(self._logs.get(job_id, []))

    def _decode(self, row: dict) -> dict:
        row["params"] = json.loads(row["params"] or "{}")
        row["result"] = json.loads(row["result"]) if row.get("result") else None
        started = row.get("started")
        if started:
            from datetime import datetime
            end = row.get("finished") or now()
            try:
                row["elapsed_s"] = round((datetime.fromisoformat(end) - datetime.fromisoformat(started)).total_seconds())
            except ValueError:
                row["elapsed_s"] = None
        return row

    # ----- внутреннее -----
    def _update(self, job_id: int, **fields) -> None:
        cols = ", ".join(f"{k}=?" for k in fields)
        self.db.execute(f"UPDATE jobs SET {cols} WHERE id=?", (*fields.values(), job_id))

    def _log(self, job_id: int, project_id: str, line: str) -> None:
        self._logs.setdefault(job_id, deque(maxlen=LOG_LINES)).append(f"{time.strftime('%H:%M:%S')} {line}")
        self.projects.append_log(project_id, f"[job {job_id}] {line}")

    def _run(self) -> None:
        while True:
            job_id = self._q.get()
            if job_id is None:
                return
            job = self.get(job_id)
            if job["status"] != "QUEUED":
                continue
            token = self._tokens[job_id]
            ctx = JobContext(self, job_id, job["project_id"], token)
            self._update(job_id, status="RUNNING", started=now(), stage="Запуск")
            try:
                result = self._handlers[job["kind"]](ctx, job["params"]) or {}
                token.check()
                self._update(job_id, status="COMPLETED", progress=1.0, finished=now(), stage="Готово",
                             result=json.dumps(result, ensure_ascii=False))
                ctx.log("Завершено")
            except Cancelled:
                self._update(job_id, status="CANCELLED", finished=now(), message="Отменено пользователем")
                ctx.log("Отменено")
            except Exception as exc:  # noqa: BLE001 — любая ошибка задачи должна попасть в статус
                ctx.log(f"Ошибка: {exc}")
                ctx.log(traceback.format_exc(limit=3))
                self._update(job_id, status="FAILED", finished=now(), error=str(exc))
            finally:
                self._tokens.pop(job_id, None)
