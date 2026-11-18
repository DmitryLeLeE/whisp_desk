# -*- coding: utf-8 -*-
"""Делает скриншоты для README в docs/. Нужны ffmpeg, собранный frontend/dist и playwright (pip install playwright).
Запуск: python tools/make_screenshots.py"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8791
BASE = f"http://127.0.0.1:{PORT}"


def call(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def wait_job(job: dict) -> dict:
    while True:
        j = call("GET", f"/api/jobs/{job['id']}")
        if j["status"] not in ("QUEUED", "RUNNING"):
            return j
        time.sleep(0.3)


def main() -> None:
    from playwright.sync_api import sync_playwright

    home = Path(tempfile.mkdtemp(prefix="desk_shots_"))
    sample = home / "lecture_demo.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=20",
        "-f", "lavfi", "-i", "sine=f=440:r=48000:d=20,volume='if(between(t,3,7)+between(t,12,13)+between(t,17,20),0.0,0.5)':eval=frame",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(sample)
    ], check=True)

    (home / "lecture_demo.srt").write_text(
        "1\n00:00:00,500 --> 00:00:02,800\nЭээ, сегодня разберём устройство современного украшения\n\n"
        "2\n00:00:07,200 --> 00:00:11,500\nНу и первое правило — стерильность инструмента и рабочего места\n\n"
        "3\n00:00:13,200 --> 00:00:16,800\nВторое правило — правильный выбор материала\n",
        encoding="utf-8"
    )

    env = {**os.environ}
    # Изолируем данные: отдельные projects/config/logs во временной папке, фронтенд и шаблоны берём из репозитория
    for d in ("templates", "frontend"):
        target_dir = home / d
        try:
            target_dir.symlink_to(ROOT / d, target_is_directory=True)
        except OSError:
            shutil.copytree(ROOT / d, target_dir, dirs_exist_ok=True)

    env["WHISP_DESK_HOME"] = str(home)
    proc = subprocess.Popen(
        [sys.executable, "-m", "app.main", "--no-browser", "--port", str(PORT)],
        cwd=ROOT / "backend",
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        for _ in range(40):
            try:
                call("GET", "/api/system")
                break
            except Exception:
                time.sleep(0.3)

        pid = call("POST", "/api/projects", {"name": "Лекция: стерильность", "type": "lecture"})["id"]
        call("PUT", f"/api/projects/{pid}/source", {"path": str(sample)})
        assert wait_job(call("POST", f"/api/projects/{pid}/analyze", {}))["status"] == "COMPLETED"

        # Импорт субтитров через multipart/form-data
        boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="lecture_demo.srt"\r\n'
            f"Content-Type: text/plain\r\n\r\n"
            f"{(home / 'lecture_demo.srt').read_text(encoding='utf-8')}\r\n"
            f"--{boundary}--\r\n"
        ).encode("utf-8")
        req = urllib.request.Request(
            f"{BASE}/api/projects/{pid}/subtitles/import",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        with urllib.request.urlopen(req):
            pass

        # Генерируем умные главы для красивого отображения в экспорте
        try:
            call("POST", f"/api/projects/{pid}/chapters/generate", {"min_interval_s": 5, "lang": "ru"})
        except Exception:
            pass

        out = ROOT / "docs"
        out.mkdir(exist_ok=True)

        with sync_playwright() as pw:
            try:
                browser = pw.chromium.launch(channel="chrome")
            except Exception:
                browser = pw.chromium.launch()

            context = browser.new_context(viewport={"width": 1440, "height": 920}, locale="ru-RU")
            page = context.new_page()
            page.add_init_script("""
                localStorage.setItem('whisp_seen_home_tour', 'true');
                localStorage.setItem('whisp_seen_project_tour', 'true');
            """)

            # 1. Список проектов
            page.goto(BASE)
            page.wait_for_timeout(1500)
            page.screenshot(path=str(out / "01-projects.png"))

            # Открываем проект
            page.get_by_text("Лекция: стерильность").first.click()
            page.wait_for_timeout(2000)

            # 2. Настройка и анализ, Монтаж, Субтитры, Экспорт
            shots = (
                ('[data-tour="step-setup"]', "02-setup.png"),
                ('[data-tour="step-edit"]', "03-editor.png"),
                ('[data-tour="step-subs"]', "04-subtitles.png"),
                ('[data-tour="step-export"]', "05-export.png"),
            )
            for selector, name in shots:
                page.locator(selector).first.click()
                page.wait_for_timeout(1800)
                if name == "04-subtitles.png":
                    # Раскроем блок слов-паразитов для демонстрации фичи
                    try:
                        page.get_by_role("button", name=re.compile("Паразиты")).first.click()
                        page.wait_for_timeout(800)
                    except Exception:
                        pass
                page.screenshot(path=str(out / name))

            # 6. Настройки и модели
            page.goto(BASE + "#/settings")
            page.wait_for_timeout(1500)
            page.screenshot(path=str(out / "06-settings.png"))

            browser.close()

        print("Successfully saved:", sorted(p.name for p in out.glob("*.png")))
    finally:
        proc.terminate()
        try:
            shutil.rmtree(home, ignore_errors=True)
        except Exception:
            pass


if __name__ == "__main__":
    main()
