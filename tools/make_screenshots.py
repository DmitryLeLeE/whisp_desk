# -*- coding: utf-8 -*-
"""Делает скриншоты для README в docs/. Нужны ffmpeg, собранный frontend/dist и playwright (pip install playwright).
Запуск: python tools/make_screenshots.py"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8791
BASE = f"http://127.0.0.1:{PORT}"


def call(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
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
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=20", "-f", "lavfi", "-i",
                    "sine=f=440:r=48000:d=20,volume='if(between(t,3,7)+between(t,12,13)+between(t,17,20),0.0,0.5)':eval=frame",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(sample)], check=True)
    (home / "lecture_demo.srt").write_text(
        "1\n00:00:00,500 --> 00:00:02,800\nСегодня разберём устройство современного украшения\n\n"
        "2\n00:00:07,200 --> 00:00:11,500\nПервое правило — стерильность инструмента и рабочего места\n\n"
        "3\n00:00:13,200 --> 00:00:16,800\nВторое правило — правильный выбор материала\n", encoding="utf-8")
    env = {**os.environ, "WHISP_DESK_HOME": str(ROOT)}
    # изолируем данные: отдельные projects/config/logs во временной папке, фронтенд и шаблоны берём из репозитория
    for d in ("templates", "frontend"):
        (home / d).symlink_to(ROOT / d, target_is_directory=True)
    env["WHISP_DESK_HOME"] = str(home)
    proc = subprocess.Popen([sys.executable, "-m", "app.main", "--no-browser", "--port", str(PORT)], cwd=ROOT / "backend", env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                call("GET", "/api/system"); break
            except Exception:  # noqa: BLE001
                time.sleep(0.3)
        pid = call("POST", "/api/projects", {"name": "Лекция: стерильность"})["id"]
        call("PUT", f"/api/projects/{pid}/source", {"path": str(sample)})
        assert wait_job(call("POST", f"/api/projects/{pid}/analyze", {}))["status"] == "COMPLETED"
        subprocess.run(["curl", "-s", "-o", "/dev/null", "-F", f"file=@{home / 'lecture_demo.srt'}", f"{BASE}/api/projects/{pid}/subtitles/import"], check=True)
        out = ROOT / "docs"
        out.mkdir(exist_ok=True)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chrome")
            page = browser.new_page(viewport={"width": 1400, "height": 900}, locale="ru-RU")
            page.goto(BASE); page.wait_for_timeout(800)
            page.screenshot(path=str(out / "01-projects.png"))
            page.get_by_text("Лекция: стерильность").first.click(); page.wait_for_timeout(1500)
            page.screenshot(path=str(out / "02-setup.png"))
            for label, name in (("Монтаж", "03-editor.png"), ("Субтитры", "04-subtitles.png"), ("Экспорт", "05-export.png")):
                tab = page.get_by_role("button", name=label)
                if tab.count():
                    tab.first.click(); page.wait_for_timeout(1500)
                    page.screenshot(path=str(out / name))
            browser.close()
        print("saved", sorted(p.name for p in out.glob("*.png")))
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
