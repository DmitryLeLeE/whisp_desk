import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="нужен ffmpeg в PATH")


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory) -> Path:
    """20 с: звук есть в 0–3, 7–12, 13–17 с; тишина 3–7, 12–13 и 17–20 с. 25 к/с, 640x360."""
    if not shutil.which("ffmpeg"):
        pytest.skip("нужен ffmpeg")
    out = tmp_path_factory.mktemp("media") / "sample.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=20",
         "-f", "lavfi", "-i", "sine=f=440:r=48000:d=20,volume='if(between(t,3,7)+between(t,12,13)+between(t,17,20),0.0,0.5)':eval=frame",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out)],
        check=True)
    return out


def make_plan(segments, duration=10000, fps=(25, 1)):
    return {"schema_version": 1, "project_id": "t", "source": "x.mp4", "duration_ms": duration,
            "fps": {"numerator": fps[0], "denominator": fps[1]}, "audio_stream": 0,
            "segments": [{"id": f"segment_{i:03d}", "source_start_ms": a, "source_end_ms": b, "action": act,
                          "reason": "speech" if act == "KEEP" else "long_silence", "reviewed": False,
                          "locked": False, "manual": False} for i, (a, b, act) in enumerate(segments, 1)]}
