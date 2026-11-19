import pytest
from app.editing.timeline import split, reorder_sequence, kept_ranges


def test_split_and_reorder():
    plan = {
        "schema_version": 1,
        "duration_ms": 3000,
        "segments": [
            {"id": "segment_001", "source_start_ms": 0, "source_end_ms": 1500, "action": "KEEP", "reason": "keep"},
            {"id": "segment_002", "source_start_ms": 1500, "source_end_ms": 3000, "action": "KEEP", "reason": "keep"},
        ],
    }

    # Test split
    left_id, right_id = split(plan, "segment_001", 500)
    assert len(plan["segments"]) == 3
    assert plan["segments"][0]["source_end_ms"] == 500
    assert plan["segments"][1]["source_start_ms"] == 500
    assert plan["segments"][1]["source_end_ms"] == 1500

    # Natural kept ranges
    ranges = kept_ranges(plan)
    assert ranges == [(0, 3000)]

    # Reorder segments (swap first and last)
    sids = [s["id"] for s in plan["segments"]]
    swapped = [sids[2], sids[1], sids[0]]
    reorder_sequence(plan, swapped)

    ranges_reordered = kept_ranges(plan)
    assert len(ranges_reordered) == 3
    assert ranges_reordered[0] == (1500, 3000)
    assert ranges_reordered[1] == (500, 1500)
    assert ranges_reordered[2] == (0, 500)
