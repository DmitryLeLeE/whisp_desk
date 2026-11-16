"""Окно программы: WebView2 через pywebview, сервер FastAPI работает в соседнем потоке.

Если окно открыть не удалось (нет WebView2, нет pywebview), программа открывает интерфейс в браузере.
"""
from __future__ import annotations

import logging
import threading
import time
import urllib.request
from pathlib import Path

from . import config

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
        win = webview.create_window(f"WHISP MEDIA DESK {config.VERSION}", url, js_api=api, width=1360, height=880,
                                    min_size=(1000, 640), text_select=True)
        api.window = win
        webview.start(icon=str(icon) if icon.exists() else None, private_mode=False,
                      storage_path=str(config.CONFIG_DIR / "webview"))
        return True
    except Exception as e:
        log.exception("окно не открылось: %s", e)
        return False
