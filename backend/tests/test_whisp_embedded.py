"""Встроенный Whisp: протокол событий, запуск через launcher, API моделей, расшифровка с заглушкой модели."""
import json
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.integrations import whisp
from conftest import needs_ffmpeg

BACKEND = Path(__file__).resolve().parents[1]


def test_parse_event():
    assert whisp.parse_event('@@WD {"k": "progress", "done": 1.5, "total": 3}') == {"k": "progress", "done": 1.5, "total": 3}
    assert whisp.parse_event("обычная строка журнала") is None
    assert whisp.parse_event("@@WD {сломано") is None


def test_runner_reports_error_event_and_exit_code_via_launcher():
    """Реальный запуск `launcher.py --whisp-run`: проверяет диспетчеризацию и протокол без сети и без модели."""
    r = subprocess.run([sys.executable, str(BACKEND / "launcher.py"), "--whisp-run", "download", json.dumps({"model": "nope"})],
                       capture_output=True, text=True, encoding="utf-8", cwd=BACKEND, timeout=10)
    assert r.returncode == 1
    events = [whisp.parse_event(line) for line in r.stdout.splitlines()]
    assert any(e and e["k"] == "error" for e in events)


def test_models_status_lists_all_models():
    names = [m["name"] for m in whisp.models_status()]
    assert names == ["tiny", "base", "small", "turbo", "medium", "large-v3"]


class FakeModel:
    def transcribe(self, path, **kw):
        seg = lambda a, b, text: SimpleNamespace(start=a, end=b, text=text, words=None)
        return iter([seg(0.0, 2.0, " Привет, мир."), seg(2.5, 5.0, " Второй фрагмент речи.")]), SimpleNamespace(duration=5.0, language="ru")


@needs_ffmpeg
def test_runner_transcribe_with_stub_model(sample_video, tmp_path, monkeypatch, capsys):
    whisp.ensure_vendor_path()
    import whisper_universal as wu
    from app import whisp_runner

    monkeypatch.setattr(wu, "download_model", lambda name, cache, progress=None: progress and progress(5, 10))
    monkeypatch.setattr(wu, "create_model", lambda *a, **k: FakeModel())
    monkeypatch.setattr(wu, "resolve_device", lambda d: "cpu")
    code = whisp_runner._transcribe({"source": str(sample_video), "out_dir": str(tmp_path), "model": "tiny", "language": "ru",
                                     "stem": "whisp", "audio_stream": 1})
    assert code == 0
    srt = (tmp_path / "whisp.srt").read_text(encoding="utf-8")
    assert "Привет, мир." in srt and "Второй фрагмент речи." in srt
    events = [whisp.parse_event(line) for line in capsys.readouterr().out.splitlines()]
    kinds = [e["k"] for e in events if e]
    assert kinds[0] == "stage" and "download" in kinds and "progress" in kinds and kinds[-1] == "done"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("WHISP_DESK_HOME", str(tmp_path / "home"))
    for name in [m for m in list(sys.modules) if m == "app" or m.startswith("app.")]:
        del sys.modules[name]
    (tmp_path / "home" / "templates").mkdir(parents=True)
    from app.main import create_app
    with TestClient(create_app(), base_url="http://127.0.0.1") as c:
        yield c


def test_models_and_settings_api(client, tmp_path):
    data = client.get("/api/whisp/models").json()
    assert {m["name"] for m in data["models"]} >= {"tiny", "turbo", "large-v3"} and data["languages"]["ru"] == "Русский"
    assert client.post("/api/whisp/models/nope/download").status_code == 404
    folder = tmp_path / "моdels"
    s = client.put("/api/settings", json={"whisp_model_dir": str(folder)}).json()
    assert s["whisp_model_dir"] == str(folder) and folder.is_dir()
    assert client.get("/api/whisp/models").json()["model_dir"] == str(folder)
    assert client.put("/api/settings", json={"whisp_model_dir": "relative/dir"}).status_code == 422
    assert client.put("/api/settings", json={"whisp_model_dir": ""}).json()["whisp_model_dir"] == ""


