"""Смена сцен. PySceneDetect, если установлен; иначе встроенный анализ FFmpeg (select=scene)."""
from __future__ import annotations

import re
from pathlib import Path

from ..core.config import require_tool
from ..core.proc import CancelToken, run

_PTS = re.compile(r"pts_time:([\d.]+)")


def detect_scenes(path: Path, duration_ms: int, threshold: float = 27.0,
                  token: CancelToken | None = None) -> dict:
    """threshold — шкала PySceneDetect ContentDetector (по умолчанию 27); для FFmpeg пересчитывается в 0..1."""
    try:
        return _with_pyscenedetect(path, duration_ms, threshold)
    except ImportError:
        return _with_ffmpeg(path, duration_ms, threshold, token)


def _with_pyscenedetect(path: Path, duration_ms: int, threshold: float) -> dict:
    from scenedetect import ContentDetector, detect  # type: ignore

    scenes = detect(str(path), ContentDetector(threshold=threshold))
    cuts = sorted({round(s[0].get_seconds() * 1000) for s in scenes if s[0].get_seconds() > 0})
    return _build("pyscenedetect", cuts, duration_ms)


def _with_ffmpeg(path: Path, duration_ms: int, threshold: float, token: CancelToken | None) -> dict:
    score = min(0.95, max(0.05, threshold / 100))
    cmd = [require_tool("ffmpeg"), "-hide_banner", "-nostdin", "-i", str(path), "-map", "0:v:0", "-an",
           "-vf", f"select='gt(scene,{score})',showinfo", "-f", "null", "-"]
    code, out = run(cmd, token=token)
    if code != 0:
        raise RuntimeError(f"Анализ сцен завершился с ошибкой: {out[-500:]}")
    cuts = sorted({round(float(m.group(1)) * 1000) for m in _PTS.finditer(out)})
    return _build("ffmpeg-scene", [c for c in cuts if 0 < c < duration_ms], duration_ms)


def _build(engine: str, cuts: list[int], duration_ms: int) -> dict:
    bounds = [0, *cuts, duration_ms]
    scenes = [{"index": i, "start_ms": bounds[i], "end_ms": bounds[i + 1]}
              for i in range(len(bounds) - 1) if bounds[i + 1] > bounds[i]]
    return {"engine": engine, "boundaries_ms": cuts, "scenes": scenes}
