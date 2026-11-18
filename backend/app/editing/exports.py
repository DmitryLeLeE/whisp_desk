"""Экспорт монтажного плана во внешние форматы:
- Adobe Premiere Pro XML (Final Cut Pro 7 XML / xmeml)
- FCPXML 1.9 (DaVinci Resolve / Final Cut Pro)
- CMX3600 EDL (Kdenlive, DaVinci Resolve, Avid, Vegas)
- Auto-Editor v3 JSON
- OpenTimelineIO (.otio)
- DaVinci Resolve Markers CSV
- YouTube Chapters
- Audacity Labels
"""
from __future__ import annotations

import json
from pathlib import Path
from xml.etree import ElementTree as ET

from .timeline import kept_ranges


def _frames(ms: int, fps: dict) -> int:
    return round(ms * fps["numerator"] / (1000 * fps["denominator"]))


def to_auto_editor_v3(plan: dict, meta: dict, source: Path) -> dict:
    fps = plan["fps"]
    num, den = fps["numerator"], fps["denominator"]
    video = meta.get("video") or {}
    audio = meta["audio_streams"][plan.get("audio_stream", 0)] if meta.get("audio_streams") else {}
    v_clips, a_clips, pos = [], [], 0
    for a, b in kept_ranges(plan):
        start_f, end_f = _frames(a, fps), _frames(b, fps)
        dur = end_f - start_f
        if dur <= 0:
            continue
        clip = {"src": str(source), "start": pos, "dur": dur, "offset": start_f}
        v_clips.append({"name": "video", **clip, "stream": 0})
        a_clips.append({"name": "audio", **clip, "stream": plan.get("audio_stream", 0)})
        pos += dur
    return {
        "version": "3",
        "timebase": f"{num}/{den}",
        "background": "#000000",
        "resolution": [video.get("width", 1920), video.get("height", 1080)],
        "samplerate": audio.get("sample_rate", 48000) or 48000,
        "layout": "mono" if audio.get("channels") == 1 else "stereo",
        "v": [v_clips] if meta.get("has_video", True) else [],
        "a": [a_clips],
    }


def v3_json(plan: dict, meta: dict, source: Path) -> str:
    return json.dumps(to_auto_editor_v3(plan, meta, source), ensure_ascii=False, indent=2) + "\n"


def to_fcpxml(plan: dict, meta: dict, source: Path, name: str) -> str:
    """FCPXML 1.9 для DaVinci Resolve и Final Cut Pro X."""
    fps = plan["fps"]
    num, den = fps["numerator"], fps["denominator"]
    video = meta.get("video") or {"width": 1920, "height": 1080}
    audio = meta["audio_streams"][plan.get("audio_stream", 0)] if meta.get("audio_streams") else {}

    def t(frames: int) -> str:
        return "0s" if frames == 0 else f"{frames * den}/{num}s"

    total_src = _frames(plan["duration_ms"], fps)
    root = ET.Element("fcpxml", version="1.9")
    res = ET.SubElement(root, "resources")
    ET.SubElement(res, "format", id="r1", name=f"FFVideoFormat{video['height']}p{num / den:g}",
                  frameDuration=t(1), width=str(video["width"]), height=str(video["height"]))
    asset = ET.SubElement(res, "asset", id="r2", name=source.stem, start="0s", duration=t(total_src),
                          hasVideo="1" if meta.get("has_video", True) else "0", hasAudio="1", format="r1",
                          audioSources="1", audioChannels=str(audio.get("channels") or 2),
                          audioRate=str(audio.get("sample_rate") or 48000), src=source.resolve().as_uri())
    del asset
    lib = ET.SubElement(root, "library")
    event = ET.SubElement(lib, "event", name=name)
    proj = ET.SubElement(event, "project", name=name)
    ranges = kept_ranges(plan)
    clips = [(_frames(a, fps), _frames(b, fps)) for a, b in ranges]
    clips = [(a, b) for a, b in clips if b > a]
    total_out = sum(b - a for a, b in clips)
    seq = ET.SubElement(proj, "sequence", format="r1", duration=t(total_out), tcStart="0s", tcFormat="NDF")
    spine = ET.SubElement(seq, "spine")
    pos = 0
    for a, b in clips:
        ET.SubElement(spine, "asset-clip", ref="r2", offset=t(pos), name=source.stem,
                      start=t(a), duration=t(b - a), tcFormat="NDF")
        pos += b - a
    ET.indent(root)
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n' + ET.tostring(root, encoding="unicode") + "\n"