@needs_ffmpeg
def test_transcribe_job_reports_progress_and_saves_cues(client, sample_video, tmp_path, monkeypatch):
    seen = {}

    def fake_transcribe(source, out_dir, *, on_event=None, **kw):
        seen.update(kw)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "whisp.srt").write_text("1\n00:00:00,000 --> 00:00:02,000\nпривет\n", encoding="utf-8")
        (out_dir / "whisp.en.srt").write_text("1\n00:00:00,000 --> 00:00:02,000\nhello\n", encoding="utf-8")
        for ev in ({"k": "stage", "label": "Распознавание речи"}, {"k": "progress", "done": 1, "total": 2}):
            on_event(ev)
        return {"original": out_dir / "whisp.srt", "translated": out_dir / "whisp.en.srt"}

    monkeypatch.setattr(sys.modules["app.integrations.whisp"], "transcribe", fake_transcribe)
    pid = client.post("/api/projects", json={"name": "w"}).json()["id"]
    client.put(f"/api/projects/{pid}/source", json={"path": str(sample_video)})
    job = client.post(f"/api/projects/{pid}/subtitles/transcribe",
                      json={"model": "tiny", "language": "ru", "translate_to": "en", "device": "cpu", "max_line_chars": 42}).json()
    while (j := client.get(f"/api/jobs/{job['id']}").json())["status"] in ("QUEUED", "RUNNING"):
        time.sleep(0.2)
    assert j["status"] == "COMPLETED", j
    assert j["result"] == {"cues": 1, "translations": ["translated.en.srt"]}
    assert seen["translate_to"] == "en" and seen["device"] == "cpu" and seen["max_line_chars"] == 42
    assert client.get(f"/api/projects/{pid}/subtitles").json()["cues"][0]["text"] == "привет"
    assert (tmp_path / "home" / "projects" / pid / "subtitles" / "translated.en.srt").is_file()


def test_transcribe_rejects_bad_params(client, sample_video):
    pid = client.post("/api/projects", json={"name": "w"}).json()["id"]
    client.put(f"/api/projects/{pid}/source", json={"path": str(sample_video)})
    url = f"/api/projects/{pid}/subtitles/transcribe"
    assert client.post(url, json={"model": "huge"}).status_code == 422
    assert client.post(url, json={"device": "tpu"}).status_code == 422
    assert client.post(url, json={"task": "translate", "translate_to": "en"}).status_code == 422


@needs_ffmpeg
def test_audio_index_is_converted_to_global_stream_index(sample_video):
    assert whisp._global_stream_index(sample_video, 0) == 1      # в sample.mp4 видео имеет индекс 0, звук — 1
    with pytest.raises(RuntimeError):
        whisp._global_stream_index(sample_video, 3)


@needs_ffmpeg
def test_projects_summary(client, sample_video):
    pid = client.post("/api/projects", json={"name": "s"}).json()["id"]
    row = client.get("/api/projects/summary").json()[0]
    assert row["id"] == pid and row["has_source"] is False and row["has_plan"] is False and row["rendered"] is False
    client.put(f"/api/projects/{pid}/source", json={"path": str(sample_video)})
    j = client.post(f"/api/projects/{pid}/analyze", json={}).json()
    while client.get(f"/api/jobs/{j['id']}").json()["status"] in ("QUEUED", "RUNNING"):
        time.sleep(0.2)
    row = client.get("/api/projects/summary").json()[0]
    assert row["filename"] == "sample.mp4" and row["has_plan"] and row["unreviewed"] >= 1 and row["duration_ms"] > 19000
    assert row["thumb"] is None or row["thumb"].startswith(f"/api/projects/{pid}/thumbnails/")


@needs_ffmpeg
def test_export_includes_remapped_translation(client, sample_video, tmp_path):
    pid = client.post("/api/projects", json={"name": "t"}).json()["id"]
    client.put(f"/api/projects/{pid}/source", json={"path": str(sample_video)})
    j = client.post(f"/api/projects/{pid}/analyze", json={}).json()
    while client.get(f"/api/jobs/{j['id']}").json()["status"] in ("QUEUED", "RUNNING"):
        time.sleep(0.2)
    srt = "1\n00:00:01,000 --> 00:00:02,000\nпривет\n\n2\n00:00:08,000 --> 00:00:09,000\nпока\n"
    client.post(f"/api/projects/{pid}/subtitles/import", files={"file": ("a.srt", srt.encode())})
    sub_dir = tmp_path / "home" / "projects" / pid / "subtitles"
    (sub_dir / "translated.en.srt").write_text(srt.replace("привет", "hello").replace("пока", "bye"), encoding="utf-8")
    r = client.post(f"/api/projects/{pid}/export", json={"formats": ["srt"]}).json()
    assert any(w.endswith(".en.srt") for w in r["written"]), r
    en = (tmp_path / "home" / "projects" / pid / r["written"][[w.endswith(".en.srt") for w in r["written"]].index(True)]).read_text(encoding="utf-8")
    assert "hello" in en and "bye" in en and "00:00:08,000" not in en     # время пересчитано под вырезанную паузу
