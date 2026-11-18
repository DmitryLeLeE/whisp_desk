"""Детектор и автоматическая вырезка слов-паразитов и речевых запинок."""
from __future__ import annotations

import re
from typing import Any

from .timeline import set_range_action

# Паттерны слов-паразитов и звуков заминки
FILLER_PATTERNS = [
    # Русские запинки и слова-паразиты
    re.compile(r"\b(э{2,}|э-э-?э*|м{2,}|м-м-?м*|а{2,}|а-а-?а*)\b", re.IGNORECASE),
    re.compile(r"\b(ну|типа|как бы|короче|в общем|так сказать|значит|собственно говоря|то есть)\b", re.IGNORECASE),
    # Английские запинки и слова-паразиты
    re.compile(r"\b(um+|uh+|er+|ah+|like|you know|sort of|kind of|basically|actually|literally|i mean)\b", re.IGNORECASE),
]


def scan_filler_words(cues: list[dict]) -> list[dict[str, Any]]:
    """Находит все слова-паразиты в репликах с таймкодами для вырезки."""
    matches = []
    counter = 0

    for c_idx, cue in enumerate(cues):
        text = cue.get("text", "")
        c_start = cue.get("start_ms", 0)
        c_end = cue.get("end_ms", 0)
        c_dur = max(1, c_end - c_start)
        t_len = max(1, len(text))

        # Если в Whisper есть точные таймкоды слов
        words_data = cue.get("words")

        for pat in FILLER_PATTERNS:
            for m in pat.finditer(text):
                w_str = m.group(0).strip()
                if not w_str:
                    continue

                start_char, end_char = m.start(), m.end()

                if words_data and isinstance(words_data, list):
                    # Ищем подходящее слово в words_data
                    best_w = None
                    for w in words_data:
                        if w.get("word", "").strip().lower() == w_str.lower():
                            best_w = w
                            break
                    if best_w:
                        w_start = best_w.get("start_ms", c_start)
                        w_end = best_w.get("end_ms", c_end)
                    else:
                        w_start = c_start + int(start_char / t_len * c_dur)
                        w_end = c_start + int(end_char / t_len * c_dur)
                else:
                    w_start = c_start + int(start_char / t_len * c_dur)
                    w_end = c_start + int(end_char / t_len * c_dur)

                # Добавляем небольшой запас для естественного затухания
                w_start = max(0, w_start - 30)
                w_end = min(c_end + 30, w_end + 30)

                if w_end > w_start:
                    matches.append({
                        "id": f"filler_{counter}",
                        "cue_idx": c_idx,
                        "word": w_str,
                        "start_ms": w_start,
                        "end_ms": w_end,
                        "duration_ms": w_end - w_start,
                        "context": text,
                    })
                    counter += 1

    return matches


def clean_filler_words(plan: dict, matches: list[dict[str, Any]]) -> int:
    """Вырезает найденные слова-паразиты из монтажного плана."""
    count = 0
    for m in matches:
        try:
            set_range_action(plan, m["start_ms"], m["end_ms"], action="CUT", reason="filler_word")
            count += 1
        except Exception:
            continue
    return count
