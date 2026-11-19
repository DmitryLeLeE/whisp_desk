import pytest
from pathlib import Path
from conftest import needs_ffmpeg
from app.editing.lossless import render_lossless

pytestmark = needs_ffmpeg


def test_render_lossless_smoke(sample_video, tmp_path):
    out = tmp_path / "lossless_out.mp4"
    work = tmp_path / "work"
    plan = {
        "schema_version": 1,
        "duration_ms": 3000,
        "segments": [
            {"id": "seg_001", "source_start_ms": 0, "source_end_ms": 1000, "action": "KEEP", "reason": "test"},
            {"id": "seg_002", "source_start_ms": 1000, "source_end_ms": 2000, "action": "CUT", "reason": "silence"},
            {"id": "seg_003", "source_start_ms": 2000, "source_end_ms": 3000, "action": "KEEP", "reason": "test"},
        ],
    }

    res = render_lossless(
        source=sample_video,
        out_path=out,
        plan=plan,
        work_dir=work,
    )

    assert out.is_file()
    assert out.stat().st_size > 0
    assert res["lossless"] is True
    assert res["segments_count"] == 2
