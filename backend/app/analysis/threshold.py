"""Подбор порога громкости по огибающей записи: между уровнем фона и уровнем речи."""
from __future__ import annotations

import math

MIN_DB, MAX_DB = -50.0, -25.0


def _db(x: float) -> float:
    return 20 * math.log10(max(x, 1e-5))


def suggest_threshold(peaks: list[float]) -> dict:
    """peaks — пики на окно (0..1). Возвращает рекомендацию и уровни, по которым она получена.

    Фон — 10-й, речь — 90-й процентиль уровней. Порог лежит на четверти пути от фона к речи
    и ограничен диапазоном [-50, -25] dBFS. Это стартовое значение, а не истина: проверьте на записи.
    """
    if len(peaks) < 20:
        raise ValueError("Слишком короткая запись для подбора порога")
    levels = sorted(_db(p) for p in peaks)
    pick = lambda q: levels[min(len(levels) - 1, int(q * len(levels)))]  # noqa: E731
    floor, speech = max(pick(0.10), -70.0), pick(0.90)
    if speech - floor < 10:
        # почти нет разницы между фоном и речью: ставим осторожное значение
        value = MIN_DB if floor < MIN_DB else min(MAX_DB, floor + 3)
        confident = False
    else:
        value = floor + 0.25 * (speech - floor)
        confident = True
    value = round(max(MIN_DB, min(MAX_DB, value)))
    return {"noise_db": value, "floor_db": round(floor, 1), "speech_db": round(speech, 1), "confident": confident}
