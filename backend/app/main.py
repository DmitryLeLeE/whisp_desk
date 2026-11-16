"""Точка входа: локальный сервер на 127.0.0.1 и раздача собранного интерфейса."""
from __future__ import annotations

import argparse
import logging
import threading
import webbrowser
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import analysis, jobs as jobs_api, media, projects, render, subtitles, timeline
from .core import config, tasks
from .core.db import Database
from .core.job_queue import JobConflict, JobQueue
from .core.project_manager import NotFound, ProjectError, ProjectManager
from .editing.render import RenderError
from .editing.timeline import TimelineError

LOG = logging.getLogger("whisp_desk")


def create_app() -> FastAPI:
    config.ensure_dirs()
    db = Database(config.DB_PATH)
    pm = ProjectManager(config.PROJECTS_DIR, db)
    pm.rescan()
    queue = JobQueue(db, pm)
    tasks.register_all(queue, pm)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        queue.start()
        yield
        queue.stop()
        db.close()

    app = FastAPI(title="WHISP MEDIA DESK", version="0.2.0", lifespan=lifespan)
    app.state.pm, app.state.jobs = pm, queue
    # Защита от DNS rebinding: принимаем только обращения к localhost.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    def err(status: int):
        async def handler(_req: Request, exc: Exception):
            return JSONResponse({"detail": str(exc)}, status_code=status)
        return handler

    for exc_type, status in ((NotFound, 404), (ProjectError, 400), (TimelineError, 422), (FileExistsError, 409),
                             (JobConflict, 409), (RenderError, 500)):
        app.add_exception_handler(exc_type, err(status))

    for r in (projects.router, analysis.router, media.router, timeline.router, render.router, subtitles.router,
              jobs_api.router):
        app.include_router(r)

    if config.FRONTEND_DIST.is_dir():
        app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path == "api" or path.startswith("api/"):
                return JSONResponse({"detail": "Не найдено"}, status_code=404)
            f = (config.FRONTEND_DIST / path).resolve()
            if path and config.FRONTEND_DIST.resolve() in f.parents and f.is_file():
                return FileResponse(f)
            return FileResponse(config.FRONTEND_DIST / "index.html")
    return app


def _port_busy(port: int) -> bool:
    import socket
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex((config.HOST, port)) == 0


def cli() -> None:
    import uvicorn

    ap = argparse.ArgumentParser(description="WHISP MEDIA DESK")
    ap.add_argument("--port", type=int, default=config.DEFAULT_PORT)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    config.ensure_dirs()
    logging.basicConfig(level=logging.INFO, handlers=[
        logging.StreamHandler(), logging.FileHandler(config.LOGS_DIR / "desk.log", encoding="utf-8")])
    if _port_busy(args.port):
        print(f"Порт {args.port} занят. Возможно, WHISP MEDIA DESK уже запущен: http://{config.HOST}:{args.port}/")
        if not args.no_browser:
            webbrowser.open(f"http://{config.HOST}:{args.port}/")
        return
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://{config.HOST}:{args.port}/")).start()
    uvicorn.run(create_app(), host=config.HOST, port=args.port, log_level="info", log_config=None)


if __name__ == "__main__":
    cli()
