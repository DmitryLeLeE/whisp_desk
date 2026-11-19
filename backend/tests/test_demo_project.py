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


def test_demo_project_has_source_and_subtitles(client):
    r = client.post("/api/projects/demo")
    assert r.status_code == 201
    p = r.json()
    assert p["source"]["filename"] == "demo.mp4"
    assert p["has_subtitles"] is True
    cues = client.get(f"/api/projects/{p['id']}/subtitles").json()["cues"]
    assert len(cues) == 3


def test_open_file_rejects_missing_and_traversal(client):
    pid = client.post("/api/projects/demo").json()["id"]
    assert client.post(f"/api/projects/{pid}/open-file", json={"name": "nope.mp4"}).status_code == 404
    assert client.post(f"/api/projects/{pid}/open-file", json={"name": "../../demo.mp4"}).status_code == 404


def test_project_list_has_scrub_thumbs(client):
    """Карточка проекта получает до 10 кадров для превью по наведению."""
    pid = client.post("/api/projects/demo").json()["id"]
    import app.core.config as config  # noqa: F401
    thumbs = client.app.state.projects.path(pid, "analysis", "thumbnails") if hasattr(client.app.state, "projects") else None
    if thumbs is not None:
        thumbs.mkdir(parents=True, exist_ok=True)
        for i in range(25):
            (thumbs / f"thumb_{i:04d}.jpg").write_bytes(b"\xff\xd8\xff\xd9")
    row = next(r for r in client.get("/api/projects/summary").json() if r["id"] == pid)
    assert "thumbs" in row, row
    if thumbs is not None:
        assert 2 <= len(row["thumbs"]) <= 10
        assert row["thumb"] == row["thumbs"][0]
