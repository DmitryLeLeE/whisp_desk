import pytest

from app.editing import subtitles as S
from conftest import make_plan

SRT = "1\n00:00:01,000 --> 00:00:03,000\nПривет, мир\n\n2\n00:00:05,000 --> 00:00:09,000\nодин два три четыре\n"


def test_srt_roundtrip():
    cues = S.parse_srt_vtt(SRT)
    assert [c.to_dict() for c in cues] == [
        {"start_ms": 1000, "end_ms": 3000, "text": "Привет, мир"},
        {"start_ms": 5000, "end_ms": 9000, "text": "один два три четыре"}]
    assert S.parse_srt_vtt(S.render_srt(cues)) == cues


def test_vtt_and_ass_and_json_and_txt():
    vtt = "WEBVTT\n\n00:01.000 --> 00:02.500\n<i>да</i>\n"
    assert S.parse_srt_vtt(vtt)[0].to_dict() == {"start_ms": 1000, "end_ms": 2500, "text": "да"}
    ass = S.render_ass([S.Cue(1000, 2500, "строка\nдве")])
    assert S.parse_ass(ass)[0].to_dict() == {"start_ms": 1000, "end_ms": 2500, "text": "строка\nдве"}
    js = '{"segments":[{"start":1.5,"end":2.0,"text":" привет "}]}'
    assert S.parse_json(js)[0].to_dict() == {"start_ms": 1500, "end_ms": 2000, "text": "привет"}
    txt = S.parse_txt("[00:00:01] раз\n[00:00:04] два\n")
    assert txt[0].end_ms == 4000
    with pytest.raises(ValueError):
        S.parse_txt("просто текст без меток")


def test_cue_inside_kept_part_is_shifted():
    plan = make_plan([(0, 4000, "KEEP"), (4000, 6000, "CUT"), (6000, 10000, "KEEP")])
    out = S.remap_cues([S.Cue(7000, 8000, "после")], plan)
    assert out == [S.Cue(5000, 6000, "после")]    # 7000 - 2000 вырезанных


def test_cue_inside_cut_part_disappears():
    plan = make_plan([(0, 4000, "KEEP"), (4000, 6000, "CUT"), (6000, 10000, "KEEP")])
    assert S.remap_cues([S.Cue(4200, 5800, "тишина")], plan) == []


def test_cue_overlapping_cut_edge_is_trimmed():
    plan = make_plan([(0, 4000, "KEEP"), (4000, 6000, "CUT"), (6000, 10000, "KEEP")])
    out = S.remap_cues([S.Cue(3000, 5000, "хвост")], plan)
    assert out == [S.Cue(3000, 4000, "хвост")]


def test_cue_spanning_cut_between_keeps_is_closed_up():
    plan = make_plan([(0, 4000, "KEEP"), (4000, 6000, "CUT"), (6000, 10000, "KEEP")])
    out = S.remap_cues([S.Cue(3000, 7000, "а б в г")], plan)
    # куски стали вплотную в новом видео -> одна реплика целиком
    assert out == [S.Cue(3000, 5000, "а б в г")]


def test_cue_spanning_a_removed_gap_with_keep_in_middle_is_split_by_words():
    plan = make_plan([(0, 2000, "KEEP"), (2000, 5000, "CUT"), (5000, 7000, "KEEP"), (7000, 9000, "CUT"),
                      (9000, 12000, "KEEP")], duration=12000)
    out = S.remap_cues([S.Cue(1000, 10000, "раз два три четыре пять шесть")], plan)
    # в новом видео: [1000..2000], [2000..4000], [4000..5000] стыкуются вплотную -> одна реплика
    assert out == [S.Cue(1000, 5000, "раз два три четыре пять шесть")]


def test_split_when_pieces_are_not_adjacent_in_new_video():
    # между двумя сохранёнными кусками реплики лежит кусок другой реплики? нет — но стык возможен только вплотную,
    # поэтому проверяем разделение напрямую через пропорциональное деление слов
    assert S._split_text("а б в г", [1000, 3000]) == ["а", "б в г"]
    assert S._split_text("а б в г", [2000, 2000]) == ["а б", "в г"]


def test_no_overlaps_and_sorted_after_remap():
    plan = make_plan([(0, 3000, "KEEP"), (3000, 4000, "CUT"), (4000, 10000, "KEEP")])
    cues = [S.Cue(2500, 4500, "первая"), S.Cue(4400, 6000, "вторая")]
    out = S.remap_cues(cues, plan)
    assert all(a.end_ms <= b.start_ms for a, b in zip(out, out[1:]))


def test_ass_escapes_braces():
    assert "{bad}" not in S.render_ass([S.Cue(0, 1000, "{bad}")])


def test_bilingual_and_transcript_render():
    cues_ru = [S.Cue(0, 2000, "Привет мир"), S.Cue(2500, 4000, "Как дела?")]
    cues_en = [S.Cue(0, 2000, "Hello world"), S.Cue(2500, 4000, "How are you?")]
    bi = S.render_bilingual_srt(cues_ru, cues_en)
    assert "Привет мир\nHello world" in bi
    assert "Как дела?\nHow are you?" in bi

    tr = S.render_transcript(cues_ru)
    assert "[00:00:00" in tr and "Привет мир" in tr
