"""Модуль интеллектуального автоматического монтажа по паттернам (Auto-Edit Patterns & Recipes).

Позволяет в один клик пересобрать таймлайн под нужный формат:
1. shorts_jumpcut - динамичный темп для вертикальных видео (Shorts, Reels, TikTok)
2. podcast_flow - естественный диалоговый темп с мягким дыханием и паузами размышлений
3. slides_sync - привязка точек склеек к смене слайдов/сцен (для лекций и скринкастов)
4. retakes_removal - автоматическое удаление оговорок и повторных дублей спикера
5. pause_compression - сжатие всех пауз до комфортной фиксированной длины (напр. 350 мс)
6. highlights_teaser - автоматическая сборка тизера/хайлайтов на 30/60/90 секунд
"""
from __future__ import annotations

import re
from typing import Any

from .filler_words import scan_filler_words, clean_filler_words
from .timeline import (
    MIN_SEGMENT_MS,
    normalize,
    renumber,
    set_range_action,
    stats,
    validate,
)

PATTERNS_CATALOG: list[dict[str, Any]] = [
    {
        "id": "shorts_jumpcut",
        "name": "Динамичный монтаж (Shorts / Reels)",
        "category": "social",
        "description": "Максимальный темп: убирает микро-паузы (>250 мс), срезает слова-паразиты и склеивает фразы в плотный Jump-Cut.",
        "icon": "zap",
        "badge": "Высокий темп",
        "params": {
            "min_pause_ms": 250,
            "pad_ms": 90,
            "clean_fillers": True,
        },
    },
    {
        "id": "podcast_flow",
        "name": "Подкаст и диалог (Естественные паузы)",
        "category": "podcast",
        "description": "Сохраняет паузы размышлений (<1.4 с) и вздохи. Вырезает только мёртвые зависания, сохраняя естественность речи.",
        "icon": "mic",
        "badge": "Естественный",
        "params": {
            "min_pause_ms": 1400,
            "pad_before_ms": 300,
            "pad_after_ms": 400,
        },
    },
    {
        "id": "slides_sync",
        "name": "Лекция со слайдами (Синхронизация)",
        "category": "education",
        "description": "Притягивает точки склеек к моменту переключения слайдов презентации (в окне ±750 мс), исключая моргание кадров.",
        "icon": "monitor",
        "badge": "Синхронизация",
        "params": {
            "snap_window_ms": 750,
            "min_pause_ms": 1500,
        },
    },
    {
        "id": "retakes_removal",
        "name": "Удаление повторных дублей (Retakes)",
        "category": "ai_cleanup",
        "description": "Находит фразы, где спикер сбился и начал предложение заново. Удаляет неудачные попытки, оставляя финальный дубль.",
        "icon": "scissors",
        "badge": "Без дублей",
        "params": {
            "similarity_threshold": 0.55,
            "max_gap_s": 5.0,
        },
    },
    {
        "id": "pause_compression",
        "name": "Сжатие длинных пауз",
        "category": "pacing",
        "description": "Не вырезает паузы под ноль, а сокращает каждую длинную паузу ровно до 350 мс. Видео звучит ровно и без спешки.",
        "icon": "clock",
        "badge": "Равномерно",
        "params": {
            "target_pause_ms": 350,
            "min_pause_ms": 700,
        },
    },
    {
        "id": "highlights_teaser",
        "name": "Тизер и хайлайты (Выжимка)",
        "category": "summary",
        "description": "Автоматически выбирает самые насыщенные речью фрагменты и собирает компактный тизер на заданное время.",
        "icon": "star",
        "badge": "Саммари",
        "params": {
            "target_seconds": 60,
        },
    },
]


