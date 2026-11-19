"""Окно программы: WebView2 через pywebview, сервер FastAPI работает в соседнем потоке.

Если окно открыть не удалось (нет WebView2, нет pywebview), программа открывает интерфейс в браузере.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from pathlib import Path

from .core import config

log = logging.getLogger("desk.window")


class NativeApi:
    """Методы, доступные интерфейсу как window.pywebview.api.*"""

    def __init__(self) -> None:
        self.window = None

    def _dialog(self, kind: str, title: str, types: tuple[str, ...] = ()):
        import webview
        mode = {"file": webview.OPEN_DIALOG, "folder": webview.FOLDER_DIALOG}[kind]
        res = self.window.create_file_dialog(mode, allow_multiple=False, file_types=types) if self.window else None
        return str(Path(res[0])) if res else ""

    def pick_file(self, title: str = "Выберите файл", exts: str = "") -> str:
        types = (f"Файлы ({exts})",) if exts else ()
        return self._dialog("file", title, types)

    def pick_folder(self, title: str = "Выберите папку") -> str:
        return self._dialog("folder", title)


def wait_ready(url: str, timeout: float = 25.0) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(url + "api/system", timeout=1.5) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def _load_window_state(path) -> dict:
    """Размер и позиция окна с прошлого запуска; битые значения отбрасываем."""
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        out = {}
        if 1000 <= d["width"] <= 7680 and 640 <= d["height"] <= 4320:
            out.update(width=int(d["width"]), height=int(d["height"]))
        if -50 <= d.get("x", 0) <= 7680 and -50 <= d.get("y", 0) <= 4320 and "x" in d and "y" in d:
            out.update(x=int(d["x"]), y=int(d["y"]))
        return out
    except Exception:
        return {}


def _save_window_state(path, state: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state), encoding="utf-8")
    except Exception as e:
        log.debug("не удалось сохранить размер окна: %s", e)


def run_window(url: str) -> bool:
    """Показывает окно и блокирует поток до закрытия. False — окно не открылось."""
    try:
        import webview
    except Exception as e:  # pywebview не установлен
        log.warning("pywebview недоступен: %s", e)
        return False
    api = NativeApi()
    try:
        icon = config.BUNDLE / "assets" / "icon.png"
        state_file = config.CONFIG_DIR / "window.json"
        saved = _load_window_state(state_file)
        win = webview.create_window(f"WHISP MEDIA DESK {config.VERSION}", url, js_api=api,
                                    width=saved.get("width", 1360), height=saved.get("height", 880),
                                    x=saved.get("x"), y=saved.get("y"),
                                    min_size=(1000, 640), text_select=True)
        api.window = win
        try:
            win.events.resized += lambda w, h: saved.update(width=int(w), height=int(h))
            win.events.moved += lambda x, y: saved.update(x=int(x), y=int(y))
            win.events.closing += lambda: _save_window_state(state_file, saved)
        except Exception as e:  # старый pywebview без событий
            log.debug("события окна недоступны: %s", e)
        started = time.time()
        webview.start(icon=str(icon) if icon.exists() else None, private_mode=False,
                      storage_path=str(config.CONFIG_DIR / "webview"))
        lived = time.time() - started
        log.info("окно закрыто через %.1f с", lived)
        return lived > 3  # мгновенный выход значит, что окно не показалось (нет WebView2): откроем браузер
    except Exception as e:
        log.exception("окно не открылось: %s", e)
        return False
