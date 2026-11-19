from __future__ import annotations

from pathlib import Path
import re
from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..core.config import require_tool
from ..core.project_manager import PROJECT_TYPES
from ..editing.analytics import calculate_insights
from ..editing import timeline as T
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


class BatchProjectCreate(BaseModel):
    paths: list[str]
    type: str = "lecture"
    auto_analyze: bool = False
    profile: str = "standard"


@router.get("/types")
def types():
    return PROJECT_TYPES


@router.get("")
def list_projects(request: Request):
    return pm(request).list()


@router.get("/summary")
def summary(request: Request):
    """Список проектов с признаками готовности шагов: для карточек на главной странице."""
    m = pm(request)
    out = []
    for row in m.list():
        pid = row["id"]
        try:
            p = m.get(pid)
            meta = m.metadata(pid) or {}
            stats = None
            if p["has_plan"]:
                stats = T.stats(m.load_plan(pid))
            thumbs = m.path(pid, "analysis", "thumbnails")
            first = next(iter(sorted(thumbs.glob("*.jpg"))), None) if thumbs.is_dir() else None
            exports = m.path(pid, "exports")
            done = any(f.suffix == ".mp4" and ".part" not in f.name for f in exports.glob("*.mp4")) if exports.is_dir() else False
            out.append({**row, "filename": (p["source"] or {}).get("filename"), "duration_ms": meta.get("duration_ms"),
                        "has_source": p["source"] is not None, "has_plan": p["has_plan"], "has_subtitles": p["has_subtitles"],
                        "unreviewed": stats["unreviewed"] if stats else None, "output_ms": stats["output_ms"] if stats else None,
                        "removed_ms": stats["removed_ms"] if stats else None, "rendered": done,
                        "thumb": f"/api/projects/{pid}/thumbnails/{first.name}" if first else None})
        except Exception:  # noqa: BLE001  повреждённый проект не должен ломать весь список
            out.append({**row, "broken": True})
    return out


@router.post("", status_code=201)
def create_project(body: ProjectCreate, request: Request):
    return pm(request).create(body.name, body.type, body.description)


@router.post("/batch", status_code=201)
def create_batch(body: BatchProjectCreate, request: Request):
    """Массовое создание проектов из списка файлов с возможностью сразу запустить анализ."""
    from pathlib import Path
    m = pm(request)
    j_queue = jobs(request)
    created = []
    for path_str in body.paths:
        p_path = Path(path_str)
        if not p_path.is_file():
            continue
        name = p_path.stem or "Новый проект"
        p = m.create(name, body.type)
        m.set_source(p["id"], str(p_path.resolve()))
        job_id = None
        if body.auto_analyze:
            job = j_queue.submit(p["id"], "analyze", {"profile": body.profile})
            job_id = job["id"]
        created.append({"id": p["id"], "name": name, "path": str(p_path), "job_id": job_id})
    return {"created": created, "count": len(created)}


DEMO_SRT = (
    "1\n00:00:00,400 --> 00:00:03,000\nЗдравствуйте! Это демонстрационный проект.\n\n"
    "2\n00:00:07,200 --> 00:00:10,800\nЗелёное на таймлайне остаётся, красное вырезается.\n\n"
    "3\n00:00:13,200 --> 00:00:16,800\nСубтитры уже готовы: попробуйте экспорт.\n"
)


@router.post("/demo", status_code=201)
def create_demo(request: Request):
    """Учебный проект: короткий тестовый ролик с паузами и готовые субтитры. Нужен, чтобы попробовать программу без своих файлов."""
    import subprocess
    from ..core import tasks
    from ..editing import subtitles as subs
    m = pm(request)
    p = m.create("Демо: попробуйте программу", "lecture", "Тестовый ролик с паузами. Можно безопасно удалить.")
    pid = p["id"]
    src = m.dir(pid) / "demo.mp4"
    try:
        subprocess.run([
            require_tool("ffmpeg"), "-y", "-v", "error",
            "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=20",
            "-f", "lavfi", "-i", "sine=f=440:r=48000:d=20,volume='if(between(t,3,7)+between(t,12,13)+between(t,17,20),0.0,0.5)':eval=frame",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(src),
        ], check=True, timeout=120, capture_output=True)
        m.set_source(pid, str(src))
        srt = m.dir(pid) / "demo.srt"
        srt.write_text(DEMO_SRT, encoding="utf-8")
        tasks.save_cues(m, pid, subs.load_subtitles(srt), "demo.srt", DEMO_SRT.encode("utf-8"))
        srt.unlink(missing_ok=True)
        jobs(request).submit(pid, "analyze", {"profile": "standard"})
    except Exception as exc:  # noqa: BLE001
        m.delete(pid)
        raise HTTPException(500, f"Не удалось создать демо-проект: {exc}") from exc
    return m.get(pid)


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


class DuplicateBody(BaseModel):
    name: str | None = None


@router.post("/{pid}/duplicate", status_code=201)
def duplicate_project(pid: str, request: Request, body: DuplicateBody | None = None):
    new_name = body.name if body else None
    return pm(request).duplicate(pid, new_name)


@router.get("/{pid}/bundle")
def export_bundle(pid: str, request: Request):
    m = pm(request)
    bundle_path = m.export_bundle(pid)
    project = m.get(pid)
    safe_name = re.sub(r'[\\/*?:"<>|]', "_", project.get("name", pid))
    return FileResponse(
        bundle_path,
        filename=f"{safe_name}.whisp",
        media_type="application/zip",
    )


