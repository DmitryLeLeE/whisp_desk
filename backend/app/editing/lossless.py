"""Быстрый Lossless-экспорт (Stream Copy) без перекодирования через FFmpeg."""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable

from ..core.config import require_tool
from ..core.proc import CancelToken, run
from .timeline import kept_ranges


class LosslessError(RuntimeError):
    pass


def render_lossless(
    source: Path,
    out_path: Path,
    plan: dict,
    work_dir: Path,
    *,
    token: CancelToken | None = None,
    progress: Callable[[float], None] | None = None,
    log: Callable[[str], None] | None = None,
) -> dict:
    """Выполняет экспорт видеопотока и аудиопотока без перекодирования (-c copy)."""
    ranges = kept_ranges(plan)
    if not ranges:
        raise LosslessError("В плане нет сохраняемых фрагментов для экспорта.")

    work_dir.mkdir(parents=True, exist_ok=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg_bin = require_tool("ffmpeg")

    if log:
        log(f"Lossless-экспорт: нарезка {len(ranges)} фрагментов без перекодирования...")

    seg_files: list[Path] = []
    total = len(ranges)

    try:
        for i, (start_ms, end_ms) in enumerate(ranges):
            if token:
                token.check()

            start_s = f"{start_ms / 1000:.3f}"
            end_s = f"{end_ms / 1000:.3f}"
            seg_path = work_dir / f"seg_{i:05d}{source.suffix}"
            seg_files.append(seg_path)

            # -ss до -i ускоряет поиск по ключевым кадрам, -avoid_negative_ts выравнивает таймкоды
            cmd = [
                ffmpeg_bin, "-y", "-v", "error", "-nostdin",
                "-ss", start_s,
                "-to", end_s,
                "-i", str(source),
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                str(seg_path),
            ]
            code, out = run(cmd, token=token)
            if code != 0:
                raise LosslessError(f"Ошибка при нарезке фрагмента {i} ({start_s}s - {end_s}s): {out}")

            if progress:
                progress(0.1 + 0.7 * ((i + 1) / total))

        if token:
            token.check()

        # Создаём файл конкатенации
        list_file = work_dir / "concat_list.txt"
        with open(list_file, "w", encoding="utf-8") as f:
            for seg in seg_files:
                # Используем относительные имена для safe concat demuxer
                f.write(f"file '{seg.name}'\n")

        if log:
            log("Сборка итогового файла через concat demuxer...")

        concat_cmd = [
            ffmpeg_bin, "-y", "-v", "error", "-nostdin",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            "-movflags", "+faststart",
            str(out_path),
        ]
        code, out = run(concat_cmd, token=token)
        if code != 0:
            raise LosslessError(f"Ошибка при объединении фрагментов: {out}")

        if progress:
            progress(1.0)

        if log:
            log(f"Lossless-экспорт завершён: {out_path.name} ({out_path.stat().st_size // 1024} КБ)")

        return {
            "path": str(out_path),
            "size_bytes": out_path.stat().st_size,
            "segments_count": total,
            "lossless": True,
        }
    finally:
        # Очищаем промежуточные фрагменты
        shutil.rmtree(work_dir, ignore_errors=True)
