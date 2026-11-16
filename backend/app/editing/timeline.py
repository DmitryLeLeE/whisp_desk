"""Операции над монтажным планом (edit_plan.json). Все функции изменяют план на месте.

Инварианты: сегменты идут подряд без пропусков и пересечений от 0 до duration_ms.
Исходный файл никогда не затрагивается.
"""
from __future__ import annotations

from typing import Iterable

SCHEMA_VERSION = 1
ACTIONS = ("KEEP", "CUT")
MIN_SEGMENT_MS = 1


class TimelineError(ValueError):
    pass


def _flags(seg: dict) -> tuple:
    return (seg["action"], seg["reason"], seg.get("reviewed", False), seg.get("locked", False), seg.get("manual", False))


def validate(plan: dict) -> None:
    if plan.get("schema_version") != SCHEMA_VERSION:
        raise TimelineError(f"Неподдерживаемая версия схемы: {plan.get('schema_version')}")
    segs = plan["segments"]
    pos = 0
    for s in segs:
        if s["action"] not in ACTIONS:
            raise TimelineError(f"Недопустимое действие {s['action']!r} в {s['id']}")
        if s["source_start_ms"] != pos:
            raise TimelineError(f"Разрыв или пересечение перед {s['id']}: ожидалось {pos}, получено {s['source_start_ms']}")
        if s["source_end_ms"] <= s["source_start_ms"]:
            raise TimelineError(f"Пустой сегмент {s['id']}")
        pos = s["source_end_ms"]
    if segs and pos != plan["duration_ms"]:
        raise TimelineError("Сегменты не покрывают весь исходник")


def normalize(plan: dict) -> None:
    """Склеивает соседние сегменты с одинаковыми решением и признаками."""
    out: list[dict] = []
    for s in plan["segments"]:
        if out and _flags(out[-1]) == _flags(s) and out[-1]["source_end_ms"] == s["source_start_ms"]:
            out[-1]["source_end_ms"] = s["source_end_ms"]
        else:
            out.append(s)
    plan["segments"] = out


def renumber(plan: dict) -> None:
    for i, s in enumerate(plan["segments"], 1):
        s["id"] = f"segment_{i:03d}"


def _new_id(plan: dict) -> str:
    nums = [int(s["id"].split("_")[-1]) for s in plan["segments"] if s["id"].split("_")[-1].isdigit()]
    return f"segment_{(max(nums) if nums else 0) + 1:03d}"


def index_of(plan: dict, seg_id: str) -> int:
    for i, s in enumerate(plan["segments"]):
        if s["id"] == seg_id:
            return i
    raise TimelineError(f"Сегмент не найден: {seg_id}")


def _clone(plan: dict, seg: dict, start: int, end: int) -> dict:
    c = dict(seg)
    c["id"] = _new_id(plan)
    c["source_start_ms"], c["source_end_ms"] = start, end
    return c


def set_action(plan: dict, seg_id: str, action: str, reason: str | None = None) -> None:
    if action not in ACTIONS:
        raise TimelineError(f"Недопустимое действие: {action}")
    seg = plan["segments"][index_of(plan, seg_id)]
    if action == "CUT" and seg.get("locked"):
        raise TimelineError("Фрагмент помечен как обязательный к сохранению. Снимите отметку, чтобы удалить его.")
    seg["action"] = action
    seg["reason"] = reason or ("manual_cut" if action == "CUT" else "manual_keep")
    seg["manual"] = True
    seg["reviewed"] = True


def set_range_action(plan: dict, start_ms: int, end_ms: int, action: str, reason: str | None = None) -> None:
    """Применяет решение к произвольному интервалу, при необходимости разрезая сегменты по краям."""
    if action not in ACTIONS:
        raise TimelineError(f"Недопустимое действие: {action}")
    start_ms, end_ms = max(0, start_ms), min(plan["duration_ms"], end_ms)
    if end_ms - start_ms < MIN_SEGMENT_MS:
        raise TimelineError("Интервал пуст или выходит за пределы записи")
    reason = reason or ("manual_cut" if action == "CUT" else "manual_keep")
    out: list[dict] = []
    for s in plan["segments"]:
        a, b = s["source_start_ms"], s["source_end_ms"]
        if b <= start_ms or a >= end_ms:
            out.append(s)
            continue
        if a < start_ms:
            out.append(_clone(plan_with(plan, out), s, a, start_ms))
        mid_a, mid_b = max(a, start_ms), min(b, end_ms)
        if action == "CUT" and s.get("locked"):
            out.append(_clone(plan_with(plan, out), s, mid_a, mid_b))   # обязательные фрагменты не режем
        else:
            m = _clone(plan_with(plan, out), s, mid_a, mid_b)
            m.update(action=action, reason=reason, manual=True, reviewed=True)
            out.append(m)
        if b > end_ms:
            out.append(_clone(plan_with(plan, out), s, end_ms, b))
    plan["segments"] = out
    normalize(plan)