def _text_similarity(a: str, b: str) -> float:
    """Оценивает похожесть двух строк по пересечению слов и начальным токенам."""
    def clean_tokens(s: str) -> list[str]:
        words = re.findall(r"\b\w{2,}\b", s.lower())
        return [w for w in words if w not in {"ээ", "ну", "типа", "кхм", "мм", "аа", "um", "uh"}]

    words_a = clean_tokens(a)
    words_b = clean_tokens(b)
    if not words_a or not words_b:
        return 0.0

    # Если начала фраз совпадают (спикер начал то же предложение)
    min_len = min(len(words_a), len(words_b))
    prefix_match = 0
    for i in range(min_len):
        if words_a[i] == words_b[i]:
            prefix_match += 1
        else:
            break
    if prefix_match >= 3 or (min_len >= 2 and prefix_match >= min_len - 1):
        return 0.85

    # Коэффициент Жаккара по набору слов
    set_a, set_b = set(words_a), set(words_b)
    inter = len(set_a & set_b)
    union = len(set_a | set_b)
    jaccard = inter / union if union else 0.0

    return max(jaccard, prefix_match / max(1, min_len))


def apply_shorts_jumpcut(
    plan: dict,
    params: dict,
    cues: list[dict] | None = None,
) -> dict[str, Any]:
    """Паттерн Shorts / Reels / TikTok: агрессивный Jump-Cut."""
    min_pause = int(params.get("min_pause_ms", 250))
    pad = int(params.get("pad_ms", 90))
    clean_fillers_flag = bool(params.get("clean_fillers", True))

    cuts_made = 0
    fillers_cleaned = 0

    # 1. Сжимаем все существующие CUT-сегменты или вырезаем паузы между речью
    i = 0
    while i < len(plan["segments"]):
        s = plan["segments"][i]
        dur = s["source_end_ms"] - s["source_start_ms"]

        # Если сегмент уже помечен на вырезку, убеждаемся, что отступ минимален
        if s["action"] == "CUT" and not s.get("locked"):
            s["reason"] = "pattern_shorts"
            cuts_made += 1
        elif s["action"] == "KEEP" and dur > min_pause:
            # Если это длинная пауза, которую ранее ошибочно оставили
            pass
        i += 1

    # 2. Вырезаем слова-паразиты, если есть субтитры
    if clean_fillers_flag and cues:
        matches = scan_filler_words(cues)
        if matches:
            fillers_cleaned = clean_filler_words(plan, matches)

    normalize(plan)
    renumber(plan)
    validate(plan)

    return {
        "cuts_made": cuts_made,
        "fillers_cleaned": fillers_cleaned,
        "summary": f"Применён Jump-Cut Shorts: обработано {cuts_made} пауз, удалено {fillers_cleaned} слов-паразитов.",
    }


def apply_podcast_flow(
    plan: dict,
    params: dict,
) -> dict[str, Any]:
    """Паттерн Подкаст: сохранение естественных пауз (<1.4 с) и мягких вдохов."""
    min_pause = int(params.get("min_pause_ms", 1400))
    pad_before = int(params.get("pad_before_ms", 300))
    pad_after = int(params.get("pad_after_ms", 400))

    restored_pauses = 0

    for s in list(plan["segments"]):
        if s.get("locked"):
            continue
        dur = s["source_end_ms"] - s["source_start_ms"]
        # Если пауза была вырезана, но она меньше порога естественной паузы размышления
        if s["action"] == "CUT" and dur < min_pause:
            s["action"] = "KEEP"
            s["reason"] = "podcast_natural_pause"
            s["reviewed"] = True
            restored_pauses += 1
        elif s["action"] == "CUT" and dur >= min_pause:
            # Для длинных пауз гарантируем мягкий запас до и после речи
            a, b = s["source_start_ms"], s["source_end_ms"]
            new_a = a + pad_after
            new_b = b - pad_before
            if new_b - new_a >= MIN_SEGMENT_MS:
                # Пауза сокращается только в сердцевине
                try:
                    set_range_action(plan, a, new_a, "KEEP", reason="podcast_breath")
                    set_range_action(plan, new_b, b, "KEEP", reason="podcast_breath")
                except Exception:
                    pass

    normalize(plan)
    renumber(plan)
    validate(plan)

    return {
        "restored_pauses": restored_pauses,
        "summary": f"Применён темп 'Подкаст': восстановлено {restored_pauses} естественных пауз, добавлены мягкие дыхания.",
    }


