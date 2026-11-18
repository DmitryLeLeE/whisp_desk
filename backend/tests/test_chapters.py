import pytest
from app.editing.chapters import generate_smart_chapters, format_chapters_text, _clean_title


def test_clean_title():
    assert _clean_title("Итак, как настроить сервер для продакшна?") == "Как настроить сервер для продакшна"
    assert _clean_title("   ") == "Раздел"
    assert _clean_title("«В кавычках» и с точкой. Второе предложение") == "В кавычках и с точкой"


def test_generate_smart_chapters_empty():
    chs = generate_smart_chapters([], lang="ru")
    assert len(chs) == 1
    assert chs[0]["time_ms"] == 0
    assert chs[0]["title"] == "Введение"


def test_generate_smart_chapters_with_cues():
    cues = [
        {"start_ms": 0, "end_ms": 5000, "text": "Всем привет, это вводная часть нашего видео."},
        # Пауза > 1.8 с (80000 - 5000 = 75000 мс) и интервал > 60с
        {"start_ms": 80000, "end_ms": 85000, "text": "Теперь перейдём ко второму разделу и разберём логику работы."},
        # Пауза и смена сцены
        {"start_ms": 170000, "end_ms": 175000, "text": "Далее рассмотрим архитектуру системы."},
    ]
    scenes = [170000]
    chs = generate_smart_chapters(cues, scenes=scenes, min_interval_s=60, lang="ru")
    assert len(chs) >= 3
    assert chs[0]["time_ms"] == 0
    assert chs[0]["title"] == "Введение"
    assert chs[1]["time_ms"] == 80000
    assert "второму разделу" in chs[1]["title"].lower()


def test_format_chapters_text():
    chs = [
        {"time_ms": 0, "title": "Введение"},
        {"time_ms": 75000, "title": "Основная часть"},
        {"time_ms": 3665000, "title": "Заключение"},
    ]
    txt = format_chapters_text(chs)
    assert "00:00 Введение" in txt
    assert "01:15 Основная часть" in txt
    assert "01:01:05 Заключение" in txt