def plan_with(plan: dict, segments: list[dict]) -> dict:
    """Вспомогательный вид плана для генерации уникальных id при построении нового списка."""
    existing = plan["segments"] + segments
    return {"segments": existing}


def move_boundary(plan: dict, left_id: str, new_ms: int) -> None:
    """Сдвигает границу между сегментом left_id и следующим."""
    i = index_of(plan, left_id)
    if i >= len(plan["segments"]) - 1:
        raise TimelineError("У последнего сегмента нет правой границы")
    left, right = plan["segments"][i], plan["segments"][i + 1]
    if not (left["source_start_ms"] + MIN_SEGMENT_MS <= new_ms <= right["source_end_ms"] - MIN_SEGMENT_MS):
        raise TimelineError("Граница должна оставаться внутри соседних сегментов")
    left["source_end_ms"] = right["source_start_ms"] = int(new_ms)
    for s in (left, right):
        s["manual"] = True
        s["reviewed"] = True


def split(plan: dict, seg_id: str, at_ms: int) -> tuple[str, str]:
    i = index_of(plan, seg_id)
    s = plan["segments"][i]
    if not (s["source_start_ms"] < at_ms < s["source_end_ms"]):
        raise TimelineError("Точка разделения должна лежать внутри сегмента")
    right = _clone(plan, s, at_ms, s["source_end_ms"])
    s["source_end_ms"] = at_ms
    plan["segments"].insert(i + 1, right)
    return s["id"], right["id"]


def merge(plan: dict, first_id: str, second_id: str, action: str | None = None) -> str:
    i, j = index_of(plan, first_id), index_of(plan, second_id)
    if j != i + 1:
        raise TimelineError("Объединять можно только соседние сегменты (первый, затем второй)")
    a, b = plan["segments"][i], plan["segments"][j]
    if a["action"] != b["action"] and action is None:
        raise TimelineError("У сегментов разные решения: укажите итоговое действие")
    final = action or a["action"]
    if final == "CUT" and (a.get("locked") or b.get("locked")):
        raise TimelineError("Нельзя удалить фрагмент, помеченный как обязательный")
    a["source_end_ms"] = b["source_end_ms"]
    if final != a["action"] or a["action"] != b["action"]:
        a["action"], a["reason"] = final, "manual_cut" if final == "CUT" else "manual_keep"
    a["locked"] = bool(a.get("locked") or b.get("locked"))
    a["manual"] = True
    a["reviewed"] = True
    del plan["segments"][j]
    return a["id"]


def set_locked(plan: dict, seg_id: str, locked: bool) -> None:
    s = plan["segments"][index_of(plan, seg_id)]
    if locked and s["action"] == "CUT":
        s["action"], s["reason"] = "KEEP", "manual_keep"
    s["locked"] = locked
    s["manual"] = True
    s["reviewed"] = True


def set_reviewed(plan: dict, seg_ids: Iterable[str] | None, reviewed: bool = True) -> None:
    ids = set(seg_ids) if seg_ids is not None else None
    for s in plan["segments"]:
        if ids is None or s["id"] in ids:
            s["reviewed"] = reviewed


# ---------- вычисления для рендера и субтитров ----------

def snap_ms(ms: int, fps: dict | None) -> int:
    """Округляет время до границы кадра."""
    if not fps:
        return int(ms)
    num, den = fps["numerator"], fps["denominator"]
    frame = round(ms * num / (1000 * den))
    return round(frame * 1000 * den / num)


def kept_ranges(plan: dict, snap: bool = True) -> list[tuple[int, int]]:
    """Сохраняемые интервалы источника (мс), по возможности на границах кадров; пустые отбрасываются."""
    fps = plan.get("fps") if snap else None
    out: list[tuple[int, int]] = []
    for s in plan["segments"]:
        if s["action"] != "KEEP":
            continue
        a, b = snap_ms(s["source_start_ms"], fps), snap_ms(s["source_end_ms"], fps)
        if b <= a:
            continue
        if out and out[-1][1] >= a:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def output_duration_ms(plan: dict) -> int:
    return sum(b - a for a, b in kept_ranges(plan))


def stats(plan: dict) -> dict:
    kept = output_duration_ms(plan)
    total = plan["duration_ms"]
    return {
        "source_ms": total, "output_ms": kept, "removed_ms": total - kept,
        "segments": len(plan["segments"]),
        "unreviewed": sum(1 for s in plan["segments"] if not s.get("reviewed")),
    }
