"""Auto-Editor — необязательный внешний инструмент. Здесь только проверка наличия и версии.

Основной движок в этой версии — собственный планировщик на FFmpeg silencedetect; экспорт в .v3 делается
из собственного edit_plan.json (см. editing/exports.py). Подключение Auto-Editor как движка
чернового плана и рендера — задача этапа 1 ТЗ (сначала проверка на реальных лекциях).
"""
from __future__ import annotations

from ..core.config import find_tool
from ..core.proc import run


def info() -> dict:
    exe = find_tool("auto-editor")
    if not exe:
        return {"available": False}
    try:
        code, out = run([exe, "--version"])
    except OSError:
        return {"available": False}
    return {"available": code == 0, "path": exe, "version": out.strip().splitlines()[0] if out.strip() else ""}
