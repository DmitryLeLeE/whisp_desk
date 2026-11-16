"""Рендер с шаблоном (логотип, заставка, финальная карточка), несколько аудиодорожек, VFR, интеграция с Whisp."""
import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from app.analysis import edit_planner as P, silence_detector as SD
from app.editing import render as R, timeline as T
from app.media import ffprobe
from conftest import needs_ffmpeg

pytestmark = needs_ffmpeg


def ff(*args):
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args], check=True)


def test_template_logo_intro_outro(sample_video, tmp_path):
    ff("-f", "lavfi", "-i", "color=c=red:s=300x300:d=1", "-frames:v", "1", str(tmp_path / "card.png"))
    ff("-f", "lavfi", "-i", "color=c=blue:s=100x50:d=1", "-frames:v", "1", str(tmp_path / "logo.png"))
    tpl = {"intro": {"image": "card.png", "duration_s": 2}, "outro": {"image": "card.png", "duration_s": 1},
           "logo": {"file": "logo.png", "position": "bottom-right", "scale": 0.1},
           "audio": {"normalize": True, "limiter": True, "fade_out_s": 0.5}}
    meta = ffprobe.probe(sample_video)
    plan = P.build_plan(project_id="t", source="s", duration_ms=20000, fps=meta["video"]["fps"], audio_index=0,
                        silence=[{"start_ms": 3000, "end_ms": 7000}], params=P.profile_params("standard"))
    out = tmp_path / "o" / "final.mp4"
    res = R.render(plan=plan, meta=meta, source=sample_video, out_path=out, work_dir=tmp_path / "w",
                   options=R.merge_options("final", tpl, None), template=tpl, template_dir=tmp_path)
    kept = T.output_duration_ms(plan)
    assert abs(res["duration_ms"] - (kept + 3000)) < 400
    assert res["video"]["width"] == 640 and res["audio"]["channels"] == 2


def test_template_asset_outside_directory_is_rejected(sample_video, tmp_path):
    meta = ffprobe.probe(sample_video)
    plan = P.build_plan(project_id="t", source="s", duration_ms=20000, fps=meta["video"]["fps"], audio_index=0,
                        silence=[], params=P.profile_params("standard"))
    tpl_dir = tmp_path / "tpl"
    tpl_dir.mkdir()
    tpl = {"logo": {"file": "../secret.png"}}
    with pytest.raises(R.RenderError):
        R.render(plan=plan, meta=meta, source=sample_video, out_path=tmp_path / "o.mp4", work_dir=tmp_path / "w",
                 options=R.merge_options("fast", tpl, None), template=tpl, template_dir=tpl_dir)


def test_multiple_audio_tracks_selects_requested_one(tmp_path):
    two = tmp_path / "two.mkv"
    # дорожка 0 — тишина, дорожка 1 — тон 5 с, затем тишина
    ff("-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=10", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=10",
       "-f", "lavfi", "-i", "sine=f=500:r=48000:d=10,volume='if(lt(t,5),0.5,0)':eval=frame",
       "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", str(two))
    meta = ffprobe.probe(two)
    assert meta["audio_stream_count"] == 2
    s0 = SD.detect_silence(two, 0, meta["duration_ms"], -35, 1.2)
    s1 = SD.detect_silence(two, 1, meta["duration_ms"], -35, 1.2)
    assert s0 and s0[0]["start_ms"] == 0 and s0[0]["end_ms"] >= 9900       # вся дорожка 0 тихая
    assert len(s1) == 1 and 4900 <= s1[0]["start_ms"] <= 5200               # дорожка 1: тишина после 5 с
    plan = P.build_plan(project_id="t", source="s", duration_ms=10000, fps=meta["video"]["fps"], audio_index=1,
                        silence=s1, params=P.profile_params("standard"))
    res = R.render(plan=plan, meta=meta, source=two, out_path=tmp_path / "o.mp4", work_dir=tmp_path / "w",
                   options=R.merge_options("fast", None, None))
    assert res["duration_ms"] > 4000


