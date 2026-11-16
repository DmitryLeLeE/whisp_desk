from app.analysis import edit_planner as P
from app.analysis.silence_detector import parse_silencedetect
from app.editing import timeline as T

FPS = {"numerator": 25, "denominator": 1}


def plan_for(silence, duration=20000, profile="standard"):
    return P.build_plan(project_id="t", source="x.mp4", duration_ms=duration, fps=FPS, audio_index=0,
                        silence=silence, params=P.profile_params(profile))


def test_parse_silencedetect_closed_and_open_ended():
    text = ("[silencedetect @ 0x1] silence_start: 3.008\n[silencedetect @ 0x1] silence_end: 7.019 | silence_duration: 4.01\n"
            "[silencedetect @ 0x1] silence_start: 17.003\n")
    assert parse_silencedetect(text, 20000) == [{"start_ms": 3008, "end_ms": 7019}, {"start_ms": 17003, "end_ms": 20000}]


def test_pauses_keep_remnant_around_speech():
    p = plan_for([{"start_ms": 3000, "end_ms": 7000}])
    T.validate(p)
    cut = next(s for s in p["segments"] if s["action"] == "CUT")
    # после речи остаётся 0.5 с, перед речью 0.35 с
    assert (cut["source_start_ms"], cut["source_end_ms"]) == (3500, 6650)
    assert cut["reason"] == "long_silence"


def test_opening_and_ending_trim():
    p = plan_for([{"start_ms": 0, "end_ms": 2000}, {"start_ms": 18000, "end_ms": 20000}])
    reasons = [(s["reason"], s["action"]) for s in p["segments"]]
    assert reasons[0] == ("opening_trim", "CUT") and reasons[-1] == ("ending_trim", "CUT")
    assert p["segments"][0]["source_end_ms"] == 1650


def test_pause_too_short_after_padding_is_not_cut():
    p = plan_for([{"start_ms": 3000, "end_ms": 3900}])   # 0.9 с: после запасов <100 мс
    assert all(s["action"] == "KEEP" for s in p["segments"])


def test_fully_silent_file_is_left_alone():
    p = plan_for([{"start_ms": 0, "end_ms": 20000}])
    assert [s["action"] for s in p["segments"]] == ["KEEP"]


def test_short_keep_between_cuts_becomes_cut_but_unreviewed():
    p = plan_for([{"start_ms": 1000, "end_ms": 5000}, {"start_ms": 5300, "end_ms": 9000}], profile="standard")
    # между сокращениями остаётся фрагмент короче 0.4 с -> низкая громкость, не проверен
    shorts = [s for s in p["segments"] if s["reason"] == "low_volume"]
    assert all(not s["reviewed"] for s in shorts)
    T.validate(p)


def test_careful_is_less_aggressive_than_aggressive():
    sil = [{"start_ms": 3000, "end_ms": 4500}, {"start_ms": 8000, "end_ms": 12000}]
    cut = lambda prof: T.stats(plan_for(sil, profile=prof))["removed_ms"]
    assert cut("careful") <= cut("standard") <= cut("aggressive")


def test_low_volume_pass_does_not_overlap_main():
    p = P.build_plan(project_id="t", source="x", duration_ms=30000, fps=FPS, audio_index=0,
                     silence=[{"start_ms": 5000, "end_ms": 9000}],
                     low_volume=[{"start_ms": 4000, "end_ms": 10000}, {"start_ms": 20000, "end_ms": 25000}],
                     params=P.profile_params("aggressive"))
    T.validate(p)
    assert any(s["reason"] == "low_volume" and s["source_start_ms"] >= 20000 for s in p["segments"])


def test_profile_overrides_and_unknown_profile():
    import pytest
    assert P.profile_params("standard", {"min_pause_s": 3.0, "junk": 1})["min_pause_s"] == 3.0
    with pytest.raises(ValueError):
        P.profile_params("nope")
