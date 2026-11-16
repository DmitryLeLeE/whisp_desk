"""Сквозной тест: весь конвейер через HTTP API на сгенерированном видео."""
import hashlib
import json
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from conftest import needs_ffmpeg

pytestmark = needs_ffmpeg


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("WHISP_DESK_HOME", str(tmp_path / "home"))
    for name in [m for m in list(__import__("sys").modules) if m.startswith("app")]:
        del __import__("sys").modules[name]
    (tmp_path / "home" / "templates").mkdir(parents=True)
    import shutil
    from pathlib import Path
    shutil.copytree(Path(__file__).resolve().parents[2] / "templates", tmp_path / "home" / "templates", dirs_exist_ok=True)
    from app.main import create_app
    with TestClient(create_app(), base_url="http://127.0.0.1") as c:
        yield c


def wait(client, job, timeout=120):
    t = time.time()
    while time.time() - t < timeout:
        j = client.get(f"/api/jobs/{job['id']}").json()
        if j["status"] not in ("QUEUED", "RUNNING"):
            return j
        time.sleep(0.2)
    raise TimeoutError(j)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stream_durations(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json",
                          str(path)], capture_output=True, text=True, check=True).stdout
    return {s["codec_type"]: float(s["duration"]) for s in json.loads(out)["streams"]}


def test_full_pipeline(client, sample_video, tmp_path):
    original_hash = sha(sample_video)

    p = client.post("/api/projects", json={"name": "Тест", "type": "lecture"}).json()
    pid = p["id"]
    assert pid == "lecture_001"
    assert client.put(f"/api/projects/{pid}/source", json={"path": str(sample_video)}).status_code == 200

    job = wait(client, client.post(f"/api/projects/{pid}/analyze", json={"profile": "standard"}).json())
    assert job["status"] == "COMPLETED", job
    meta = client.get(f"/api/projects/{pid}/analysis/metadata").json()
    assert meta["duration_ms"] == 20000 and meta["video"]["width"] == 640
    plan = client.get(f"/api/projects/{pid}/timeline").json()
    assert plan["stats"]["removed_ms"] > 4000
    assert client.get(f"/api/projects/{pid}/analysis/waveform").json()["peaks"]
    assert client.get(f"/api/projects/{pid}/media/proxy").status_code == 200

    # повторный анализ без подтверждения не перезаписывает план
    assert client.post(f"/api/projects/{pid}/analyze", json={}).status_code == 409

    # ручная правка: вернуть первое сокращение, вырезать ещё кусок, отменить и повторить
    cut = next(s for s in plan["plan"]["segments"] if s["action"] == "CUT" and s["reason"] == "long_silence")
    r = client.post(f"/api/projects/{pid}/timeline/ops", json={"op": "set_action", "id": cut["id"], "action": "KEEP"})
    assert r.status_code == 200 and r.json()["can_undo"]
    r = client.post(f"/api/projects/{pid}/timeline/undo").json()
    assert next(s for s in r["plan"]["segments"] if s["id"] == cut["id"])["action"] == "CUT"
    assert client.post(f"/api/projects/{pid}/timeline/redo").json()["plan"]["segments"]
    client.post(f"/api/projects/{pid}/timeline/undo")
    bad = client.post(f"/api/projects/{pid}/timeline/ops", json={"op": "split", "id": cut["id"], "at_ms": 999999})
    assert bad.status_code == 422

    # субтитры
    srt = "1\n00:00:01,000 --> 00:00:02,500\nначало\n\n2\n00:00:13,000 --> 00:00:16,000\nконец записи\n"
    r = client.post(f"/api/projects/{pid}/subtitles/import", files={"file": ("lecture.srt", srt.encode("utf-8"))})
    assert r.status_code == 200 and r.json()["cues"] == 2
    assert client.get(f"/api/projects/{pid}/subtitles/search", params={"q": "КОНЕЦ"}).json()["results"]

    # быстрый рендер со вшитыми субтитрами
    job = wait(client, client.post(f"/api/projects/{pid}/render", json={"mode": "fast", "burn_subtitles": True}).json())
    assert job["status"] == "COMPLETED", job
    exports = tmp_path / "home" / "projects" / pid / "exports"
    preview = exports / "preview.mp4"
    expected = client.get(f"/api/projects/{pid}/timeline").json()["stats"]["output_ms"] / 1000
    d = stream_durations(preview)
    assert abs(d["video"] - expected) < 0.3 and abs(d["audio"] - expected) < 0.3
    assert abs(d["video"] - d["audio"]) < 0.15          # нет заметного рассогласования
    # повторный рендер без подтверждения запрещён, с подтверждением — разрешён
    job = wait(client, client.post(f"/api/projects/{pid}/render", json={"mode": "fast"}).json())
    assert job["status"] == "FAILED" and "уже существует" in job["error"]
    job = wait(client, client.post(f"/api/projects/{pid}/render", json={"mode": "fast", "overwrite": True}).json())
    assert job["status"] == "COMPLETED"

    # финальный рендер + пакет материалов
    job = wait(client, client.post(f"/api/projects/{pid}/render", json={"mode": "final", "template": "lecture"}).json())
    assert job["status"] == "COMPLETED", job
    for name in ("final.mp4", "final.v3", "final.fcpxml", "edit_plan.json", "source_info.json"):
        assert (exports / name).is_file(), name
    edited = (tmp_path / "home" / "projects" / pid / "subtitles" / "edited.srt").read_text(encoding="utf-8")
    assert "конец записи" in edited and "00:00:13,000" not in edited   # время пересчитано
    assert json.loads((exports / "final.v3").read_text())["version"] == "3"

    # история, версии, журнал
    assert client.post(f"/api/projects/{pid}/timeline/versions", json={"label": "ok"}).status_code == 201
    assert any(h["action"].startswith("render") for h in client.get(f"/api/projects/{pid}/history").json())
    assert client.get(f"/api/projects/{pid}/log").json()["lines"]

    # оригинал не изменился, ссылка на него сохранена, копий нет
    assert sha(sample_video) == original_hash
    assert not list((tmp_path / "home" / "projects" / pid / "source").glob("*.mp4"))


