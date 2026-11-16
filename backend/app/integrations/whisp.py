"""Интеграция с Whisp (WhisperSRT): запуск его CLI как отдельного процесса. Код Whisp не копируется и не меняется."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable

from ..core.config import load_settings, whisp_dir
from ..core.proc import CancelToken, run


def info() -> dict:
    d = whisp_dir()
    return {"available": d is not None, "path": str(d) if d else None}


def python_executable() -> str:
    return load_settings().get("whisp_python") or sys.executable


def transcribe(source: Path, out_dir: Path, *, audio_index: int = 0, model: str = "small",
               language: str = "auto", token: CancelToken | None = None,
               on_line: Callable[[str], None] | None = None) -> Path:
    """Возвращает путь к созданному SRT. Требует установленный faster-whisper в выбранном Python."""
    d = whisp_dir()
    if d is None:
        raise RuntimeError("Whisp не найден. Укажите папку с whisper_universal.py в config/settings.json "
                           "(ключ whisp_dir) или переменной окружения WHISP_DIR.")
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [python_executable(), str(d / "whisper_universal.py"), str(source), "-o", str(out_dir),
           "-f", "srt", "-m", model, "-l", language, "--audio-stream", str(audio_index),
           "--overwrite", "--lang", "ru"]
    code, out = run(cmd, cwd=d, token=token, on_line=on_line)
    if code != 0:
        raise RuntimeError(f"Whisp завершился с ошибкой (код {code}): {out[-800:]}")
    found = sorted(out_dir.glob(f"{source.stem}.whisper.srt"))
    if not found:
        raise RuntimeError("Whisp завершился, но SRT-файл не найден в выходной папке.")
    return found[0]