@router.post("/import-bundle", status_code=201)
async def import_bundle(file: UploadFile, request: Request):
    import tempfile
    m = pm(request)
    suffix = Path(file.filename or "project.whisp").suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        p = m.import_bundle(tmp_path)
        return p
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/upload", status_code=201)
async def upload_video(file: UploadFile, request: Request):
    """Принимает видеофайл через браузер, сохраняет в projects/_uploads/ и создаёт проект."""
    import shutil
    m = pm(request)
    name = Path(file.filename or "video.mp4").stem
    uploads_dir = Path(request.app.state.config.projects_dir) / "_uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    dest_path = uploads_dir / (file.filename or "video.mp4")

    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    p = m.create(name=name, ptype="lecture")
    m.set_source(p["id"], str(dest_path))
    return p


@router.put("/{pid}/source")
def set_source(pid: str, body: SourceBody, request: Request):
    """Добавляет или заново указывает путь к исходному файлу. Файл не копируется и не изменяется."""
    return pm(request).set_source(pid, body.path)


@router.get("/{pid}/history")
def history(pid: str, request: Request):
    return pm(request).history(pid)


@router.post("/{pid}/reveal")
def reveal_in_explorer(pid: str, request: Request, folder: str = "exports"):
    """Открывает папку проекта или экспорта в проводнике Windows / Mac / Linux."""
    import os
    import subprocess
    import sys
    m = pm(request)
    base_dir = m.dir(pid).resolve()
    # Защита от Path Traversal: разрешаем только подпапки первого уровня внутри проекта
    safe_folder = Path(folder).name if folder else ""
    target = (base_dir / safe_folder).resolve() if safe_folder else base_dir
    if not (target == base_dir or base_dir in target.parents):
        target = base_dir
    target.mkdir(parents=True, exist_ok=True)
    try:
        if sys.platform == "win32":
            os.startfile(str(target))
        elif sys.platform == "darwin":
            subprocess.run(["open", str(target)], check=False)
        else:
            subprocess.run(["xdg-open", str(target)], check=False)
    except Exception as e:
        return {"ok": False, "path": str(target), "error": str(e)}
    return {"ok": True, "path": str(target)}


class OpenFileBody(BaseModel):
    name: str


@router.post("/{pid}/open-file")
def open_export_file(pid: str, body: OpenFileBody, request: Request):
    """Открывает готовый файл из папки exports программой по умолчанию (плеер, редактор)."""
    import os
    import subprocess
    import sys
    base = pm(request).path(pid, "exports").resolve()
    target = (base / Path(body.name).name).resolve()
    if base not in target.parents or not target.is_file():
        raise HTTPException(404, "Файл не найден")
    try:
        if sys.platform == "win32":
            os.startfile(str(target))  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.run(["open", str(target)], check=False)
        else:
            subprocess.run(["xdg-open", str(target)], check=False)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "path": str(target), "error": str(exc)}
    return {"ok": True, "path": str(target)}


@router.get("/{pid}/frame")
def capture_frame(pid: str, request: Request, time_ms: int = 0, download: bool = False):
    """Захватывает один стоп-кадр видео в высоком качестве по заданному таймкоду."""
    import subprocess
    m = pm(request)
    src = m.source_path(pid)
    if not src or not src.is_file():
        raise HTTPException(404, "Исходный файл не найден")
    time_s = max(0, time_ms) / 1000
    try:
        ffmpeg = require_tool("ffmpeg")
        cmd = [ffmpeg, "-ss", f"{time_s:.3f}", "-i", str(src), "-frames:v", "1", "-q:v", "2", "-f", "image2", "-"]
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        headers = {}
        if download:
            p = m.get(pid)
            name = (p.get("name") or "frame").replace(" ", "_")
            headers["Content-Disposition"] = f'attachment; filename="{name}_{time_ms}ms.jpg"'
        return Response(content=proc.stdout, media_type="image/jpeg", headers=headers)
    except Exception as e:
        raise HTTPException(500, f"Ошибка захвата кадра: {e}")


@router.get("/{pid}/insights")
def get_insights(pid: str, request: Request, lang: str = "ru"):
    """Возвращает метрики речи, темпа, количества слов и эффективности монтажа."""
    import json
    m = pm(request)
    plan = m.load_plan(pid) if m.get(pid).get("has_plan") else None
    meta = m.metadata(pid)
    cues = []
    cues_path = m.dir(pid) / "subtitles" / "cues.json"
    if cues_path.is_file():
        try:
            cues = json.loads(cues_path.read_text(encoding="utf-8"))
        except Exception:
            cues = []
    return calculate_insights(plan, cues=cues, meta=meta, lang=lang)


@router.get("/{pid}/show-notes")
def get_show_notes(pid: str, request: Request):
    """Генерирует описание ролика, шоу-ноуты, таймкоды и готовые посты для YouTube и Telegram."""
    import json
    m = pm(request)
    p = m.get(pid)
    meta = m.metadata(pid) or {}
    cues = []
    cues_path = m.dir(pid) / "subtitles" / "cues.json"
    if cues_path.is_file():
        try:
            data = json.loads(cues_path.read_text(encoding="utf-8"))
            cues = data.get("cues", []) if isinstance(data, dict) else data
        except Exception:
            cues = []
    chapters = []
    ch_path = m.dir(pid) / "exports" / "chapters.json"
    if ch_path.is_file():
        try:
            chapters = json.loads(ch_path.read_text(encoding="utf-8")).get("chapters", [])
        except Exception:
            chapters = []
    from ..analysis.show_notes import generate_show_notes
    return generate_show_notes(
        project_name=p.get("name", "Проект"),
        cues=cues,
        chapters=chapters,
        duration_ms=meta.get("duration_ms", 0),
    )



