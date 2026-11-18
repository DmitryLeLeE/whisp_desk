"""Модуль аналитики речи и эффективности монтажа (Speech & Editing Insights)."""
from __future__ import annotations

import re
from typing import Any


def calculate_insights(
    plan: dict | None,
    cues: list[dict] | None = None,
    meta: dict | None = None,
    lang: str = "ru",
) -> dict[str, Any]:
    cues = cues or []
    total_ms = (meta.get("duration_ms") if meta else 0) or (plan.get("duration_ms", 0) if plan else 0)

    # 1. Анализ таймлайна
    if plan and "segments" in plan:
        kept_ms = sum(s["source_end_ms"] - s["source_start_ms"] for s in plan["segments"] if s["action"] == "KEEP")
        removed_ms = total_ms - kept_ms
        silence_cuts = sum(1 for s in plan["segments"] if s["action"] == "CUT" and "silence" in (s.get("reason") or ""))
        total_cuts = sum(1 for s in plan["segments"] if s["action"] == "CUT")
    else:
        kept_ms = total_ms
        removed_ms = 0
        silence_cuts = 0
        total_cuts = 0

    saved_percent = round((removed_ms / total_ms * 100), 1) if total_ms > 0 else 0.0

    # 2. Анализ речи (слов и скорости)
    total_words = 0
    speech_ms = 0
    for c in cues:
        txt = c.get("text", "").strip()
        words = re.findall(r"\b[\w'-]+\b", txt)
        total_words += len(words)
        dur = max(0, c.get("end_ms", 0) - c.get("start_ms", 0))
        speech_ms += dur

    speech_min = speech_ms / 60000.0
    wpm = round(total_words / speech_min) if speech_min > 0.05 else 0

    if wpm == 0:
        pace = "none"
        pace_label = "Нет речи" if lang == "ru" else "No speech detected"
    elif wpm < 115:
        pace = "slow"
        pace_label = "Спокойный темп (< 115 с/м)" if lang == "ru" else "Relaxed pace (< 115 WPM)"
    elif wpm <= 165:
        pace = "optimal"
        pace_label = "Идеальный темп (115–165 с/м)" if lang == "ru" else "Optimal pace (115–165 WPM)"
    else:
        pace = "fast"
        pace_label = "Быстрый темп (> 165 с/м)" if lang == "ru" else "Fast pace (> 165 WPM)"

    # Оценка эффективности монтажа (1-100)
    # На основе сжатия воды и оптимизации пауз
    efficiency_score = min(100, max(50, int(50 + saved_percent * 1.5)))

    return {
        "total_duration_ms": total_ms,
        "output_duration_ms": kept_ms,
        "removed_duration_ms": removed_ms,
        "saved_percent": saved_percent,
        "total_words": total_words,
        "total_cues": len(cues),
        "speech_duration_ms": speech_ms,
        "wpm": wpm,
        "pace": pace,
        "pace_label": pace_label,
        "silence_cuts": silence_cuts,
        "total_cuts": total_cuts,
        "efficiency_score": efficiency_score,
    }
