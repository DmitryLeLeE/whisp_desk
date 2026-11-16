"""Сведения об установленном FFmpeg: версия и наличие нужных фильтров/кодеков."""
from __future__ import annotations

from ..core.config import find_tool
from ..core.proc import run

REQUIRED_FILTERS = ("silencedetect", "concat", "atrim", "afade", "subtitles", "loudnorm", "alimiter")


def info() -> dict:
    exe = find_tool("ffmpeg")
    if not exe:
        return {"available": False}
    _, ver = run([exe, "-version"])
    _, filters = run([exe, "-hide_banner", "-filters"])
    _, encoders = run([exe, "-hide_banner", "-encoders"])
    return {
        "available": True, "path": exe, "version": ver.splitlines()[0] if ver else "",
        "filters": {f: any(f" {f} " in ln for ln in filters.splitlines()) for f in REQUIRED_FILTERS},
        "libx264": "libx264" in encoders, "aac": any(" aac " in ln for ln in encoders.splitlines()),
    }