def test_variable_frame_rate_is_detected_and_rendered_constant(tmp_path):
    vfr = tmp_path / "vfr.mp4"
    # кадры с неравномерными временными метками: 10 к/с в первой половине, 25 к/с во второй
    ff("-f", "lavfi", "-i", "testsrc2=s=320x180:r=50:d=6", "-f", "lavfi", "-i", "sine=f=300:d=6",
       "-vf", "select='if(lt(t,3),not(mod(n,5)),not(mod(n,2)))',setpts=N/FRAME_RATE/TB*0+PTS", "-fps_mode", "vfr",
       "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(vfr))
    meta = ffprobe.probe(vfr)
    if not meta["video"]["variable_frame_rate"]:
        pytest.skip("ffmpeg не создал VFR-файл в этой сборке")
    plan = P.build_plan(project_id="t", source="s", duration_ms=meta["duration_ms"], fps=meta["video"]["fps"],
                        audio_index=0, silence=[], params=P.profile_params("standard"))
    res = R.render(plan=plan, meta=meta, source=vfr, out_path=tmp_path / "o.mp4", work_dir=tmp_path / "w",
                   options=R.merge_options("fast", None, None))
    assert not res["video"]["variable_frame_rate"]


def test_not_enough_disk_space_is_reported(sample_video, tmp_path, monkeypatch):
    import collections
    usage = collections.namedtuple("usage", "total used free")
    monkeypatch.setattr(R.shutil, "disk_usage", lambda _p: usage(100, 100, 1000))
    meta = ffprobe.probe(sample_video)
    plan = P.build_plan(project_id="t", source="s", duration_ms=20000, fps=meta["video"]["fps"], audio_index=0,
                        silence=[], params=P.profile_params("standard"))
    with pytest.raises(R.RenderError, match="Недостаточно места"):
        R.render(plan=plan, meta=meta, source=sample_video, out_path=tmp_path / "o.mp4", work_dir=tmp_path / "w",
                 options=R.merge_options("fast", None, None))
    assert not list(tmp_path.glob("*.part.mp4"))


def test_failed_ffmpeg_leaves_no_partial_output(sample_video, tmp_path):
    meta = ffprobe.probe(sample_video)
    plan = P.build_plan(project_id="t", source="s", duration_ms=20000, fps=meta["video"]["fps"], audio_index=5,
                        silence=[], params=P.profile_params("standard"))      # несуществующая дорожка
    with pytest.raises(R.RenderError):
        R.render(plan=plan, meta=meta, source=sample_video, out_path=tmp_path / "o.mp4", work_dir=tmp_path / "w",
                 options=R.merge_options("fast", None, None))
    assert not (tmp_path / "o.mp4").exists() and not list(tmp_path.glob("*.part.mp4"))


def test_whisp_cli_integration_with_fake_whisp(tmp_path, monkeypatch, sample_video):
    fake = tmp_path / "whisp"
    fake.mkdir()
    (fake / "whisper_universal.py").write_text(textwrap.dedent('''
        import sys
        from pathlib import Path
        a = sys.argv
        src, out = Path(a[1]), Path(a[a.index("-o") + 1])
        (out / f"{src.stem}.whisper.srt").write_text("1\\n00:00:01,000 --> 00:00:02,000\\nпривет\\n", encoding="utf-8")
    '''), encoding="utf-8")
    monkeypatch.setenv("WHISP_DIR", str(fake))
    from app.integrations import whisp
    monkeypatch.setattr(whisp, "embedded_available", lambda: False)  # проверяем запасной путь: внешний Whisp
    assert whisp.info()["available"]
    srt = whisp.transcribe(sample_video, tmp_path / "out", audio_index=0)["original"]
    assert srt.read_text(encoding="utf-8").strip().endswith("привет")


def test_whisp_missing_gives_clear_error(tmp_path, monkeypatch, sample_video):
    monkeypatch.setenv("WHISP_DESK_HOME", str(tmp_path))
    monkeypatch.delenv("WHISP_DIR", raising=False)
    from app.core import config
    monkeypatch.setattr(config, "whisp_dir", lambda: None)
    from app.integrations import whisp
    monkeypatch.setattr(whisp, "whisp_dir", lambda: None)
    monkeypatch.setattr(whisp, "embedded_available", lambda: False)
    with pytest.raises(RuntimeError, match="Whisp недоступен"):
        whisp.transcribe(sample_video, tmp_path / "o")


def test_filter_script_flag_depends_on_ffmpeg_version():
    from app.editing.render import _script_flags
    assert _script_flags("ffmpeg version 6.1.1-3ubuntu5 Copyright") == ["-filter_complex_script"]
    assert _script_flags("ffmpeg version 7.1 Copyright") == ["-/filter_complex"]
    assert _script_flags("ffmpeg version N-118000-gabcdef Copyright") == ["-/filter_complex"]
    assert _script_flags("") == ["-/filter_complex"]
