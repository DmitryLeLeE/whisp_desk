"""Построение чернового монтажного плана из интервалов тишины."""
from __future__ import annotations

from typing import Any

from ..editing.timeline import SCHEMA_VERSION, normalize, renumber

# Параметры в секундах и dBFS. Значения редактируются пользователем.
PROFILES: dict[str, dict[str, Any]] = {
    "careful": {
        "label": "Осторожный", "noise_db": -40.0, "min_pause_s": 2.0, "pad_before_s": 0.5,
        "pad_after_s": 0.6, "min_keep_s": 0.0, "low_volume_db": None, "low_volume_min_s": None,
    },
    "standard": {
        "label": "Стандартный", "noise_db": -35.0, "min_pause_s": 1.2, "pad_before_s": 0.35,
        "pad_after_s": 0.5, "min_keep_s": 0.4, "low_volume_db": None, "low_volume_min_s": None,
    },
    "aggressive": {
        "label": "Агрессивный", "noise_db": -32.0, "min_pause_s": 0.7, "pad_before_s": 0.2,
        "pad_after_s": 0.3, "min_keep_s": 0.5, "low_volume_db": -26.0, "low_volume_min_s": 3.0,
    },
}
MIN_CUT_MS = 100  # более короткие сокращения не имеют смысла


def profile_params(name: str, overrides: dict | None = None) -> dict:
    if name not in PROFILES:
        raise ValueError(f"Неизвестный профиль: {name}")
    params = {**PROFILES[name], **{k: v for k, v in (overrides or {}).items() if k in PROFILES[name]}}
    return params


def _cuts_from_silence(silences: list[dict], duration_ms: int, params: dict, reason_mid: str) -> list[dict]:
    """Сокращаем только середину паузы: перед речью и после неё оставляем запас."""
    pad_before = round(params["pad_before_s"] * 1000)   # запас до речи (конец паузы)
    pad_after = round(params["pad_after_s"] * 1000)     # запас после речи (начало паузы)
    cuts = []
    for s in silences:
        a, b = s["start_ms"], s["end_ms"]
        at_start = a <= 0
        at_end = b >= duration_ms
        if at_start and at_end:
            continue  # весь файл тих — ничего не режем автоматически
        if at_start:
            start, end, reason = 0, b - pad_before, "opening_trim"
        elif at_end:
            start, end, reason = a + pad_after, duration_ms, "ending_trim"
        else:
            start, end, reason = a + pad_after, b - pad_before, reason_mid
        if end - start >= MIN_CUT_MS:
            cuts.append({"start_ms": start, "end_ms": end, "reason": reason})
    return cuts


def build_plan(*, project_id: str, source: str, duration_ms: int, fps: dict, audio_index: int,
               silence: list[dict], params: dict, low_volume: list[dict] | None = None) -> dict:
    cuts = _cuts_from_silence(silence, duration_ms, params, "long_silence")
    if low_volume:
        extra = _cuts_from_silence(low_volume, duration_ms, params, "low_volume")
        for c in extra:  # добавляем только то, что не пересекается с уже найденным
            if not any(c["start_ms"] < o["end_ms"] and o["start_ms"] < c["end_ms"] for o in cuts):
                cuts.append(c)
    cuts.sort(key=lambda c: c["start_ms"])

    # Склеиваем пересекающиеся и вплотную идущие сокращения.
    merged: list[dict] = []
    for c in cuts:
        if merged and c["start_ms"] <= merged[-1]["end_ms"]:
            merged[-1]["end_ms"] = max(merged[-1]["end_ms"], c["end_ms"])
        else:
            merged.append(dict(c))

    segments: list[dict] = []
    pos = 0
    for c in merged:
        if c["start_ms"] > pos:
            segments.append(_seg(pos, c["start_ms"], "KEEP", "speech"))
        segments.append(_seg(c["start_ms"], c["end_ms"], "CUT", c["reason"]))
        pos = c["end_ms"]
    if pos < duration_ms:
        segments.append(_seg(pos, duration_ms, "KEEP", "speech"))

    # Слишком короткие сохраняемые фрагменты между сокращениями — вероятно, щелчки. Режем, но оставляем на проверку.
    min_keep = round(params.get("min_keep_s", 0) * 1000)
    if min_keep:
        for i, s in enumerate(segments):
            inner = 0 < i < len(segments) - 1
            if s["action"] == "KEEP" and inner and s["source_end_ms"] - s["source_start_ms"] < min_keep:
                s["action"], s["reason"] = "CUT", "low_volume"

    if segments and segments[0]["action"] == "KEEP" and segments[0]["reason"] == "speech" and segments[0]["source_start_ms"] == 0:
        segments[0]["reason"] = "opening"

    plan = {
        "schema_version": SCHEMA_VERSION,
        "project_id": project_id,
        "source": source,
        "duration_ms": duration_ms,
        "fps": fps,
        "audio_stream": audio_index,
        "segments": segments,
        "export": {"format": "mp4", "video_codec": "h264", "audio_codec": "aac"},
    }
    normalize(plan)
    renumber(plan)
    return plan


def _seg(a: int, b: int, action: str, reason: str) -> dict:
    return {"id": "", "source_start_ms": a, "source_end_ms": b, "action": action,
            "reason": reason, "reviewed": False, "locked": False, "manual": False}
