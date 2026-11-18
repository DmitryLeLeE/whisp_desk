"""Генератор умных глав (YouTube Chapters / оглавление видео).

Разбивает расшифровку и монтажный план на смысловые разделы на основе:
- Длинных пауз в речи
- Смен сцен (visual scene boundaries)
- Вопросов и вводных речевых маркеров
- Форматирует готовые таймкоды для описания YouTube и плееров
"""
from __future__ import annotations

import re
from typing import Any

from .timeline import kept_ranges


FILLER_PREFIXES = re.compile(
    r"^(ну|итак|давайте|перейдём к|во-первых|во-вторых|в-третьих|теперь|далее|следующий вопрос|что касается|так вот|кстати|so|now|let's|next|first|finally|well)\s*,?\s*",
    re.IGNORECASE,
)


def _clean_title(text: str, max_len: int = 45) -> str:
    """Очищает строку от слов-паразитов и сокращает до компактного названия главы."""
    t = text.strip()
    t = FILLER_PREFIXES.sub("", t)
    t = re.sub(r'[\r\n\t]+', ' ', t)
    t = re.sub(r'[«»""\']', '', t)
    # берём первое предложение (до знака препинания)
    first_sentence = re.split(r'[.!?…]+(\s+|$)', t)[0].strip()
    if not first_sentence:
        first_sentence = t.rstrip(".!?:,; ")
    if len(first_sentence) > max_len:
        first_sentence = first_sentence[:max_len].rsplit(' ', 1)[0] + '…'
    return first_sentence.capitalize() if first_sentence else "Раздел"


def generate_smart_chapters(
    cues: list[dict],
    plan: dict | None = None,
    scenes: list[int] | None = None,
    min_interval_s: int = 60,
    lang: str = "ru",
) -> list[dict[str, Any]]:
    """Создаёт смысловое оглавление с таймкодами."""
    if not cues and not plan:
        return [{"time_ms": 0, "title": "Введение" if lang == "ru" else "Intro"}]

    ranges = kept_ranges(plan) if plan else None
    
    # Карта соответствия: время источника -> время в смонтированном видео
    def src_to_out(src_ms: int) -> int:
        if not ranges:
            return src_ms
        out_ms = 0
        for a, b in ranges:
            if src_ms < a:
                return out_ms
            if a <= src_ms <= b:
                return out_ms + (src_ms - a)
            out_ms += b - a
        return out_ms

    chapters: list[dict[str, Any]] = [
        {"time_ms": 0, "source_ms": 0, "title": "Введение" if lang == "ru" else "Intro"}
    ]

    last_ms = 0
    min_ms = min_interval_s * 1000

    scene_set = set(scenes or [])

    # Ищем кандидаты на разделы среди реплик
    for i, cue in enumerate(cues):
        cur_ms = cue.get("start_ms", 0)
        out_ms = src_to_out(cur_ms)
        
        # Проверяем минимальный интервал от предыдущей главы
        if out_ms - last_ms < min_ms:
            continue

        prev_cue = cues[i - 1] if i > 0 else None
        gap_ms = (cur_ms - prev_cue["end_ms"]) if prev_cue else 0

        # Признаки смысловой границы:
        # 1. Заметная пауза в речи (> 1.8 с)
        # 2. Смена сцены рядом (в пределах 2 сек)
        # 3. Вопросительное предложение или фраза-маркер
        is_scene_boundary = any(abs(cur_ms - s) < 2000 for s in scene_set)
        is_long_pause = gap_ms >= 1800
        text = cue.get("text", "")
        is_intro_marker = bool(FILLER_PREFIXES.match(text))

        if is_scene_boundary or is_long_pause or is_intro_marker:
            title = _clean_title(text)
            if not title or len(title) < 3:
                title = f"Раздел {len(chapters) + 1}" if lang == "ru" else f"Section {len(chapters) + 1}"
            chapters.append({
                "time_ms": out_ms,
                "source_ms": cur_ms,
                "title": title,
            })
            last_ms = out_ms

    # Если реплик было мало, добавляем заключение при достаточной длительности
    total_ms = sum(b - a for a, b in ranges) if ranges else (plan.get("duration_ms", 0) if plan else 0)
    if total_ms - last_ms > min_ms and len(chapters) > 1:
        outro_title = "Заключение и выводы" if lang == "ru" else "Conclusion & Outro"
        chapters.append({
            "time_ms": max(0, total_ms - 45000),
            "source_ms": max(0, total_ms - 45000),
            "title": outro_title,
        })

    return chapters


def format_chapters_text(chapters: list[dict[str, Any]]) -> str:
    """Форматирует список глав в стандартный текст YouTube:
    00:00 Введение
    01:25 Основная тема
    ...
    """
    lines = []
    for ch in chapters:
        ms = ch.get("time_ms", 0)
        s = ms // 1000
        m, sec = divmod(s, 60)
        h, m = divmod(m, 60)
        ts = f"{h:02d}:{m:02d}:{sec:02d}" if h > 0 else f"{m:02d}:{sec:02d}"
        lines.append(f"{ts} {ch.get('title', 'Глава')}")
    return "\n".join(lines) + "\n"
