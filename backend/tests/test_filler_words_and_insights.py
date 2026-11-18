import pytest
from app.editing.filler_words import scan_filler_words, clean_filler_words
from app.editing.analytics import calculate_insights
from conftest import make_plan


def test_scan_and_clean_filler_words():
    cues = [
        {"start_ms": 1000, "end_ms": 5000, "text": "Эээ, ну короче мы начинаем трансляцию."},
        {"start_ms": 6000, "end_ms": 10000, "text": "Это нормальное предложение без запинок."},
        {"start_ms": 11000, "end_ms": 15000, "text": "И типа как бы вот такой результат."},
    ]

    matches = scan_filler_words(cues)
    assert len(matches) >= 3
    words_found = {m["word"].lower() for m in matches}
    assert any("эээ" in w for w in words_found)
    assert "короче" in words_found or "ну" in words_found

    # Проверяем вырезку в плане
    plan = make_plan([(0, 20000, "KEEP")], duration=20000)
    cleaned = clean_filler_words(plan, matches)
    assert cleaned >= 3
    # Проверяем, что нарезались сегменты CUT с причиной filler_word
    cuts = [s for s in plan["segments"] if s["action"] == "CUT" and s["reason"] == "filler_word"]
    assert len(cuts) >= 1


def test_calculate_insights():
    plan = make_plan([(0, 10000, "KEEP"), (10000, 15000, "CUT"), (15000, 20000, "KEEP")], duration=20000)
    cues = [
        {"start_ms": 0, "end_ms": 5000, "text": "Первое предложение из пяти слов."},
        {"start_ms": 15000, "end_ms": 20000, "text": "Второе предложение тоже состоит из пяти слов."},
    ]
    meta = {"duration_ms": 20000}

    res = calculate_insights(plan, cues, meta, lang="ru")
    assert res["total_duration_ms"] == 20000
    assert res["output_duration_ms"] == 15000
    assert res["removed_duration_ms"] == 5000
    assert res["saved_percent"] == 25.0
    assert res["total_words"] == 12
    assert res["wpm"] > 0
    assert res["pace"] in ("slow", "optimal", "fast")
