import json
from pathlib import Path
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
    shutil.copytree(Path(__file__).resolve().parents[2] / "templates", tmp_path / "home" / "templates", dirs_exist_ok=True)
    from app.main import create_app
    with TestClient(create_app(), base_url="http://127.0.0.1") as c:
        yield c


def test_batch_projects_and_chapters_api(client, sample_video, tmp_path):
    # 1. Batch creation
    resp = client.post("/api/projects/batch", json={
        "paths": [str(sample_video)],
        "type": "lecture",
        "auto_analyze": False,
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "created" in data
    assert len(data["created"]) == 1
    pid = data["created"][0]["id"]

    # 2. Chapters initial state (defaults to intro)
    chs = client.get(f"/api/projects/{pid}/chapters").json()
    assert "chapters" in chs
    assert len(chs["chapters"]) >= 1

    # 3. Chapters PUT update
    new_chapters = [
        {"time_ms": 0, "title": "Введение в курс"},
        {"time_ms": 15000, "title": "Практическая часть"},
    ]
    put_resp = client.put(f"/api/projects/{pid}/chapters", json={"chapters": new_chapters})
    assert put_resp.status_code == 200
    saved = put_resp.json()
    assert len(saved["chapters"]) == 2
    assert "00:00 Введение в курс" in saved["formatted"]
    assert "00:15 Практическая часть" in saved["formatted"]

    # 4. Chapters generate
    gen_resp = client.post(f"/api/projects/{pid}/chapters/generate", json={"min_interval_s": 10})
    assert gen_resp.status_code == 200
    gen_data = gen_resp.json()
    assert "chapters" in gen_data
    assert len(gen_data["chapters"]) >= 1

    # 5. Reveal in explorer mock/call
    reveal_resp = client.post(f"/api/projects/{pid}/reveal")
    assert reveal_resp.status_code == 200
    assert reveal_resp.json()["ok"] is True

    # 6. Frame capture
    frame_resp = client.get(f"/api/projects/{pid}/frame?time_ms=500")
    assert frame_resp.status_code == 200
    assert frame_resp.headers["content-type"] == "image/jpeg"
    assert len(frame_resp.content) > 100

    # 7. Insights
    insights_resp = client.get(f"/api/projects/{pid}/insights")
    assert insights_resp.status_code == 200
    ins_data = insights_resp.json()
    assert "total_duration_ms" in ins_data
    assert "efficiency_score" in ins_data

    # 8. Filler words scan & clean
    fw_resp = client.get(f"/api/projects/{pid}/filler-words")
    assert fw_resp.status_code == 200
    assert "matches" in fw_resp.json()
    fw_clean = client.post(f"/api/projects/{pid}/filler-words/clean", json={})
    assert fw_clean.status_code == 200
