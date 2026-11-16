"""Поиск тишины через FFmpeg silencedetect (без ML)."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

from ..core.config import require_tool
from ..core.proc import CancelToken, run

_START = re.compile(r"silence_start:\s*(-?[\d.]+)")
_END = re.compile(r"silence_end:\s*(-?[\d.]+)")
_TIME = re.compile(r"time=(\d+):(\d+):([\d.]+)")


def parse_silencedetect(text: str, duration_ms: int) -> list[dict]:
    """Разбор вывода silencedetect в список {start_ms, end_ms}. Незакрытая тишина идёт до конца файла."""
    out: list[dict] = []
    start: int | None = None
    for line in text.splitlines():
        m = _START.search(line)
        if m:
            start = max(0, round(float(m.group(1)) * 1000))
            continue
        m = _END.search(line)
        if m and start is not None:
            end = min(duration_ms, round(float(m.group(1)) * 1000))
            if end > start:
                out.append({"start_ms": start, "end_ms": end})
            start = None
    if start is not None and duration_ms > start:
        out.append({"start_ms": start, "end_ms": duration_ms})
    return out


def detect_silence(path: Path, audio_index: int, duration_ms: int, noise_db: float, min_duration_s: float,
                   token: CancelToken | None = None,
                   progress: Callable[[float], None] | None = None) -> list[dict]:
    flt = f"silencedetect=noise={noise_db}dB:d={min_duration_s}"
    cmd = [require_tool("ffmpeg"), "-hide_banner", "-nostdin", "-i", str(path),
           "-map", f"0:a:{audio_index}", "-vn", "-af", flt, "-f", "null", "-"]

    def on_line(line: str) -> None:
        if progress and duration_ms:
            m = _TIME.search(line)
            if m:
                sec = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
                progress(min(1.0, sec * 1000 / duration_ms))

    code, out = run(cmd, token=token, on_line=on_line)
    if code != 0:
        raise RuntimeError(f"silencedetect завершился с ошибкой: {out[-500:]}")
    return parse_silencedetect(out, duration_ms)
