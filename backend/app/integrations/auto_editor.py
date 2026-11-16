"""Auto-Editor (Unlicense): внешний инструмент. Проверен на версии 29.3.1.

Используется тремя способами:
- движок чернового плана (`detect_cuts`): запуск с `--export v1`, разбор списка фрагментов;
- альтернативный рендер (`render_v3`): наш .v3 передаётся Auto-Editor как готовый монтаж;
- сравнение с встроенным детектором (см. core/tasks.py).
"""
from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from typing import Callable

from ..core.config import find_tool
from ..core.proc import CancelToken, run
from ..editing.exports import v3_json

CUT_SPEED = 99999.0          # в v1 так помечены вырезаемые куски
_PROGRESS = re.compile(r"~(\d+(?:\.\d+)?)~(\d+(?:\.\d+)?)~")


def info() -> dict:
    exe = find_tool("auto-editor")
    if not exe:
        return {"available": False}
    try:
        code, out = run([exe, "--version"])
    except OSError:
        return {"available": False}
    version = out.strip().splitlines()[-1] if out.strip() else ""
    return {"available": code == 0, "path": exe, "version": version}


def _exe() -> str:
    exe = find_tool("auto-editor")
    if not exe:
        raise RuntimeError("Auto-Editor не найден. Положите auto-editor.exe в tools/auto-editor/ или добавьте в PATH.")
    return exe


def detect_cuts(source: Path, *, audio_index: int, fps: dict, duration_ms: int, noise_db: float,
                min_pause_s: float, pad_before_s: float, pad_after_s: float, min_keep_s: float,
                token: CancelToken | None = None) -> list[dict]:
    """Сокращения [{start_ms, end_ms, reason}] по версии Auto-Editor (порог, запасы и мин. длины — те же настройки)."""
    edit = f"audio:threshold={noise_db}dB,stream={audio_index},mincut={min_pause_s}s"
    if min_keep_s > 0:
        edit += f",minclip={min_keep_s}s"
    tb = f"{fps['numerator']}/{fps['denominator']}"
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "timeline.v1"
        code, text = run([_exe(), str(source), "--edit", edit, "--margin", f"{pad_before_s}s,{pad_after_s}s",
                          "-tb", tb, "--export", "v1", "-o", str(out), "--progress", "none", "--no-open"], token=token)
        if code != 0 or not out.is_file():
            raise RuntimeError(f"Auto-Editor завершился с ошибкой (код {code}): {_clean(text)[-600:]}")
        chunks = json.loads(out.read_text(encoding="utf-8"))["chunks"]
    return cuts_from_chunks(chunks, fps, duration_ms)


def cuts_from_chunks(chunks: list[list[float]], fps: dict, duration_ms: int) -> list[dict]:
    """chunks v1: [начало_кадр, конец_кадр, скорость]; скорость 99999 = вырезать."""
    k = 1000 * fps["denominator"] / fps["numerator"]
    cuts = []
    for start, end, speed in chunks:
        if speed < CUT_SPEED:
            continue
        a, b = round(start * k), min(duration_ms, round(end * k))
        if b - a <= 0:
            continue
        if a <= 0:
            reason = "opening_trim"
        elif b >= duration_ms - 2 * k:
            reason, b = "ending_trim", duration_ms
        else:
            reason = "long_silence"
        cuts.append({"start_ms": a, "end_ms": b, "reason": reason})
    return cuts


def render_v3(plan: dict, meta: dict, source: Path, out_path: Path, work_dir: Path, *, normalize: bool = False,
              video_codec: str = "libx264", audio_bitrate: str = "192k", token: CancelToken | None = None,
              progress: Callable[[float], None] | None = None) -> None:
    """Рендерит наш монтаж средствами Auto-Editor: plan -> .v3 -> mp4 (без шаблонов и вшитых субтитров)."""
    work_dir.mkdir(parents=True, exist_ok=True)
    v3 = work_dir / "plan.v3"
    v3.write_text(v3_json(plan, meta, source), encoding="utf-8")
    cmd = [_exe(), str(v3), "-o", str(out_path), "--no-open", "--progress", "machine",
           "-c:v", video_codec, "-b:a", audio_bitrate]
    if normalize:
        cmd += ["-anorm", "ebu"]

    def on_line(line: str) -> None:
        for chunk in line.replace("\r", "\n").split("\n"):
            m = _PROGRESS.search(_clean(chunk))
            if m and progress and float(m.group(2)) > 0:
                progress(min(1.0, float(m.group(1)) / float(m.group(2))))

    code, text = run(cmd, cwd=work_dir, token=token, on_line=on_line)
    if code != 0:
        out_path.unlink(missing_ok=True)
        raise RuntimeError(f"Auto-Editor завершился с ошибкой (код {code}): {_clean(text)[-600:]}")


def _clean(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", text)