def to_premiere_xml(plan: dict, meta: dict, source: Path, name: str) -> str:
    """Final Cut Pro 7 XML (xmeml v5) — стандартный формат для Adobe Premiere Pro и DaVinci Resolve.
    
    Поддерживает:
    - Видеодорожку и стерео-аудиодорожки
    - Синхронное связывание (link) видео и аудио клипов
    - Точные точки входа и выхода (In / Out) без перекодирования
    - Автоматическую привязку исходного медиафайла (pathurl)
    """
    fps = plan["fps"]
    num, den = fps["numerator"], fps["denominator"]
    fps_val = num / den
    timebase = round(fps_val)
    ntsc = "TRUE" if timebase in (24, 30, 60) and abs(fps_val - (timebase * 1000 / 1001)) < 0.05 else "FALSE"

    video = meta.get("video") or {"width": 1920, "height": 1080}
    audio = meta["audio_streams"][plan.get("audio_stream", 0)] if meta.get("audio_streams") else {}
    sample_rate = audio.get("sample_rate") or 48000
    channels = audio.get("channels") or 2
    has_video = meta.get("has_video", True)

    total_src_f = _frames(plan["duration_ms"], fps)
    ranges = kept_ranges(plan)
    clips = [(_frames(a, fps), _frames(b, fps)) for a, b in ranges]
    clips = [(a, b) for a, b in clips if b > a]
    total_out_f = sum(b - a for a, b in clips)

    # Нормализация file pathurl для Premiere Pro
    path_url = source.resolve().as_uri().replace("file:///", "file://localhost/")

    root = ET.Element("xmeml", version="5")
    seq = ET.SubElement(root, "sequence", id="sequence-1")
    ET.SubElement(seq, "name").text = name
    ET.SubElement(seq, "duration").text = str(total_out_f)

    rate_elem = ET.SubElement(seq, "rate")
    ET.SubElement(rate_elem, "timebase").text = str(timebase)
    ET.SubElement(rate_elem, "ntsc").text = ntsc

    tc_elem = ET.SubElement(seq, "timecode")
    r2 = ET.SubElement(tc_elem, "rate")
    ET.SubElement(r2, "timebase").text = str(timebase)
    ET.SubElement(r2, "ntsc").text = ntsc
    ET.SubElement(tc_elem, "string").text = "00:00:00:00"
    ET.SubElement(tc_elem, "frame").text = "0"
    ET.SubElement(tc_elem, "displayformat").text = "NDF"

    media = ET.SubElement(seq, "media")

    # Helper для построения узла <file>
    def build_file_elem(parent: ET.Element, file_id: str, is_first: bool) -> None:
        fe = ET.SubElement(parent, "file", id=file_id)
        if not is_first:
            return
        ET.SubElement(fe, "name").text = source.name
        ET.SubElement(fe, "pathurl").text = path_url
        frate = ET.SubElement(fe, "rate")
        ET.SubElement(frate, "timebase").text = str(timebase)
        ET.SubElement(frate, "ntsc").text = ntsc
        ET.SubElement(fe, "duration").text = str(total_src_f)
        f_media = ET.SubElement(fe, "media")
        if has_video:
            f_v = ET.SubElement(f_media, "video")
            f_vsc = ET.SubElement(f_v, "samplecharacteristics")
            f_vr = ET.SubElement(f_vsc, "rate")
            ET.SubElement(f_vr, "timebase").text = str(timebase)
            ET.SubElement(f_vr, "ntsc").text = ntsc
            ET.SubElement(f_vsc, "width").text = str(video["width"])
            ET.SubElement(f_vsc, "height").text = str(video["height"])
        f_a = ET.SubElement(f_media, "audio")
        f_asc = ET.SubElement(f_a, "samplecharacteristics")
        ET.SubElement(f_asc, "depth").text = "16"
        ET.SubElement(f_asc, "samplerate").text = str(sample_rate)
        ET.SubElement(f_a, "channelcount").text = str(channels)

    # Helper для links
    def add_links(clip_elem: ET.Element, idx: int) -> None:
        if has_video:
            l_v = ET.SubElement(clip_elem, "link")
            ET.SubElement(l_v, "linkclipref").text = f"clipitem-video-{idx}"
            ET.SubElement(l_v, "mediatype").text = "video"
            ET.SubElement(l_v, "trackindex").text = "1"
            ET.SubElement(l_v, "clipindex").text = str(idx)
        for a_ch in range(1, min(channels, 2) + 1):
            l_a = ET.SubElement(clip_elem, "link")
            ET.SubElement(l_a, "linkclipref").text = f"clipitem-audio-{a_ch}-{idx}"
            ET.SubElement(l_a, "mediatype").text = "audio"
            ET.SubElement(l_a, "trackindex").text = str(a_ch)
            ET.SubElement(l_a, "clipindex").text = str(idx)

    # 1. Видеодорожка
    if has_video:
        v_media = ET.SubElement(media, "video")
        v_fmt = ET.SubElement(v_media, "format")
        v_sc = ET.SubElement(v_fmt, "samplecharacteristics")
        v_r = ET.SubElement(v_sc, "rate")
        ET.SubElement(v_r, "timebase").text = str(timebase)
        ET.SubElement(v_r, "ntsc").text = ntsc
        ET.SubElement(v_sc, "width").text = str(video["width"])
        ET.SubElement(v_sc, "height").text = str(video["height"])
        ET.SubElement(v_sc, "anamorphic").text = "FALSE"
        ET.SubElement(v_sc, "pixelaspectratio").text = "square"
        ET.SubElement(v_sc, "fielddominance").text = "none"

        v_track = ET.SubElement(v_media, "track")
        pos = 0
        for i, (a, b) in enumerate(clips, 1):
            dur = b - a
            c_elem = ET.SubElement(v_track, "clipitem", id=f"clipitem-video-{i}")
            ET.SubElement(c_elem, "name").text = source.name
            ET.SubElement(c_elem, "duration").text = str(total_src_f)
            c_rate = ET.SubElement(c_elem, "rate")
            ET.SubElement(c_rate, "timebase").text = str(timebase)
            ET.SubElement(c_rate, "ntsc").text = ntsc
            ET.SubElement(c_elem, "start").text = str(pos)
            ET.SubElement(c_elem, "end").text = str(pos + dur)
            ET.SubElement(c_elem, "in").text = str(a)
            ET.SubElement(c_elem, "out").text = str(b)
            build_file_elem(c_elem, "file-1", is_first=(i == 1))
            add_links(c_elem, i)
            pos += dur

    # 2. Аудиодорожки
    a_media = ET.SubElement(media, "audio")
    num_audio_tracks = min(channels, 2) if channels > 0 else 1
    for a_ch in range(1, num_audio_tracks + 1):
        a_track = ET.SubElement(a_media, "track")
        pos = 0
        for i, (a, b) in enumerate(clips, 1):
            dur = b - a
            c_elem = ET.SubElement(a_track, "clipitem", id=f"clipitem-audio-{a_ch}-{i}")
            ET.SubElement(c_elem, "name").text = source.name
            ET.SubElement(c_elem, "duration").text = str(total_src_f)
            c_rate = ET.SubElement(c_elem, "rate")
            ET.SubElement(c_rate, "timebase").text = str(timebase)
            ET.SubElement(c_rate, "ntsc").text = ntsc
            ET.SubElement(c_elem, "start").text = str(pos)
            ET.SubElement(c_elem, "end").text = str(pos + dur)
            ET.SubElement(c_elem, "in").text = str(a)
            ET.SubElement(c_elem, "out").text = str(b)
            build_file_elem(c_elem, "file-1", is_first=(not has_video and a_ch == 1 and i == 1))
            src_track = ET.SubElement(c_elem, "sourcetrack")
            ET.SubElement(src_track, "mediatype").text = "audio"
            ET.SubElement(src_track, "trackindex").text = str(a_ch)
            add_links(c_elem, i)
            pos += dur

    ET.indent(root)
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n' + ET.tostring(root, encoding="unicode") + "\n"


