import pytest
from fastapi.testclient import TestClient

from app.editing import timeline as T
from app.editing.exports import to_davinci_markers_csv
from app.main import create_app
from conftest import make_plan


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("WHISP_DESK_HOME", str(tmp_path / "home"))
    for name in [m for m in list(__import__("sys").modules) if m.startswith("app")]:
        del __import__("sys").modules[name]
    from app.main import create_app
    with TestClient(create_app(), base_url="http://127.0.0.1") as c:
        yield c


def test_timeline_markers_add_and_delete():
    plan = make_plan([(0, 5000, "KEEP"), (5000, 10000, "KEEP")])
    m1 = T.add_marker(plan, 2500, label="Intro Hook", color="cyan")
    assert m1["time_ms"] == 2500
    assert m1["label"] == "Intro Hook"
    assert len(plan["markers"]) == 1

    m2 = T.add_marker(plan, 7500, label="Punchline", color="orange")
    assert len(plan["markers"]) == 2
    assert plan["markers"][0]["time_ms"] == 2500
    assert plan["markers"][1]["time_ms"] == 7500

    # Delete marker
    T.delete_marker(plan, m1["id"])
    assert len(plan["markers"]) == 1
    assert plan["markers"][0]["id"] == m2["id"]


def test_davinci_markers_csv_export():
    plan = make_plan([(0, 5000, "KEEP"), (5000, 7000, "CUT"), (7000, 10000, "KEEP")])
    T.add_marker(plan, 1000, label="Highlight", color="cyan")
    csv_text = to_davinci_markers_csv(plan)
    assert "EDL Marker Name" in csv_text
    assert "Highlight" in csv_text
    assert "Cyan" in csv_text


def test_system_endpoints(client):
    r_info = client.get("/api/system/info")
    assert r_info.status_code == 200
    data = r_info.json()
    assert "version" in data
    assert "platform" in data
    assert "ffmpeg" in data

    r_upd = client.get("/api/system/check-update")
    assert r_upd.status_code == 200
    upd_data = r_upd.json()
    assert "current_version" in upd_data
    assert "has_update" in upd_data
