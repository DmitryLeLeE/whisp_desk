"""Интеграция с настоящим Auto-Editor (пропускается, если он не установлен)."""
import json
import time

import pytest
from fastapi.testclient import TestClient

from app.analysis import compare, edit_planner as P
from app.integrations import auto_editor as AE
from app.media import ffprobe
from conftest import needs_auto_editor, needs_ffmpeg

FPS = {"numerator": 25, "denominator": 1}


def test_cuts_from_v1_chunks():
    chunks = [[0, 88, 1.0], [88, 167, 99999.0], [167, 438, 1.0], [438, 500, 99999.0]]
    cuts = AE.cuts_from_chunks(chunks, FPS, 20000)
    assert cuts == [{"start_ms": 3520, "end_ms": 6680, "reason": "long_silence"},
                    {"start_ms": 17520, "end_ms": 20000, "reason": "ending_trim"}]
    assert AE.cuts_from_chunks([[0, 50, 99999.0], [50, 500, 1.0]], FPS, 20000)[0]["reason"] == "opening_trim"


def test_compare_overlap():
    r = compare.compare([(0, 100), (200, 300)], [(50, 150), (200, 300)], ("a", "b"))
    assert r["overlap_ms"] == 150 and r["only_a_ms"] == 50 and r["only_b_ms"] == 50
    assert r["agreement"] == round(150 / 250, 3)
    assert compare.compare([], [], ("a", "b"))["agreement"] == 1.0


@needs_ffmpeg
@needs_auto_editor
def test_auto_editor_cuts_match_builtin_detector(sample_video):
    meta = ffprobe.probe(sample_video)
    params = P.profile_params("standard")
    cuts = AE.detect_cuts(sample_video, audio_index=0, fps=meta["video"]["fps"], duration_ms=meta["duration_ms"],
                          noise_db=params["noise_db"], min_pause_s=params["min_pause_s"],
                          pad_before_s=params["pad_before_s"], pad_after_s=params["pad_after_s"],
                          min_keep_s=params["min_keep_s"])
    plan = P.build_plan_from_cuts(project_id="t", source="s", duration_ms=meta["duration_ms"],
                                  fps=meta["video"]["fps"], audio_index=0, cuts=cuts)
    assert [s["action"] for s in plan["segments"]] == ["KEEP", "CUT", "KEEP", "CUT"]
    mid = plan["segments"][1]
    assert abs(mid["source_start_ms"] - 3500) < 200 and abs(mid["source_end_ms"] - 6700) < 200


@needs_ffmpeg
@needs_auto_editor
def test_our_v3_is_accepted_and_rendered_by_auto_editor(sample_video, tmp_path):
    from app.editing import timeline as T
    meta = ffprobe.probe(sample_video)
    plan = P.build_plan(project_id="t", source="s", duration_ms=20000, fps=meta["video"]["fps"], audio_index=0,
                        silence=[{"start_ms": 3008, "end_ms": 7019}, {"start_ms": 17003, "end_ms": 20000}],
                        params=P.profile_params("standard"))
    out = tmp_path / "ae.mp4"
    AE.render_v3(plan, meta, sample_video, out, tmp_path / "w")
    got = ffprobe.probe(out)["duration_ms"]
    assert abs(got - T.output_duration_ms(plan)) < 300


@needs_ffmpeg
@needs_auto_editor
def test_pipeline_with_auto_editor_engine_compare_and_render(sample_video, tmp_path, monkeypatch):
    monkeypatch.setenv("WHISP_DESK_HOME", str(tmp_path / "home"))
    import sys
    for name in [m for m in list(sys.modules) if m.startswith("app")]:
        del sys.modules[name]
    (tmp_path / "home" / "templates").mkdir(parents=True)
    from app.main import create_app
    with TestClient(create_app(), base_url="http://127.0.0.1") as c:
        def wait(job):
            while True:
                j = c.get(f"/api/jobs/{job['id']}").json()
                if j["status"] not in ("QUEUED", "RUNNING"):
                    return j
                time.sleep(0.3)
        pid = c.post("/api/projects", json={"name": "ae"}).json()["id"]
        c.put(f"/api/projects/{pid}/source", json={"path": str(sample_video)})
        j = wait(c.post(f"/api/projects/{pid}/analyze", json={"engine": "auto-editor"}).json())
        assert j["status"] == "COMPLETED", j
        assert j["result"]["engine"] == "auto-editor"
        plan = c.get(f"/api/projects/{pid}/timeline").json()
        assert plan["stats"]["removed_ms"] > 4000

        j = wait(c.post(f"/api/projects/{pid}/analysis/compare").json())
        assert j["status"] == "COMPLETED", j
        cmp_ = c.get(f"/api/projects/{pid}/analysis/compare").json()
        assert cmp_["agreement"] > 0.9

        j = wait(c.post(f"/api/projects/{pid}/render", json={"mode": "final", "engine": "auto-editor", "package": False}).json())
        assert j["status"] == "COMPLETED", j
        assert j["result"]["encoder"] == "auto-editor"
        # вшивание субтитров этим движком не поддерживается — понятная ошибка
        srt = "1\n00:00:01,000 --> 00:00:02,000\nтест\n"
        c.post(f"/api/projects/{pid}/subtitles/import", files={"file": ("a.srt", srt.encode())})
        j = wait(c.post(f"/api/projects/{pid}/render", json={"mode": "final", "engine": "auto-editor", "overwrite": True,
                                                              "burn_subtitles": True, "package": False}).json())
        assert j["status"] == "FAILED" and "не вшивает" in j["error"]
