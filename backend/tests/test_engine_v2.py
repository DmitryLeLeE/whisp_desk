import subprocess

import pytest

from app.analysis.threshold import suggest_threshold
from app.analysis import edit_planner as P
from app.editing import exports as E, render as R
from app.media import ffprobe
from conftest import make_plan, needs_ffmpeg


def test_threshold_between_floor_and_speech():
    peaks = [0.002] * 300 + [0.3] * 700           # фон ≈ -54 dB, речь ≈ -10 dB
    r = suggest_threshold(peaks)
    assert r["confident"] and -50 <= r["noise_db"] <= -25
    assert r["floor_db"] < r["noise_db"] < r["speech_db"]


def test_threshold_digital_silence_is_clamped_and_flat_signal_not_confident():
    assert suggest_threshold([0.0] * 300 + [0.5] * 700)["noise_db"] == -50
    flat = suggest_threshold([0.1] * 1000)
    assert not flat["confident"]
    with pytest.raises(ValueError):
        suggest_threshold([0.1] * 5)


def test_edl_format():
    plan = make_plan([(0, 4000, "KEEP"), (4000, 6000, "CUT"), (6000, 10000, "KEEP")])
    meta = {"has_video": True}
    from pathlib import Path
    edl = E.to_edl(plan, meta, Path("/x/lecture.mp4"), "Лекция")
    lines = edl.splitlines()
    assert lines[0] == "TITLE: Лекция" and lines[1] == "FCM: NON-DROP FRAME"
    assert "001  AX       AA/V  C        00:00:00:00 00:00:04:00 01:00:00:00 01:00:04:00" in lines
    assert "002  AX       AA/V  C        00:00:06:00 00:00:10:00 01:00:04:00 01:00:08:00" in lines
    assert lines.count("* FROM CLIP NAME: lecture.mp4") == 2


def test_encoder_selection_falls_back():
    assert R.pick_encoder("libx264") == "libx264"
    assert R.pick_encoder("nonsense") == "libx264"
    assert R.pick_encoder("auto") in ("libx264", *R.HW_ENCODERS)
    args = R.video_codec_args("h264_nvenc", {"crf": 20, "preset": "veryfast"})
    assert args[:2] == ["-c:v", "h264_nvenc"] and "-cq" in args


@needs_ffmpeg
def test_hardware_encoder_failure_falls_back_to_cpu(sample_video, tmp_path, monkeypatch):
    meta = ffprobe.probe(sample_video)
    plan = P.build_plan(project_id="t", source="s", duration_ms=20000, fps=meta["video"]["fps"], audio_index=0,
                        silence=[{"start_ms": 3000, "end_ms": 7000}], params=P.profile_params("standard"))
    monkeypatch.setattr(R, "pick_encoder", lambda _p: "h264_nvenc")   # в песочнице такого железа нет
    logs = []
    res = R.render(plan=plan, meta=meta, source=sample_video, out_path=tmp_path / "o.mp4", work_dir=tmp_path / "w",
                   options=R.merge_options("fast", None, {"video": {"encoder": "auto"}}), log=logs.append)
    assert res["encoder"] == "libx264" and any("повтор на процессоре" in m for m in logs)


@needs_ffmpeg
def test_threshold_from_real_audio(sample_video):
    from app.media.waveform import compute_peaks
    peaks = compute_peaks(sample_video, 0, 20000)["peaks"]
    r = suggest_threshold(peaks)
    assert -50 <= r["noise_db"] <= -25
