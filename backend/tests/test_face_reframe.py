import pytest
import numpy as np
from app.editing.face_reframe import FaceReframe, compute_smart_reframe_segments


def test_face_reframe_detector_synthetic():
    reframe = FaceReframe()
    # Создаём синтетическое изображение
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    # На пустом изображении лица нет -> None
    assert reframe.detect_face_center_x(img) is None


def test_smart_reframe_segments_fallback(sample_video):
    # Тестируем безопасный расчет на реальном видео
    ranges = [(0, 1000), (1000, 2000)]
    crops = compute_smart_reframe_segments(
        source_path=sample_video,
        width=1920,
        height=1080,
        ranges_ms=ranges,
    )
    assert len(crops) == 2
    # Кроп 9:16 от 1920x1080 -> ширина 608, max_x = 1312, x по умолчанию = 656
    for x in crops:
        assert 0 <= x <= 1312
        assert x % 2 == 0  # четный для yuv420p
