# -*- coding: utf-8 -*-
"""Сквозная проверка интерфейса в настоящем браузере (Playwright + Chromium).
Что проверяет: запуск сервера, демо-проект, быстрый старт с диалогом профилей, все четыре шага, отсутствие ошибок JS.
Нужны ffmpeg, собранный frontend/dist и playwright. Запуск: python tools/smoke_ui.py"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8794
BASE = f"http://127.0.0.1:{PORT}"


def wait_server() -> None:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/system", timeout=2).read()
            return
        except Exception:  # noqa: BLE001
            time.sleep(0.5)
    raise SystemExit("Сервер не запустился")


def main() -> int:
    from playwright.sync_api import sync_playwright

    home = Path(tempfile.mkdtemp(prefix="smoke_ui_"))
    for d in ("templates", "frontend"):
        try:
            (home / d).symlink_to(ROOT / d, target_is_directory=True)
        except OSError:
            shutil.copytree(ROOT / d, home / d, dirs_exist_ok=True)
    media = home / "media"
    media.mkdir()
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=12",
        "-f", "lavfi", "-i", "sine=f=440:r=48000:d=12,volume='if(between(t,3,7),0.0,0.5)':eval=frame",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(media / "clip.mp4"),
    ], check=True)

    env = {**os.environ, "WHISP_DESK_HOME": str(home), "HOME": str(media), "USERPROFILE": str(media)}
    proc = subprocess.Popen([sys.executable, "-m", "app.main", "--no-browser", "--port", str(PORT)],
                            cwd=ROOT / "backend", env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errors: list[str] = []
    try:
        wait_server()
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            ctx.add_init_script("localStorage.setItem('whisp_seen_home_tour','true');localStorage.setItem('whisp_seen_project_tour','true')")
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.set_default_timeout(20000)

            # 1. Главная: пустое состояние, демо-проект
            page.goto(BASE + "/")
            page.get_by_role("button", name="Демо-проект").click()
            page.wait_for_url("**/#/p/*")

            # 2. Четыре шага демо-проекта (анализ запускается сам)
            page.get_by_role("button", name="Перейти к монтажу").wait_for(timeout=60000)
            page.get_by_text("Лезвие").count()
            page.get_by_role("button", name="Перейти к монтажу").click()
            page.get_by_text("Лезвие").first.wait_for()
            page.get_by_text("Субтитры", exact=False).first.click()
            page.get_by_text("Демонстрационный проект", exact=False).first.wait_for()
            page.get_by_text("Экспорт", exact=False).first.click()
            page.get_by_role("button", name="Собрать видео").wait_for()

            # 3. Быстрый старт: диалог профилей и автоцепочка «Только паузы»
            page.goto(BASE + "/")
            page.get_by_text("Выбрать на диске").first.click()
            page.get_by_text("clip.mp4").first.click()
            page.get_by_text("Как обработать видео?").wait_for()
            page.get_by_text("Только паузы").first.click()
            page.get_by_role("button", name="Начать").click()
            page.wait_for_url("**/#/p/*")
            page.get_by_text("Лезвие").first.wait_for(timeout=60000)      # открылся монтаж
            assert page.locator("table.nle-table tbody tr").count() >= 2, "в таблице решений нет строк"

            # 4. Переключатель списка проектов
            page.goto(BASE + "/")
            page.get_by_title("Список").click()
            page.locator("table.proj-table tbody tr").first.wait_for()
            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(home, ignore_errors=True)

    if errors:
        print("Ошибки JS:", *errors, sep="\n  ")
        return 1
    print("Смоук-тест интерфейса пройден")
    return 0


if __name__ == "__main__":
    sys.exit(main())
