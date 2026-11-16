"""Сравнение двух наборов сокращений (например, встроенного детектора и Auto-Editor)."""
from __future__ import annotations


def cut_intervals(plan: dict) -> list[tuple[int, int]]:
    return [(s["source_start_ms"], s["source_end_ms"]) for s in plan["segments"] if s["action"] == "CUT"]


def _total(iv: list[tuple[int, int]]) -> int:
    return sum(b - a for a, b in iv)


def _overlap(x: list[tuple[int, int]], y: list[tuple[int, int]]) -> int:
    """Суммарная длина пересечения двух списков непересекающихся отсортированных интервалов."""
    i = j = total = 0
    while i < len(x) and j < len(y):
        lo, hi = max(x[i][0], y[j][0]), min(x[i][1], y[j][1])
        if hi > lo:
            total += hi - lo
        if x[i][1] < y[j][1]:
            i += 1
        else:
            j += 1
    return total


def compare(a: list[tuple[int, int]], b: list[tuple[int, int]], names: tuple[str, str]) -> dict:
    inter = _overlap(a, b)
    ta, tb = _total(a), _total(b)
    union = ta + tb - inter
    return {
        names[0]: {"cuts": len(a), "cut_ms": ta},
        names[1]: {"cuts": len(b), "cut_ms": tb},
        "overlap_ms": inter,
        f"only_{names[0]}_ms": ta - inter,
        f"only_{names[1]}_ms": tb - inter,
        "agreement": round(inter / union, 3) if union else 1.0,
    }
