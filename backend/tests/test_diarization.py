import pytest
import numpy as np
from conftest import needs_ffmpeg
from app.analysis.diarization import extract_segment_features, diarize_cues

pytestmark = needs_ffmpeg


def test_extract_segment_features():
    sr = 16000
    t = np.linspace(0, 1.0, sr)
    # Синусоида 200 Гц (голос)
    audio = 0.5 * np.sin(2 * np.pi * 200 * t)
    feats = extract_segment_features(audio, sr)
    assert isinstance(feats, np.ndarray)
    assert len(feats) >= 8


def test_diarize_cues_smoke(sample_video, tmp_path):
    cues = [
        {"start_ms": 0, "end_ms": 1000, "text": "Привет всем слушателям подкаста."},
        {"start_ms": 1000, "end_ms": 2000, "text": "Да, привет, сегодня обсуждаем тему выпуска."},
        {"start_ms": 2000, "end_ms": 3000, "text": "Отлично, давайте начнем с главного вопроса."},
    ]
    res = diarize_cues(
        source_path=sample_video,
        cues=cues,
        work_dir=tmp_path / "work",
    )
    assert "speakers_count" in res
    assert len(res["cues"]) == 3
    for c in res["cues"]:
        assert "speaker" in c
