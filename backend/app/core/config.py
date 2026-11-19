"""Пути, поиск внешних инструментов и пользовательские настройки."""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))
# В собранном exe данные пользователя лежат рядом с ним, а интерфейс и шаблоны — внутри пакета (sys._MEIPASS).
BUNDLE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[3]))
_default_root = Path(sys.executable).parent if FROZEN else Path(__file__).resolve().parents[3]
ROOT = Path(os.environ.get("WHISP_DESK_HOME") or _default_root).resolve()
PROJECTS_DIR = ROOT / "projects"
CONFIG_DIR = ROOT / "config"
LOGS_DIR = ROOT / "logs"
TOOLS_DIR = ROOT / "tools"
TEMPLATES_DIR = ROOT / "templates"
FRONTEND_DIST = BUNDLE / "frontend" / "dist"
DB_PATH = CONFIG_DIR / "desk.db"
SETTINGS_PATH = CONFIG_DIR / "settings.json"

VERSION = "2.2.0"
HOST = "127.0.0.1"  # внешний доступ запрещён
DEFAULT_PORT = 8765

_EXE = ".exe" if sys.platform == "win32" else ""


def ensure_dirs() -> None:
    for d in (PROJECTS_DIR, CONFIG_DIR, LOGS_DIR):
        d.mkdir(parents=True, exist_ok=True)
    # Первый запуск exe: кладём шаблоны рядом, чтобы их можно было править. Существующие не трогаем.
    bundled = BUNDLE / "templates"
    if FROZEN and bundled.is_dir() and bundled != TEMPLATES_DIR:
        for src in bundled.iterdir():
            dst = TEMPLATES_DIR / src.name
            if src.is_dir() and not dst.exists():
                shutil.copytree(src, dst)


def load_settings() -> dict:
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_settings(data: dict) -> None:
    from .fsutil import write_json_atomic
    write_json_atomic(SETTINGS_PATH, data)


def find_tool(name: str) -> str | None:
    """Сначала tools/<name>/, затем настройка, затем PATH."""
    custom = load_settings().get("tools", {}).get(name)
    if custom and Path(custom).is_file():
        return str(custom)
    # tools/ рядом с программой имеет приоритет (так пользователь подменяет версию), затем встроенные в exe.
    for base in dict.fromkeys((TOOLS_DIR, BUNDLE / "tools")):
        for candidate in (base / name / f"{name}{_EXE}", base / name / "bin" / f"{name}{_EXE}"):
            if candidate.is_file():
                return str(candidate)
    return shutil.which(name)


def require_tool(name: str) -> str:
    path = find_tool(name)
    if not path:
        raise RuntimeError(
            f"Не найден {name}. Положите его в tools/{name}/ или добавьте в PATH."
        )
    return path


def whisp_dir() -> Path | None:
    """Каталог с whisper_universal.py: настройка, переменная окружения или соседняя папка ../whisp."""
    candidates = [
        os.environ.get("WHISP_DIR"),
        load_settings().get("whisp_dir"),
        ROOT.parent / "whisp",
        ROOT / "whisp",
    ]
    for c in candidates:
        if c and (Path(c) / "whisper_universal.py").is_file():
            return Path(c)
    return None
