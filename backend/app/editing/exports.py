"""Экспорт монтажного плана во внешние форматы: Auto-Editor v3 и FCPXML (DaVinci Resolve).

.v3 проверен на Auto-Editor 29.3.1 (файл открывается и рендерится в ожидаемую длительность).
FCPXML написан по описанию формата и требует проверки в вашей версии DaVinci Resolve (ТЗ, раздел 5.10).
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
    audio = meta["audio_streams"][plan.get("audio_stream", 0)] if meta["audio_streams"] else {}
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
        "v": [v_clips] if meta["has_video"] else [],
        "a": [a_clips],
    }


def to_fcpxml(plan: dict, meta: dict, source: Path, name: str) -> str:
    fps = plan["fps"]
    num, den = fps["numerator"], fps["denominator"]
    video = meta.get("video") or {"width": 1920, "height": 1080}
    audio = meta["audio_streams"][plan.get("audio_stream", 0)] if meta["audio_streams"] else {}

    def t(frames: int) -> str:
        return "0s" if frames == 0 else f"{frames * den}/{num}s"

    total_src = _frames(plan["duration_ms"], fps)
    root = ET.Element("fcpxml", version="1.9")
    res = ET.SubElement(root, "resources")
    ET.SubElement(res, "format", id="r1", name=f"FFVideoFormat{video['height']}p{num / den:g}",
                  frameDuration=t(1), width=str(video["width"]), height=str(video["height"]))
    asset = ET.SubElement(res, "asset", id="r2", name=source.stem, start="0s", duration=t(total_src),
                          hasVideo="1" if meta["has_video"] else "0", hasAudio="1", format="r1",
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


def v3_json(plan: dict, meta: dict, source: Path) -> str:
    return json.dumps(to_auto_editor_v3(plan, meta, source), ensure_ascii=False, indent=2) + "\n"


def to_edl(plan: dict, meta: dict, source: Path, name: str) -> str:
    """CMX3600 EDL (NDF): один видео+аудио клип на каждый сохраняемый фрагмент. Запись начинается с 01:00:00:00."""
    fps = plan["fps"]
    real = fps["numerator"] / fps["denominator"]
    base = round(real)

    def tc(frames: int) -> str:
        f = frames % base
        sec = frames // base
        return f"{sec // 3600:02d}:{sec // 60 % 60:02d}:{sec % 60:02d}:{f:02d}"

    track = "AA/V" if meta["has_video"] else "AA"
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