def to_edl(plan: dict, meta: dict, source: Path, name: str) -> str:
    """CMX3600 EDL (NDF): один видео+аудио клип на каждый сохраняемый фрагмент. Запись начинается с 01:00:00:00."""
    fps = plan["fps"]
    real = fps["numerator"] / fps["denominator"]
    base = round(real)

    def tc(frames: int) -> str:
        f = frames % base
        sec = frames // base
        return f"{sec // 3600:02d}:{sec // 60 % 60:02d}:{sec % 60:02d}:{f:02d}"

    track = "AA/V" if meta.get("has_video", True) else "AA"
    lines = [f"TITLE: {name}", "FCM: NON-DROP FRAME", ""]
    rec = 3600 * base
    n = 0
    for a, b in kept_ranges(plan):
        fa, fb = _frames(a, fps), _frames(b, fps)
        if fb <= fa:
            continue
        n += 1
        dur = fb - fa
        lines.append(f"{n:03d}  AX       {track:<5} C        {tc(fa)} {tc(fb)} {tc(rec)} {tc(rec + dur)}")
        lines.append(f"* FROM CLIP NAME: {source.name}")
        rec += dur
    return "\n".join(lines) + "\n"


def to_otio(plan: dict, meta: dict, source: Path, name: str) -> str:
    """OpenTimelineIO JSON (.otio) — универсальный открытый стандарт таймлайна."""
    fps = plan["fps"]
    fps_val = fps["numerator"] / fps["denominator"]
    total_src = _frames(plan["duration_ms"], fps)
    ranges = kept_ranges(plan)

    v_children, a_children = [], []
    for a, b in ranges:
        start_f, end_f = _frames(a, fps), _frames(b, fps)
        dur_f = end_f - start_f
        if dur_f <= 0:
            continue
        clip = {
            "OTIO_SCHEMA": "Clip.1",
            "name": f"{source.name} [{start_f}:{end_f}]",
            "source_range": {
                "OTIO_SCHEMA": "TimeRange.1",
                "start_time": {"OTIO_SCHEMA": "RationalTime.1", "rate": fps_val, "value": start_f},
                "duration": {"OTIO_SCHEMA": "RationalTime.1", "rate": fps_val, "value": dur_f},
            },
            "media_reference": {
                "OTIO_SCHEMA": "ExternalReference.1",
                "target_url": source.resolve().as_uri(),
                "available_range": {
                    "OTIO_SCHEMA": "TimeRange.1",
                    "start_time": {"OTIO_SCHEMA": "RationalTime.1", "rate": fps_val, "value": 0},
                    "duration": {"OTIO_SCHEMA": "RationalTime.1", "rate": fps_val, "value": total_src},
                },
            },
        }
        v_children.append(clip)
        a_children.append(dict(clip))

    tracks = []
    if meta.get("has_video", True):
        tracks.append({
            "OTIO_SCHEMA": "Track.1",
            "name": "Video Track",
            "kind": "Video",
            "children": v_children,
        })
    tracks.append({
        "OTIO_SCHEMA": "Track.1",
        "name": "Audio Track",
        "kind": "Audio",
        "children": a_children,
    })

    doc = {
        "OTIO_SCHEMA": "Timeline.1",
        "name": name,
        "tracks": {
            "OTIO_SCHEMA": "Stack.1",
            "name": "tracks",
            "children": tracks,
        },
    }
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


