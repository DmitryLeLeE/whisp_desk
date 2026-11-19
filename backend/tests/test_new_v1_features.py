import pytest
from fastapi.testclient import TestClient

from app.editing import subtitles as subs
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


def test_duplicate_project(client):
    r_create = client.post("/api/projects", json={"name": "Original Video", "type": "lecture"})
    assert r_create.status_code == 201
    orig_id = r_create.json()["id"]

    r_dup = client.post(f"/api/projects/{orig_id}/duplicate")
    assert r_dup.status_code == 201
    dup_data = r_dup.json()
    assert dup_data["id"] != orig_id
    assert "Original Video (Копия)" in dup_data["name"]


def test_system_cache_endpoints(client):
    r_cache = client.get("/api/system/cache")
    assert r_cache.status_code == 200
    assert "files_count" in r_cache.json()

    r_clean = client.post("/api/system/cache/clean")
    assert r_clean.status_code == 200
    assert "deleted_count" in r_clean.json()


def test_render_ass_bold_and_shadow():
    cues = [subs.Cue(start_ms=0, end_ms=2000, text="Viral Hook")]
    ass_text = subs.render_ass(cues, style={"font": "Impact", "size": 84, "bold": 1, "shadow": 3})
    assert "Impact" in ass_text
    assert "84" in ass_text
    assert ",1," in ass_text  # bold=1


def test_render_ass_word_highlight():
    cues = [subs.Cue(start_ms=1000, end_ms=3000, text="One Two Three")]
    ass_text = subs.render_ass(cues, word_highlight=True, highlight_color="#FFEA00")
    assert "\\c" in ass_text
    assert "One" in ass_text
    assert "Three" in ass_text
    # Should contain 3 dialogue slices
    dialogue_lines = [line for line in ass_text.splitlines() if line.startswith("Dialogue:")]
    assert len(dialogue_lines) == 3


def test_project_bundle_export_and_import(client):
    # 1. Create project
    r_create = client.post("/api/projects", json={"name": "Bundle Test Project", "type": "interview"})
    assert r_create.status_code == 201
    pid = r_create.json()["id"]

    # 2. Export bundle (.whisp)
    r_bundle = client.get(f"/api/projects/{pid}/bundle")
    assert r_bundle.status_code == 200
    assert r_bundle.headers["content-type"] == "application/zip"
    content = r_bundle.content
    assert len(content) > 100

    # 3. Import bundle
    files = {"file": ("test_project.whisp", content, "application/zip")}
    r_import = client.post("/api/projects/import-bundle", files=files)
    assert r_import.status_code == 201
    imp_data = r_import.json()
    assert "id" in imp_data
    assert "Bundle Test Project" in imp_data["name"]

