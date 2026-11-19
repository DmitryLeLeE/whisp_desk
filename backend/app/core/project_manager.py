"""Проекты на диске: project.json, ссылки на исходники, анализ, монтажный план, версии, undo/redo."""
from __future__ import annotations

import copy
import re
import shutil
import threading
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from ..editing import timeline as T
from .db import Database
from .fsutil import read_json, write_json_atomic

PROJECT_TYPES = {"lecture": "Лекция", "interview": "Интервью", "webinar": "Вебинар", "custom": "Произвольное видео"}
UNDO_LIMIT = 50
DEFAULT_SETTINGS = {"profile": "standard", "overrides": {}, "audio_stream": 0, "template": "default",
                    "scene_threshold": 27.0, "detect_scenes": True, "engine": "builtin"}
_ID = re.compile(r"^[a-z]+_\d{3,}$")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ProjectError(Exception):
    pass


class NotFound(ProjectError):
    pass


class ProjectManager:
    def __init__(self, projects_dir: Path, db: Database):
        self.root = projects_dir
        self.db = db
        self.root.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, threading.RLock] = defaultdict(threading.RLock)
        self._create_lock = threading.Lock()

    # ----- пути -----
    def dir(self, pid: str) -> Path:
        if not _ID.match(pid):
            raise NotFound(f"Некорректный идентификатор проекта: {pid}")
        d = self.root / pid
        if not (d / "project.json").is_file():
            raise NotFound(f"Проект не найден: {pid}")
        return d

    def path(self, pid: str, *parts: str) -> Path:
        return self.dir(pid).joinpath(*parts)

    def lock(self, pid: str) -> threading.RLock:
        return self._locks[pid]

    # ----- проекты -----
    def create(self, name: str, ptype: str = "lecture", description: str = "") -> dict:
        if ptype not in PROJECT_TYPES:
            raise ProjectError(f"Неизвестный тип проекта: {ptype}")
        name = name.strip()
        if not name:
            raise ProjectError("Название проекта не может быть пустым")
        with self._create_lock:
            n = 1
            while (self.root / f"{ptype}_{n:03d}").exists():
                n += 1
            pid = f"{ptype}_{n:03d}"
            d = self.root / pid
            for sub in ("source", "analysis/thumbnails", "timeline/versions", "subtitles", "exports", "logs"):
                (d / sub).mkdir(parents=True, exist_ok=True)
            ts = now()
            project = {"id": pid, "name": name, "description": description, "type": ptype,
                       "created": ts, "updated": ts, "settings": copy.deepcopy(DEFAULT_SETTINGS)}
            write_json_atomic(d / "project.json", project)
            self.db.execute("INSERT INTO projects VALUES (?,?,?,?,?)", (pid, name, ptype, ts, ts))
        self.log_history(pid, "create", name)
        return project

    def get(self, pid: str) -> dict:
        project = read_json(self.dir(pid) / "project.json")
        project["settings"] = {**DEFAULT_SETTINGS, **project.get("settings", {})}
        project["source"] = read_json(self.dir(pid) / "source" / "media_reference.json")
        project["has_plan"] = (self.dir(pid) / "timeline" / "edit_plan.json").is_file()
        project["has_proxy"] = (self.dir(pid) / "analysis" / "proxy.mp4").is_file()
        project["has_subtitles"] = (self.dir(pid) / "subtitles" / "cues.json").is_file()
        return project

    def list(self) -> list[dict]:
        rows = self.db.query("SELECT * FROM projects ORDER BY updated DESC")
        return [r for r in rows if (self.root / r["id"] / "project.json").is_file()]

    def rescan(self) -> int:
        """Добавляет в индекс проекты, найденные на диске (например, скопированные вручную)."""
        known = {r["id"] for r in self.db.query("SELECT id FROM projects")}
        added = 0
        for d in sorted(self.root.iterdir()) if self.root.exists() else []:
            p = read_json(d / "project.json") if d.is_dir() else None
            if p and p["id"] not in known:
                self.db.execute("INSERT INTO projects VALUES (?,?,?,?,?)",
                                (p["id"], p["name"], p["type"], p["created"], p["updated"]))
                added += 1
        return added

    def update(self, pid: str, *, name: str | None = None, description: str | None = None,
               settings: dict | None = None) -> dict:
        with self.lock(pid):
            p = read_json(self.dir(pid) / "project.json")
            if name is not None:
                if not name.strip():
                    raise ProjectError("Название проекта не может быть пустым")
                p["name"] = name.strip()
            if description is not None:
                p["description"] = description
            if settings:
                p["settings"] = {**DEFAULT_SETTINGS, **p.get("settings", {}), **settings}
            p["updated"] = now()
            write_json_atomic(self.dir(pid) / "project.json", p)
            self.db.execute("UPDATE projects SET name=?, updated=? WHERE id=?", (p["name"], p["updated"], pid))
        changed = [k for k, v in (("name", name), ("description", description), ("settings", settings)) if v]
        self.log_history(pid, "update", ", ".join(changed))
        return self.get(pid)

    def touch(self, pid: str) -> None:
        self.db.execute("UPDATE projects SET updated=? WHERE id=?", (now(), pid))

    def delete(self, pid: str) -> None:
        """Удаляет только каталог проекта (исходный файл — вне него и не затрагивается)."""
        d = self.dir(pid)
        shutil.rmtree(d)
        self.db.execute("DELETE FROM projects WHERE id=?", (pid,))
        self.db.execute("DELETE FROM history WHERE project_id=?", (pid,))
        self.db.execute("DELETE FROM jobs WHERE project_id=?", (pid,))

    def duplicate(self, pid: str, new_name: str | None = None) -> dict:
        """Создает полную копию проекта с новым идентификатором."""
        src_dir = self.dir(pid)
        orig = read_json(src_dir / "project.json")
        ptype = orig.get("type", "lecture")
        with self._create_lock:
            n = 1
            while (self.root / f"{ptype}_{n:03d}").exists():
                n += 1
            new_pid = f"{ptype}_{n:03d}"
            dst_dir = self.root / new_pid
            shutil.copytree(src_dir, dst_dir)
            ts = now()
            copy_name = new_name.strip() if new_name and new_name.strip() else f"{orig['name']} (Копия)"
            p = {**orig, "id": new_pid, "name": copy_name, "created": ts, "updated": ts}
            write_json_atomic(dst_dir / "project.json", p)
            plan_file = dst_dir / "timeline" / "edit_plan.json"
            if plan_file.is_file():
                try:
                    plan = read_json(plan_file)
                    plan["project_id"] = new_pid
                    write_json_atomic(plan_file, plan)
                except Exception:
                    pass
            self.db.execute("INSERT INTO projects VALUES (?,?,?,?,?)", (new_pid, copy_name, ptype, ts, ts))
        self.log_history(new_pid, "duplicate", f"Копия проекта {pid}")
        return self.get(new_pid)

    # ----- история и журнал -----
    def log_history(self, pid: str, action: str, detail: str = "") -> None:
        self.db.execute("INSERT INTO history(project_id, ts, action, detail) VALUES (?,?,?,?)",
                        (pid, now(), action, detail))

    def history(self, pid: str, limit: int = 200) -> list[dict]:
        self.dir(pid)
        return self.db.query("SELECT ts, action, detail FROM history WHERE project_id=? ORDER BY id DESC LIMIT ?",
                             (pid, limit))

    def append_log(self, pid: str, line: str) -> None:
        try:
            with open(self.path(pid, "logs", "processing.log"), "a", encoding="utf-8") as f:
                f.write(f"{now()} {line}\n")
        except (OSError, ProjectError):
            pass

    # ----- исходный файл -----
    def set_source(self, pid: str, path: str) -> dict:
        p = Path(path).expanduser()
        if not p.is_absolute():
            raise ProjectError("Укажите полный путь к файлу")
        if not p.is_file():
            raise ProjectError(f"Файл не найден: {p}")
        ref = {"path": str(p.resolve()), "filename": p.name, "size_bytes": p.stat().st_size,
               "mtime": p.stat().st_mtime, "linked_at": now()}
        with self.lock(pid):
            old = read_json(self.dir(pid) / "source" / "media_reference.json")
            if old and (old["filename"] != ref["filename"] or old["size_bytes"] != ref["size_bytes"]):
                if (self.dir(pid) / "timeline" / "edit_plan.json").is_file():
                    raise ProjectError("Это другой файл: размер или имя не совпадают с исходником проекта. "
                                       "Создайте новый проект для другого видео.")
            write_json_atomic(self.dir(pid) / "source" / "media_reference.json", ref)
        self.log_history(pid, "source", ref["path"])
        return ref

    def source_path(self, pid: str) -> Path:
        ref = read_json(self.dir(pid) / "source" / "media_reference.json")
        if not ref:
            raise ProjectError("К проекту не добавлен исходный файл")
        p = Path(ref["path"])
        if not p.is_file():
            raise ProjectError(f"Исходный файл недоступен: {p}. Укажите новый путь (если файл перемещён).")
        return p

    def metadata(self, pid: str) -> dict | None:
        return read_json(self.dir(pid) / "analysis" / "metadata.json")

    # ----- монтажный план, undo/redo, версии -----
    def _plan_path(self, pid: str) -> Path:
        return self.dir(pid) / "timeline" / "edit_plan.json"

    def load_plan(self, pid: str) -> dict:
        plan = read_json(self._plan_path(pid))
        if plan is None:
            raise NotFound("Монтажный план ещё не создан: запустите анализ")
        return plan

    def save_plan(self, pid: str, plan: dict, *, undoable: bool = True) -> dict:
        T.validate(plan)
        with self.lock(pid):
            if undoable and self._plan_path(pid).is_file():
                self._push(pid, "undo", self.load_plan(pid))
                self._write_stacks(pid, redo=[])
            write_json_atomic(self._plan_path(pid), plan)
        self.touch(pid)
        return plan

    def edit_plan(self, pid: str, action: str, fn: Callable[[dict], object]) -> tuple[dict, object]:
        """Применяет операцию к копии плана; сохраняется только успешный результат."""
        with self.lock(pid):
            plan = self.load_plan(pid)
            working = copy.deepcopy(plan)
            result = fn(working)
            T.validate(working)
            self.save_plan(pid, working)
            self.log_history(pid, f"plan:{action}")
            return working, result

    def _stacks(self, pid: str) -> dict:
        return read_json(self.dir(pid) / "timeline" / "undo.json", {"undo": [], "redo": []})

    def _write_stacks(self, pid: str, **changes) -> None:
        s = {**self._stacks(pid), **changes}
        s["undo"], s["redo"] = s["undo"][-UNDO_LIMIT:], s["redo"][-UNDO_LIMIT:]
        write_json_atomic(self.dir(pid) / "timeline" / "undo.json", s)

    def _push(self, pid: str, which: str, plan: dict) -> None:
        s = self._stacks(pid)
        s[which].append(plan["segments"])
        self._write_stacks(pid, **{which: s[which]})

    def history_state(self, pid: str) -> dict:
        s = self._stacks(pid)
        return {"can_undo": bool(s["undo"]), "can_redo": bool(s["redo"])}

    def undo(self, pid: str) -> dict:
        return self._step(pid, "undo", "redo")

    def redo(self, pid: str) -> dict:
        return self._step(pid, "redo", "undo")

    def _step(self, pid: str, take: str, give: str) -> dict:
        with self.lock(pid):
            s = self._stacks(pid)
            if not s[take]:
                raise ProjectError("Нечего отменять" if take == "undo" else "Нечего повторять")
            plan = self.load_plan(pid)
            segments = s[take].pop()
            s[give].append(plan["segments"])
            plan["segments"] = segments
            T.validate(plan)
            write_json_atomic(self._plan_path(pid), plan)
            self._write_stacks(pid, undo=s["undo"], redo=s["redo"])
        self.log_history(pid, take)
        return plan

    def list_versions(self, pid: str) -> list[dict]:
        out = []
        for f in sorted((self.dir(pid) / "timeline" / "versions").glob("v*.json")):
            data = read_json(f) or {}
            out.append({"name": f.stem, "label": data.get("label", ""), "created": data.get("created", ""),
                        "stats": T.stats(data["plan"]) if "plan" in data else None})
        return out

    def save_version(self, pid: str, label: str = "") -> str:
        with self.lock(pid):
            vdir = self.dir(pid) / "timeline" / "versions"
            n = len(list(vdir.glob("v*.json"))) + 1
            name = f"v{n:03d}"
            write_json_atomic(vdir / f"{name}.json", {"label": label, "created": now(), "plan": self.load_plan(pid)})
        self.log_history(pid, "version:save", f"{name} {label}".strip())
        return name

    def restore_version(self, pid: str, name: str) -> dict:
        if not re.fullmatch(r"v\d{3,}", name):
            raise ProjectError("Некорректное имя версии")
        data = read_json(self.dir(pid) / "timeline" / "versions" / f"{name}.json")
        if not data:
            raise NotFound(f"Версия не найдена: {name}")
        with self.lock(pid):
            self.save_plan(pid, data["plan"])
        self.log_history(pid, "version:restore", name)
        return data["plan"]
