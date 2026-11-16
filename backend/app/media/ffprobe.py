"""Анализ исходного файла через FFprobe."""
from __future__ import annotations

import json
from fractions import Fraction
from pathlib import Path

from ..core.config import require_tool
from ..core.proc import run

SUPPORTED_CONTAINERS = {".mp4", ".mov", ".mkv", ".avi", ".mts", ".m2ts", ".webm", ".m4v"}


def _fraction(value: str | None) -> Fraction | None:
    if not value or value in ("0/0", "N/A"):
        return None
    try:
        f = Fraction(value)
    except (ValueError, ZeroDivisionError):
        return None
    return f if f > 0 else None


def probe(path: Path) -> dict:
    """Возвращает нормализованные технические характеристики файла."""
    code, out = run(
        [require_tool("ffprobe"), "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", str(path)],
        merge_stderr=False,
    )
    if code != 0:
        raise RuntimeError(f"FFprobe не смог прочитать файл: {out.strip()[:500]}")
    raw = json.loads(out[: out.rfind("}") + 1])
    streams = raw.get("streams", [])
    fmt = raw.get("format", {})

    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not s.get("disposition", {}).get("attached_pic")), None)
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    subs = [s for s in streams if s.get("codec_type") == "subtitle"]

    duration = float(fmt.get("duration") or (video or {}).get("duration") or 0)
    info: dict = {
        "path": str(path),
        "filename": path.name,
        "container": fmt.get("format_name"),
        "size_bytes": int(fmt.get("size") or path.stat().st_size),
        "duration_ms": round(duration * 1000),
        "has_video": video is not None,
        "has_subtitles": bool(subs),
        "subtitle_streams": [{"index": s["index"], "codec": s.get("codec_name"),
                              "language": s.get("tags", {}).get("language")} for s in subs],
    }
    if video:
        avg = _fraction(video.get("avg_frame_rate"))
        real = _fraction(video.get("r_frame_rate"))
        fps = avg or real or Fraction(25)
        # Нестабильная частота: avg и r_frame_rate заметно расходятся.
        vfr = bool(avg and real and abs(avg - real) / real > Fraction(1, 100))
        info["video"] = {
            "codec": video.get("codec_name"),
            "width": video.get("width"),
            "height": video.get("height"),
            "fps": {"numerator": fps.numerator, "denominator": fps.denominator},
            "fps_value": float(fps),
            "variable_frame_rate": vfr,
            "pix_fmt": video.get("pix_fmt"),
        }
    info["audio_streams"] = [
        {
            "index": n,  # порядковый номер среди аудиодорожек: 0:a:n
            "stream_index": s["index"],
            "codec": s.get("codec_name"),
            "sample_rate": int(s.get("sample_rate") or 0),
            "channels": s.get("channels"),
            "language": s.get("tags", {}).get("language"),
            "title": s.get("tags", {}).get("title"),
        }
        for n, s in enumerate(audio)
    ]
    info["audio_stream_count"] = len(audio)
    if not info["has_video"] and not audio:
        raise RuntimeError("В файле нет видео и аудио.")
    if duration <= 0:
        raise RuntimeError("Не удалось определить длительность файла.")
    return info
