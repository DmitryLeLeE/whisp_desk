"""Генерация структурированного описания, шоу-ноутов и постов для YouTube и Telegram."""
from __future__ import annotations

import re
from typing import Any


def _format_time(ms: int) -> str:
    s = ms // 1000
    m, sec = divmod(s, 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h:02d}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"


def generate_show_notes(
    project_name: str,
    cues: list[dict],
    chapters: list[dict] | None = None,
    duration_ms: int = 0,
) -> dict[str, Any]:
    """Формирует структурированное описание ролика, тезисы, таймкоды и готовые посты."""
    # Собираем очищенный текст реплик
    sentences: list[str] = []
    for c in cues:
        t = c.get("text", "").strip()
        if t and len(t) > 10 and not t.startswith("["):
            sentences.append(t)

    # Выделяем ключевые тезисы (до 4 самых ёмких предложений)
    clean_sentences = [
        s for s in sentences
        if len(s) > 25 and not any(w in s.lower() for w in ["эээ", "ммм", "короче", "типа", "ну вот"])
    ]
    highlights = clean_sentences[:4] if clean_sentences else (sentences[:3] if sentences else ["Ключевые моменты обсуждаются в выпуске."])

    # Краткое саммари
    summary_text = " ".join(highlights[:2]) if highlights else f"Обзор темы: {project_name}."

    # Формируем список глав / таймкодов
    timecodes_list: list[dict[str, Any]] = []
    if chapters and len(chapters) > 0:
        timecodes_list = chapters
    else:
        # Автоматические таймкоды по началу и каждые ~45-60 секунд при наличии реплик
        timecodes_list.append({"time_ms": 0, "title": "Начало / Введение"})
        last_ms = 0
        step_ms = 60000
        for c in cues:
            start_ms = c.get("start_ms", 0)
            if start_ms - last_ms >= step_ms:
                txt = c.get("text", "").strip()[:40]
                if txt:
                    timecodes_list.append({"time_ms": start_ms, "title": txt})
                    last_ms = start_ms

    formatted_timecodes = "\n".join(f"{_format_time(tc['time_ms'])} {tc['title']}" for tc in timecodes_list)

    # Генерация хештегов из слов
    words = re.findall(r"\b[А-Яа-яA-Za-z]{5,}\b", " ".join(sentences).lower())
    common_stop = {"когда", "только", "потому", "просто", "можно", "нужно", "сейчас", "будет", "чтобы", "после", "также"}
    tags_pool = [w for w in set(words) if w not in common_stop][:6]
    hashtags = " ".join(f"#{w}" for w in tags_pool) if tags_pool else "#видео #контент #whisp"

    # Шаблон описания для YouTube
    yt_description = (
        f"{project_name}\n\n"
        f"📌 О выпуске:\n{summary_text}\n\n"
        f"⏱️ Таймкоды:\n{formatted_timecodes}\n\n"
        f"Теги:\n{hashtags}"
    )

    # Шаблон поста для Telegram
    tg_bullets = "\n".join(f"• {h}" for h in highlights)
    tg_post = (
        f"🎬 <b>{project_name}</b>\n\n"
        f"💡 <b>Главные тезисы выпуска:</b>\n"
        f"{tg_bullets}\n\n"
        f"⏱️ <b>Таймкоды:</b>\n"
        f"{formatted_timecodes}\n\n"
        f"{hashtags}"
    )

    return {
        "title": project_name,
        "summary": summary_text,
        "highlights": highlights,
        "timecodes": timecodes_list,
        "formatted_timecodes": formatted_timecodes,
        "youtube_description": yt_description,
        "telegram_post": tg_post,
        "tags": tags_pool,
    }
