import pytest

from app.editing import timeline as T
from conftest import make_plan


def base():
    return make_plan([(0, 4000, "KEEP"), (4000, 6000, "CUT"), (6000, 10000, "KEEP")])


def spans(plan):
    return [(s["source_start_ms"], s["source_end_ms"], s["action"]) for s in plan["segments"]]


def test_validate_rejects_gap():
    p = base()
    p["segments"][1]["source_start_ms"] = 4100
    with pytest.raises(T.TimelineError):
        T.validate(p)


def test_set_action_restores_cut_and_marks_reviewed():
    p = base()
    T.set_action(p, "segment_002", "KEEP")
    s = p["segments"][1]
    assert (s["action"], s["reviewed"], s["manual"]) == ("KEEP", True, True)
    assert T.kept_ranges(p) == [(0, 10000)]


def test_set_range_cuts_across_segments_and_stays_valid():
    p = base()
    T.set_range_action(p, 3000, 7000, "CUT")
    T.validate(p)
    assert spans(p) == [(0, 3000, "KEEP"), (3000, 7000, "CUT"), (7000, 10000, "KEEP")]


def test_locked_segment_cannot_be_cut():
    p = base()
    T.set_locked(p, "segment_003", True)
    with pytest.raises(T.TimelineError):
        T.set_action(p, "segment_003", "CUT")
    T.set_range_action(p, 5000, 9000, "CUT")      # обязательный фрагмент диапазон не удаляет
    assert (6000, 10000) in T.kept_ranges(p) or (6000, 10000, "KEEP") in spans(p)
    assert all(s["action"] == "KEEP" for s in p["segments"] if s["source_start_ms"] >= 6000)


def test_lock_on_cut_segment_turns_it_into_keep():
    p = base()
    T.set_locked(p, "segment_002", True)
    assert p["segments"][1]["action"] == "KEEP" and p["segments"][1]["locked"]


def test_move_boundary_and_limits():
    p = base()
    T.move_boundary(p, "segment_001", 3500)
    assert spans(p)[:2] == [(0, 3500, "KEEP"), (3500, 6000, "CUT")]
    with pytest.raises(T.TimelineError):
        T.move_boundary(p, "segment_001", 6000)       # вышли за правого соседа
    with pytest.raises(T.TimelineError):
        T.move_boundary(p, "segment_003", 9000)       # у последнего нет правой границы


def test_split_then_merge_roundtrip():
    p = base()
    left, right = T.split(p, "segment_001", 1500)
    T.validate(p)
    assert len(p["segments"]) == 4
    T.merge(p, left, right)
    T.validate(p)
    assert spans(p) == spans(base())


def test_merge_requires_adjacent_and_decision():
    p = base()
    with pytest.raises(T.TimelineError):
        T.merge(p, "segment_001", "segment_003")
    with pytest.raises(T.TimelineError):
        T.merge(p, "segment_001", "segment_002")      # разные решения, действие не указано
    T.merge(p, "segment_001", "segment_002", action="KEEP")
    assert spans(p)[0] == (0, 6000, "KEEP")


def test_split_outside_segment_rejected():
    with pytest.raises(T.TimelineError):
        T.split(base(), "segment_001", 4000)


def test_kept_ranges_snap_to_frames_and_merge_touching():
    p = make_plan([(0, 1013, "KEEP"), (1013, 2000, "KEEP")], duration=2000)
    assert T.kept_ranges(p) == [(0, 2000)]
    p = make_plan([(0, 1013, "KEEP"), (1013, 2000, "CUT")], duration=2000)
    assert T.kept_ranges(p) == [(0, 1000)]            # 1013 мс -> кадр 25 -> 1000 мс
    assert T.snap_ms(1021, {"numerator": 25, "denominator": 1}) == 1040


def test_output_duration_and_stats():
    p = base()
    assert T.output_duration_ms(p) == 8000
    st = T.stats(p)
    assert st["removed_ms"] == 2000 and st["unreviewed"] == 3