def to_davinci_markers_csv(plan: dict, meta: dict | None = None) -> str:
    """CSV маркеры для DaVinci Resolve (Edit Index -> Import Markers).
    
    Показывает все сохранённые и вырезанные участки прямо на таймлайне Resolve:
    - Зелёный (Green): полезная речь (KEEP)
    - Красный (Red): вырезанная тишина / пауза (CUT)
    """
    fps = plan["fps"]
    real = fps["numerator"] / fps["denominator"]
    base = round(real)

    def tc(frames: int) -> str:
        f = frames % base
        sec = frames // base
        return f"{sec // 3600:02d}:{sec // 60 % 60:02d}:{sec % 60:02d}:{f:02d}"

    lines = ['"EDL Marker Name","Color","Start Timecode","Duration","Notes"']
    for i, seg in enumerate(plan.get("segments", []), 1):
        s_ms = seg.get("source_start_ms", seg.get("start_ms", 0))
        e_ms = seg.get("source_end_ms", seg.get("end_ms", 0))
        sf = _frames(s_ms, fps)
        ef = _frames(e_ms, fps)
        dur = max(1, ef - sf)
        action = seg.get("action", "KEEP")
        color = "Green" if action == "KEEP" else "Red"
        reason = seg.get("reason") or ("Речь" if action == "KEEP" else "Пауза")
        lines.append(f'"Сегмент {i:03d} ({action})","{color}","{tc(sf)}","{tc(dur)}","{reason}"')
    return "\n".join(lines) + "\n"


def to_chapters(plan: dict) -> str:
    """Оглавление (YouTube / плееры) с таймкодами готового монтажа."""
    ranges = kept_ranges(plan)
    pos_ms = 0
    lines = []
    for i, (a, b) in enumerate(ranges, 1):
        s = pos_ms // 1000
        m, sec = divmod(s, 60)
        h, m = divmod(m, 60)
        ts = f"{h:02d}:{m:02d}:{sec:02d}" if h > 0 else f"{m:02d}:{sec:02d}"
        lines.append(f"{ts} Фрагмент {i}")
        pos_ms += b - a
    return "\n".join(lines) + "\n"


def to_audacity_labels(plan: dict) -> str:
    """Дорожка меток для Audacity / Reaper (табуляция: старт, конец, метка)."""
    lines = []
    for i, (a, b) in enumerate(kept_ranges(plan), 1):
        lines.append(f"{a / 1000:.6f}\t{b / 1000:.6f}\tKEEP_{i}")
    return "\n".join(lines) + "\n"
