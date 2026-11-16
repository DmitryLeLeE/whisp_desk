"""Облегчённый proxy-файл для предпросмотра в браузере и ключевые кадры для контактного листа."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

from ..core.config import require_tool
from ..core.proc import CancelToken, run

_TIME = re.compile(r"out_time_us=(\d+)")


def make_proxy(src: Path, dst: Path, audio_index: int, duration_ms: int, has_video: bool,
               token: CancelToken | None = None,
               progress: Callable[[float], None] | None = None) -> None:
    tmp = dst.with_name(dst.stem + ".part.mp4")
    cmd = [require_tool("ffmpeg"), "-y", "-v", "error", "-nostdin", "-progress", "pipe:1", "-i", str(src)]
    if has_video:
        cmd += ["-map", "0:v:0", "-vf", "scale=-2:480,format=yuv420p",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-g", "25"]
    cmd += ["-map", f"0:a:{audio_index}", "-c:a", "aac", "-b:a", "96k", "-ac", "2",
            "-movflags", "+faststart", str(tmp)]

    def on_line(line: str) -> None:
        m = _TIME.match(line)
        if m and progress and duration_ms:
            progress(min(1.0, int(m.group(1)) / 1000 / duration_ms))

    code, out = run(cmd, token=token, on_line=on_line)
    if code != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Не удалось создать proxy: {out[-500:]}")
    tmp.replace(dst)


def make_thumbnails(src: Path, out_dir: Path, times_ms: list[int], token: CancelToken | None = None) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    names = []
    for i, t in enumerate(times_ms):
        name = f"thumb_{i:04d}.jpg"
        code, _ = run([require_tool("ffmpeg"), "-y", "-v", "error", "-nostdin", "-ss", f"{t / 1000:.3f}",
                       "-i", str(src), "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5",
                       str(out_dir / name)], token=token)
        if code == 0:
            names.append(name)
    return names