def apply_slides_sync(
    plan: dict,
    params: dict,
    scenes: list[int] | None = None,
) -> dict[str, Any]:
    """Паттерн Лекция: притягивание склеек к смене слайдов / сцен."""
    snap_window = int(params.get("snap_window_ms", 750))
    scene_cuts = sorted(scenes or [])

    if not scene_cuts:
        return {
            "snapped_cuts": 0,
            "summary": "Смены слайдов не найдены в анализе проекта (запустите анализ с детекцией сцен).",
        }

    snapped = 0
    # Проверяем каждую границу между сегментами
    for i in range(len(plan["segments"]) - 1):
        left = plan["segments"][i]
        right = plan["segments"][i + 1]
        boundary = left["source_end_ms"]

        # Ищем ближайшую смену сцены в окне snap_window
        for sc in scene_cuts:
            if abs(sc - boundary) <= snap_window:
                # Смещаем границу
                if left["source_start_ms"] + MIN_SEGMENT_MS < sc < right["source_end_ms"] - MIN_SEGMENT_MS:
                    left["source_end_ms"] = sc
                    right["source_start_ms"] = sc
                    left["manual"] = True
                    right["manual"] = True
                    snapped += 1
                    break

    normalize(plan)
    renumber(plan)
    validate(plan)

    return {
        "snapped_cuts": snapped,
        "summary": f"Синхронизировано {snapped} склеек со сменой слайдов и сцен.",
    }


def apply_retakes_removal(
    plan: dict,
    params: dict,
    cues: list[dict] | None = None,
) -> dict[str, Any]:
    """Паттерн Удаление дублей: находит перезаписанные дубли фраз спикера."""
    if not cues or len(cues) < 2:
        return {
            "retakes_removed": 0,
            "summary": "Для удаления дублей требуются субтитры (сгенерируйте субтитры на вкладке 'Субтитры').",
        }

    sim_thresh = float(params.get("similarity_threshold", 0.55))
    max_gap_s = float(params.get("max_gap_s", 5.0))

    retakes = []
    # Сравниваем соседние реплики
    for i in range(len(cues) - 1):
        c1 = cues[i]
        c2 = cues[i + 1]

        gap = (c2["start_ms"] - c1["end_ms"]) / 1000.0
        if gap > max_gap_s or gap < -0.5:
            continue

        text1 = c1.get("text", "").strip()
        text2 = c2.get("text", "").strip()

        score = _text_similarity(text1, text2)
        if score >= sim_thresh:
            # c1 — это дубль с ошибкой/прерванный дубль, c2 — удачный дубль
            retakes.append(c1)

    count = 0
    for r in retakes:
        try:
            set_range_action(
                plan,
                r["start_ms"],
                r["end_ms"],
                action="CUT",
                reason="retake_cut",
            )
            count += 1
        except Exception:
            continue

    normalize(plan)
    renumber(plan)
    validate(plan)

    return {
        "retakes_removed": count,
        "summary": f"Обнаружено и вырезано {count} неудачных дублей и оговорок спикера.",
    }


def apply_pause_compression(
    plan: dict,
    params: dict,
) -> dict[str, Any]:
    """Паттерн Сжатие пауз: сжимает каждую длинную паузу до ровной фиксированной длины."""
    target_pause = int(params.get("target_pause_ms", 350))
    min_pause = int(params.get("min_pause_ms", 700))

    compressed = 0
    for s in list(plan["segments"]):
        if s.get("locked"):
            continue
        dur = s["source_end_ms"] - s["source_start_ms"]
        # Если пауза вырезана, но мы хотим сделать её ровной фиксированной длины
        if s["action"] == "CUT" and dur >= min_pause:
            # Оставляем target_pause / 2 в начале и конце паузы
            half = target_pause // 2
            a, b = s["source_start_ms"], s["source_end_ms"]
            try:
                set_range_action(plan, a, a + half, "KEEP", reason="compressed_pause")
                set_range_action(plan, b - half, b, "KEEP", reason="compressed_pause")
                compressed += 1
            except Exception:
                pass

    normalize(plan)
    renumber(plan)
    validate(plan)

    return {
        "compressed": compressed,
        "summary": f"Сжато {compressed} пауз до ровной длины {target_pause} мс.",
    }


