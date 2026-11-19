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
