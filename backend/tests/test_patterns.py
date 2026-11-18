# -*- coding: utf-8 -*-
from __future__ import annotations

import pytest

from app.editing.patterns import (
    PATTERNS_CATALOG,
    apply_pattern,
    _text_similarity,
)
from app.editing.timeline import validate, stats


@pytest.fixture
def sample_plan():
    return {
        "schema_version": 1,
        "project_id": "test_proj",
        "source": "dummy.mp4",
        "duration_ms": 10000,
        "fps": {"numerator": 25, "denominator": 1},
        "audio_index": 0,
        "segments": [
            {"id": "segment_001", "source_start_ms": 0, "source_end_ms": 2000, "action": "KEEP", "reason": "speech", "reviewed": True},
            {"id": "segment_002", "source_start_ms": 2000, "source_end_ms": 4000, "action": "CUT", "reason": "long_silence", "reviewed": False},
            {"id": "segment_003", "source_start_ms": 4000, "source_end_ms": 7000, "action": "KEEP", "reason": "speech", "reviewed": True},
            {"id": "segment_004", "source_start_ms": 7000, "source_end_ms": 8000, "action": "CUT", "reason": "long_silence", "reviewed": False},
            {"id": "segment_005", "source_start_ms": 8000, "source_end_ms": 10000, "action": "KEEP", "reason": "speech", "reviewed": True},
        ],
    }


def test_patterns_catalog_has_all_types():
    ids = {p["id"] for p in PATTERNS_CATALOG}
    assert "shorts_jumpcut" in ids
    assert "podcast_flow" in ids
    assert "slides_sync" in ids
    assert "retakes_removal" in ids
    assert "pause_compression" in ids
    assert "highlights_teaser" in ids


def test_apply_shorts_jumpcut(sample_plan):
    cues = [
        {"id": "c1", "start_ms": 500, "end_ms": 1500, "text": "Эээ, всем привет"},
    ]
    res = apply_pattern("shorts_jumpcut", sample_plan, cues=cues)
    validate(sample_plan)
    assert "shorts_jumpcut" in res["pattern_id"]
    assert res["fillers_cleaned"] >= 1
    assert stats(sample_plan)["segments"] >= 3


def test_apply_podcast_flow(sample_plan):
    # Пауза 7000-8000 равна 1000 мс < 1400 мс, должна восстановиться в KEEP
    res = apply_pattern("podcast_flow", sample_plan)
    validate(sample_plan)
    assert res["restored_pauses"] >= 1
    # Проверяем, что итоговый хронометраж увеличился (естественные паузы возвращены)
    assert res["after_stats"]["output_ms"] > res["before_stats"]["output_ms"]


def test_apply_slides_sync(sample_plan):
    # Граница сегмента 2 и 3: 4000 мс. Положим сцену на 3800 мс (в окне snap_window 750 мс)
    scenes = [3800]
    res = apply_pattern("slides_sync", sample_plan, scenes=scenes)
    validate(sample_plan)
    assert res["snapped_cuts"] == 1
    # Проверяем, что граница сдвинулась ровно на 3800
    assert any(s["source_end_ms"] == 3800 for s in sample_plan["segments"])


def test_apply_retakes_removal(sample_plan):
    cues = [
        {"id": "c1", "start_ms": 200, "end_ms": 1200, "text": "Сегодня мы рассмотрим основы"},
        {"id": "c2", "start_ms": 1300, "end_ms": 2300, "text": "Сегодня мы рассмотрим основы монтажа"},
    ]
    res = apply_pattern("retakes_removal", sample_plan, cues=cues)
    validate(sample_plan)
    assert res["retakes_removed"] == 1
    # Проверяем, что отрезок первого дубля теперь CUT
    assert any(s["action"] == "CUT" and s.get("reason") == "retake_cut" for s in sample_plan["segments"])


def test_apply_pause_compression(sample_plan):
    # Пауза 2000-4000 (2000 мс) должна быть сжата до 350 мс
    res = apply_pattern("pause_compression", sample_plan, params={"target_pause_ms": 400, "min_pause_ms": 1000})
    validate(sample_plan)
    assert res["compressed"] >= 1


def test_apply_highlights_teaser(sample_plan):
    cues = [
        {"id": "c1", "start_ms": 500, "end_ms": 1800, "text": "Быстрая динамичная речь без остановок"},
        {"id": "c2", "start_ms": 4500, "end_ms": 6500, "text": "Еще один ключевой момент важной мысли"},
    ]
    res = apply_pattern("highlights_teaser", sample_plan, cues=cues, params={"target_seconds": 3})
    validate(sample_plan)
    assert res["selected_cues"] >= 1


def test_text_similarity():
    assert _text_similarity("Сегодня мы рассмотрим", "Сегодня мы рассмотрим монтаж") > 0.7
    assert _text_similarity("Совершенно другой текст", "Какое-то третье предложение") < 0.3


def test_api_patterns_endpoints(tmp_path, monkeypatch):
    monkeypatch.setenv("WHISP_DESK_HOME", str(tmp_path / "home"))
    for name in [m for m in list(__import__("sys").modules) if m.startswith("app")]:
        del __import__("sys").modules[name]
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app(), base_url="http://127.0.0.1") as c:
        p = c.post("/api/projects", json={"name": "Patterns Proj", "type": "lecture"}).json()
        pid = p["id"]

        # 1. Проверяем получение каталога паттернов
        cat = c.get(f"/api/projects/{pid}/patterns").json()
        assert "patterns" in cat
        assert len(cat["patterns"]) == 6

        # 2. Создаем dummy план для проверки применения паттерна
        from app.core.fsutil import write_json_atomic
        from pathlib import Path
        plan_path = Path(tmp_path / "home" / "projects" / pid / "timeline" / "edit_plan.json")
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        plan_data = {
            "schema_version": 1,
            "project_id": pid,
            "source": "dummy.mp4",
            "duration_ms": 6000,
            "fps": {"numerator": 25, "denominator": 1},
            "audio_index": 0,
            "segments": [
                {"id": "segment_001", "source_start_ms": 0, "source_end_ms": 2000, "action": "KEEP", "reason": "speech", "reviewed": True},
                {"id": "segment_002", "source_start_ms": 2000, "source_end_ms": 4000, "action": "CUT", "reason": "long_silence", "reviewed": False},
                {"id": "segment_003", "source_start_ms": 4000, "source_end_ms": 6000, "action": "KEEP", "reason": "speech", "reviewed": True},
            ],
        }
        write_json_atomic(plan_path, plan_data)

        # Применяем паттерн podcast_flow через API
        res = c.post(f"/api/projects/{pid}/patterns/apply", json={"pattern_id": "podcast_flow", "params": {"min_pause_ms": 1500}}).json()
        assert "plan" in res
        assert "pattern_result" in res
        assert res["pattern_result"]["pattern_id"] == "podcast_flow"
