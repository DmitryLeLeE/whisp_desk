"""Whisp (WhisperSRT), встроенный в приложение.

Движок лежит в app/vendor/whisp. Тяжёлую работу (модель, ctranslate2) делает отдельный процесс — этот же exe, запущенный как
`WHISP_MEDIA_DESK --whisp-run ...`. Если faster-whisper не установлен (разработка без него), можно указать внешнюю
копию Whisp: `whisp_dir` в config/settings.json или переменная WHISP_DIR.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Callable

from ..core import config
from ..core.config import find_tool, load_settings, whisp_dir
from ..core.proc import CancelToken, run

VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor" / "whisp"
PREFIX = "@@WD "

# Размеры загрузки, МБ (примерно, для подсказки в интерфейсе)
MODELS = [
    {"name": "tiny", "size_mb": 75, "speed": "очень быстро", "quality": "черновик"},
    {"name": "base", "size_mb": 145, "speed": "очень быстро", "quality": "низкое"},
    {"name": "small", "size_mb": 485, "speed": "быстро", "quality": "хорошее для чистой речи"},
    {"name": "turbo", "size_mb": 1600, "speed": "быстро", "quality": "почти как large-v3 (рекомендуется)"},
    {"name": "medium", "size_mb": 1500, "speed": "средне", "quality": "высокое"},
    {"name": "large-v3", "size_mb": 3100, "speed": "медленно", "quality": "лучшее"},
]
LANGUAGES = {"auto": "Определить автоматически", "ru": "Русский", "en": "English", "uk": "Українська", "de": "Deutsch",
             "fr": "Français", "es": "Español", "it": "Italiano", "pl": "Polski", "pt": "Português", "tr": "Türkçe",
             "nl": "Nederlands", "cs": "Čeština", "ja": "日本語", "zh": "中文", "ko": "한국어", "ar": "العربية"}


def ensure_vendor_path() -> None:
    if str(VENDOR_DIR) not in sys.path:
        sys.path.insert(0, str(VENDOR_DIR))


def embedded_available() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None and VENDOR_DIR.is_dir()


def model_dir() -> Path | None:
    value = load_settings().get("whisp_model_dir")
    return Path(value) if value else None


def info() -> dict:
    if embedded_available():
        return {"available": True, "mode": "embedded", "path": None}
    d = whisp_dir()
    return {"available": d is not None, "mode": "external" if d else None, "path": str(d) if d else None}


def models_status() -> list[dict]:
    """Какие модели уже скачаны. Без faster-whisper проверить нельзя — тогда признак None."""
    result = []
    try:
        ensure_vendor_path()
        import whisper_universal as wu  # лёгкий импорт: faster_whisper подгружается только при создании модели
        for m in MODELS:
            path = wu.find_cached_model(m["name"], model_dir())
            result.append({**m, "downloaded": path is not None})
    except Exception:  # noqa: BLE001
        result = [{**m, "downloaded": None} for m in MODELS]
    return result


def _env() -> dict[str, str]:
    """Whisp зовёт ffmpeg/ffprobe из PATH: добавляем наши."""
    env = dict(os.environ)
    dirs = [str(Path(p).parent) for p in (find_tool("ffmpeg"), find_tool("ffprobe")) if p]
    env["PATH"] = os.pathsep.join([*dict.fromkeys(dirs), env.get("PATH", "")])
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def runner_command(mode: str, params: dict) -> list[str]:
    base = [sys.executable] if config.FROZEN else [sys.executable, str(Path(__file__).resolve().parents[2] / "launcher.py")]
    return [*base, "--whisp-run", mode, json.dumps(params, ensure_ascii=False)]


def parse_event(line: str) -> dict | None:
    if not line.startswith(PREFIX):
        return None
    try:
        return json.loads(line[len(PREFIX):])
    except ValueError:
        return None


def _run_runner(mode: str, params: dict, token: CancelToken | None, on_event: Callable[[dict], None] | None,
                on_line: Callable[[str], None] | None) -> list[dict]:
    events: list[dict] = []

    def handle(line: str) -> None:
        ev = parse_event(line)
        if ev is None:
            if on_line and line.strip():
                on_line(line)
            return
        events.append(ev)
        if on_event:
            on_event(ev)

    code, out = run(runner_command(mode, params), token=token, on_line=handle, env=_env())
    if code != 0:
        err = next((e["message"] for e in reversed(events) if e["k"] == "error"), None)
        raise RuntimeError(f"Whisp завершился с ошибкой: {err or out[-600:]}")
    return events


def download_model(name: str, *, token: CancelToken | None = None, on_event: Callable[[dict], None] | None = None,
                   on_line: Callable[[str], None] | None = None) -> None:
    _require()
    md = model_dir()
    _run_runner("download", {"model": name, "model_dir": str(md) if md else None}, token, on_event, on_line)


def translate_cues(cues: list[dict], target_lang: str, source_lang: str = "auto", device: str = "auto",
                   token: CancelToken | None = None, on_event: Callable[[dict], None] | None = None,
                   on_line: Callable[[str], None] | None = None) -> list[str]:
    """Машинный перевод списка реплик на целевой язык без повторной расшифровки звука."""
    _require()
    md = model_dir()
    params = {"cues": cues, "target_lang": target_lang, "source_lang": source_lang, "device": device,
              "model_dir": str(md) if md else None}
    events = _run_runner("translate_cues", params, token, on_event, on_line)
    done = next((e for e in reversed(events) if e["k"] == "done"), None)
    if not done or "translations" not in done:
        raise RuntimeError("Перевод субтитров завершился без результата.")
    return done["translations"]


def _global_stream_index(source: Path, audio_index: int) -> int:
    """Whisp ждёт сквозной номер потока файла (у видео аудио часто имеет индекс 1), а в проекте хранится номер среди аудиодорожек."""
    from ..media import ffprobe
    streams = ffprobe.probe(source)["audio_streams"]
    if not 0 <= audio_index < len(streams):
        raise RuntimeError(f"В файле нет аудиодорожки № {audio_index + 1}")
    return int(streams[audio_index]["stream_index"])


def _require() -> None:
    if not embedded_available():
        raise RuntimeError("Встроенный Whisp недоступен: не установлен faster-whisper "
                           "(в собранном exe он уже внутри; при запуске из исходников: pip install faster-whisper).")


def transcribe(source: Path, out_dir: Path, *, audio_index: int = 0, model: str = "small", language: str = "auto",
               device: str = "auto", task: str = "transcribe", translate_to: str = "", vad: bool = True,
               max_line_chars: int = 0, max_lines: int = 2, max_duration: float = 0.0,
               token: CancelToken | None = None, on_event: Callable[[dict], None] | None = None,
               on_line: Callable[[str], None] | None = None) -> dict[str, Path]:
    """Возвращает {'original': путь к SRT[, 'translated': путь к переводу]}."""
    out_dir.mkdir(parents=True, exist_ok=True)
    audio_index = _global_stream_index(source, audio_index)
    if not embedded_available():
        return {"original": _transcribe_external(source, out_dir, audio_index, model, language, token, on_line)}
    md = model_dir()
    params = {"source": str(source), "out_dir": str(out_dir), "model": model, "language": language, "device": device,
              "task": task, "translate_to": translate_to, "vad": vad, "audio_stream": audio_index,
              "max_line_chars": max_line_chars, "max_lines": max_lines, "max_duration": max_duration,
              "model_dir": str(md) if md else None, "stem": "whisp"}
    events = _run_runner("transcribe", params, token, on_event, on_line)
    done = next((e for e in reversed(events) if e["k"] == "done"), None)
    if not done:
        raise RuntimeError("Whisp завершился без результата.")
    files = {k: Path(v) for k, v in done.get("files", {}).items() if Path(v).is_file()}
    if "original" not in files:
        raise RuntimeError("Whisp завершился, но SRT-файл не найден в выходной папке.")
    return files


def _transcribe_external(source: Path, out_dir: Path, audio_index: int, model: str, language: str,
                         token: CancelToken | None, on_line) -> Path:
    d = whisp_dir()
    if d is None:
        _require()
    python = load_settings().get("whisp_python") or sys.executable
    cmd = [python, str(d / "whisper_universal.py"), str(source), "-o", str(out_dir), "-f", "srt", "-m", model,
           "-l", language, "--audio-stream", str(audio_index), "--overwrite", "--lang", "ru"]
    code, out = run(cmd, cwd=d, token=token, on_line=on_line)
    if code != 0:
        raise RuntimeError(f"Whisp завершился с ошибкой (код {code}): {out[-800:]}")
    found = sorted(out_dir.glob(f"{source.stem}.whisper.srt"))
    if not found:
        raise RuntimeError("Whisp завершился, но SRT-файл не найден в выходной папке.")
    return found[0]
