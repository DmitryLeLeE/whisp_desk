"""Огибающая громкости для отображения аудиоволны."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..core.config import require_tool
from ..core.proc import CancelToken, Cancelled
import subprocess

RATE = 8000


def compute_peaks(path: Path, audio_index: int, duration_ms: int,
                  peaks_per_second: int = 20, token: CancelToken | None = None) -> dict:
    """Читает аудио как mono s16le 8 кГц и считает пик на окно. Память — блоками, не весь файл."""
    cmd = [require_tool("ffmpeg"), "-v", "error", "-nostdin", "-i", str(path),
           "-map", f"0:a:{audio_index}", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"]
    window = RATE // peaks_per_second
    peaks: list[float] = []
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if token:
        token.attach(proc)
    carry = b""
    assert proc.stdout is not None
    chunk_bytes = window * 2 * 2000
    while True:
        data = proc.stdout.read(chunk_bytes)
        if not data:
            break
        data = carry + data
        usable = len(data) - len(data) % (window * 2)
        carry = data[usable:]
        if usable:
            arr = np.frombuffer(data[:usable], dtype="<i2").reshape(-1, window)
            peaks.extend((np.abs(arr.astype(np.int32)).max(axis=1) / 32768.0).round(3).tolist())
    proc.wait()
    if token and token.cancelled:
        raise Cancelled()
    if proc.returncode != 0:
        raise RuntimeError("FFmpeg не смог извлечь звук для волны.")
    return {"peaks_per_second": peaks_per_second, "duration_ms": duration_ms, "peaks": peaks}
