import pytest
from app.analysis.show_notes import generate_show_notes


def test_generate_show_notes():
    cues = [
        {"start_ms": 0, "end_ms": 2000, "text": "Всем привет, добро пожаловать на наш новый курс по монтажу."},
        {"start_ms": 2500, "end_ms": 5000, "text": "Сегодня мы рассмотрим алгоритмы автоматического удаления пауз."},
        {"start_ms": 60000, "end_ms": 65000, "text": "Во второй части перейдем к субтитрам и караоке-анимации."},
    ]
    chapters = [
        {"time_ms": 0, "title": "Введение в монтаж"},
        {"time_ms": 60000, "title": "Караоке субтитры"},
    ]

    res = generate_show_notes(
        project_name="Урок по монтажу",
        cues=cues,
        chapters=chapters,
        duration_ms=70000,
    )

    assert "Урок по монтажу" in res["youtube_description"]
    assert "00:00 Введение в монтаж" in res["youtube_description"]
    assert "01:00 Караоке субтитры" in res["youtube_description"]
    assert "<b>Урок по монтажу</b>" in res["telegram_post"]
    assert len(res["highlights"]) >= 1
    assert len(res["tags"]) >= 1