def test_source_must_exist_and_busy_project_is_protected(client, tmp_path):
    pid = client.post("/api/projects", json={"name": "x"}).json()["id"]
    assert client.put(f"/api/projects/{pid}/source", json={"path": str(tmp_path / "нет.mp4")}).status_code == 400
    assert client.put(f"/api/projects/{pid}/source", json={"path": "relative.mp4"}).status_code == 400
    assert client.post(f"/api/projects/{pid}/analyze", json={}).status_code == 400   # источника нет
    assert client.get("/api/projects/nope_001").status_code == 404
    assert client.get("/api/projects/..%2Fetc").status_code in (404, 422)


def test_foreign_host_header_rejected(client):
    assert client.get("/api/projects", headers={"host": "evil.example.com"}).status_code == 400


def test_cancel_running_job(client, tmp_path):
    long_video = tmp_path / "long.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=600",
                    "-f", "lavfi", "-i", "sine=f=300:d=600", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
                    str(long_video)], check=True)
    pid = client.post("/api/projects", json={"name": "long"}).json()["id"]
    client.put(f"/api/projects/{pid}/source", json={"path": str(long_video)})
    job = client.post(f"/api/projects/{pid}/analyze", json={}).json()
    # второй запуск для того же проекта запрещён
    assert client.post(f"/api/projects/{pid}/analyze", json={"replace_plan": True}).status_code == 409
    time.sleep(1.0)
    client.post(f"/api/jobs/{job['id']}/cancel")
    j = wait(client, job, 30)
    assert j["status"] == "CANCELLED"
    retried = client.post(f"/api/jobs/{job['id']}/retry").json()
    client.post(f"/api/jobs/{retried['id']}/cancel")
    wait(client, retried, 30)