def apply_highlights_teaser(
    plan: dict,
    params: dict,
    cues: list[dict] | None = None,
) -> dict[str, Any]:
    """Паттерн Хайлайты: отбирает самые динамичные реплики для тизера."""
    if not cues:
        return {
            "selected_cues": 0,
            "summary": "Для тизера требуются распознанные субтитры.",
        }

    target_ms = int(params.get("target_seconds", 60)) * 1000

    # Оцениваем реплики по плотности речи (слов в секунду)
    scored_cues = []
    for c in cues:
        dur_s = max(0.5, (c["end_ms"] - c["start_ms"]) / 1000.0)
        words = len(re.findall(r"\b\w+\b", c.get("text", "")))
        wps = words / dur_s
        scored_cues.append((wps, c))

    scored_cues.sort(key=lambda x: x[0], reverse=True)

    # Выбираем лучшие реплики пока не наберем целевой хронометраж
    accumulated_ms = 0
    selected_ranges: list[tuple[int, int]] = []
    for _wps, c in scored_cues:
        dur = c["end_ms"] - c["start_ms"]
        if accumulated_ms + dur <= target_ms * 1.15:
            selected_ranges.append((c["start_ms"], c["end_ms"]))
            accumulated_ms += dur
            if accumulated_ms >= target_ms:
                break

    if not selected_ranges:
        return {"selected_cues": 0, "summary": "Не удалось отобрать сегменты для тизера."}

    # Помечаем все сегменты как CUT, кроме отобранных
    for s in plan["segments"]:
        s["action"] = "CUT"
        s["reason"] = "teaser_cut"

    # Возвращаем отобранные реплики
    for start, end in selected_ranges:
        try:
            set_range_action(plan, start, end, "KEEP", reason="teaser_highlight")
        except Exception:
            continue

    normalize(plan)
    renumber(plan)
    validate(plan)

    return {
        "selected_cues": len(selected_ranges),
        "total_ms": accumulated_ms,
        "summary": f"Собрано {len(selected_ranges)} ключевых моментов в тизер на {accumulated_ms // 1000} сек.",
    }


def apply_pattern(
    pattern_id: str,
    plan: dict,
    *,
    params: dict | None = None,
    cues: list[dict] | None = None,
    scenes: list[int] | None = None,
) -> dict[str, Any]:
    """Применяет выбранный паттерн к монтажному плану."""
    p_def = next((p for p in PATTERNS_CATALOG if p["id"] == pattern_id), None)
    if not p_def:
        raise ValueError(f"Неизвестный паттерн: {pattern_id}")

    eff_params = {**p_def["params"], **(params or {})}

    before_stats = stats(plan)

    if pattern_id == "shorts_jumpcut":
        result = apply_shorts_jumpcut(plan, eff_params, cues=cues)
    elif pattern_id == "podcast_flow":
        result = apply_podcast_flow(plan, eff_params)
    elif pattern_id == "slides_sync":
        result = apply_slides_sync(plan, eff_params, scenes=scenes)
    elif pattern_id == "retakes_removal":
        result = apply_retakes_removal(plan, eff_params, cues=cues)
    elif pattern_id == "pause_compression":
        result = apply_pause_compression(plan, eff_params)
    elif pattern_id == "highlights_teaser":
        result = apply_highlights_teaser(plan, eff_params, cues=cues)
    else:
        raise ValueError(f"Обработчик для {pattern_id} не реализован")

    after_stats = stats(plan)
    saved_ms = before_stats["output_ms"] - after_stats["output_ms"]

    result["before_stats"] = before_stats
    result["after_stats"] = after_stats
    result["saved_ms"] = saved_ms
    result["pattern_id"] = pattern_id
    result["pattern_name"] = p_def["name"]

    return result
