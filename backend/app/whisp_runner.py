"""Запуск движка Whisp в отдельном процессе: `WHISP_MEDIA_DESK --whisp-run <режим> <json>`.

Процесс печатает строки `@@WD {json}` с событиями (стадия, прогресс, результат), остальной вывод — обычный журнал Whisp.
Отмена — завершение процесса родителем. Тяжёлые библиотеки (ctranslate2, onnxruntime) живут только здесь, а не в сервере.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PREFIX = "@@WD "


def emit(kind: str, **data) -> None:
    line = PREFIX + json.dumps({"k": kind, **data}, ensure_ascii=False)
    log = os.environ.get("WHISP_RUNNER_LOG")  # для диагностики собранного exe, где stdout может быть недоступен
    if log:
        with open(log, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    if sys.stdout is not None:
        print(line, flush=True)


def _setup() -> None:
    from app.integrations.whisp import ensure_vendor_path
    ensure_vendor_path()
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def _download(p: dict) -> int:
    import whisper_universal as wu
    model_dir = Path(p["model_dir"]) if p.get("model_dir") else None
    emit("stage", name="download", label=f"Загрузка модели {p['model']}")
    wu.download_model(p["model"], model_dir, lambda done, total: emit("download", done=done, total=total))
    emit("done")
    return 0


def _transcribe(p: dict) -> int:
    import whisper_universal as wu
    from i18n import set_language
    set_language("ru")
    wu.setup_logging("INFO")

    source, out_dir = Path(p["source"]), Path(p["out_dir"])
    model_dir = Path(p["model_dir"]) if p.get("model_dir") else None
    translate_to = (p.get("translate_to") or "").lower()
    variants = ["original", "translated"] if translate_to else ["original"]

    emit("stage", name="download", label=f"Проверка модели {p['model']}")
    wu.download_model(p["model"], model_dir, lambda done, total: emit("download", done=done, total=total))
    device = wu.resolve_device(p.get("device", "auto"))
    compute = wu.get_compute_type(device)
    emit("stage", name="load", label=f"Загрузка модели в память ({device})")
    model = wu.create_model(p["model"], device, compute, model_dir)
    emit("device", device=device, compute=compute)

    args = argparse.Namespace(
        task=p.get("task", "transcribe"), language=p.get("language", "auto"), audio_stream=int(p.get("audio_stream", 0)),
        vad_filter=bool(p.get("vad", True)), beam_size=int(p.get("beam_size", 5)),
        max_line_chars=int(p.get("max_line_chars", 0)), max_lines=int(p.get("max_lines", 2)),
        max_duration=float(p.get("max_duration", 0.0)), device=p.get("device", "auto"), model_dir=model_dir,
        temp_dir=None, translate_to=translate_to, variants=variants, cancel_event=None)

    stem = p.get("stem") or source.stem
    outputs = {("original", "srt"): out_dir / f"{stem}.srt"}
    if translate_to:
        outputs[("translated", "srt")] = out_dir / f"{stem}.{translate_to}.srt"
    provider = wu.TranslatorProvider(device, model_dir, lambda d, t: emit("download", done=d, total=t)) if translate_to else None

    emit("stage", name="transcribe", label="Распознавание речи")
    wu.transcribe_one(source, outputs, model, p["model"], device, args,
                      progress_callback=lambda cur, total: emit("progress", done=round(cur, 2), total=round(total, 2)),
                      translator_provider=provider,
                      translate_progress=lambda d, t: emit("translate", done=d, total=t))
    emit("done", files={f"{v}": str(path) for (v, _), path in outputs.items()})
    return 0


def _hide_child_consoles() -> None:
    """exe без консоли: каждый запуск ffmpeg из Whisp иначе мигает чёрным окном."""
    if sys.platform != "win32":
        return
    import subprocess
    orig = subprocess.Popen.__init__

    def init(self, *a, **kw):  # type: ignore[no-untyped-def]
        kw["creationflags"] = kw.get("creationflags", 0) | subprocess.CREATE_NO_WINDOW
        orig(self, *a, **kw)

    subprocess.Popen.__init__ = init  # type: ignore[method-assign]


def main(argv: list[str]) -> int:
    mode, params = argv[0], json.loads(argv[1])
    _hide_child_consoles()
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    _setup()
    try:
        if mode == "download":
            return _download(params)
        if mode == "transcribe":
            return _transcribe(params)
        print(f"неизвестный режим: {mode}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        emit("error", message=str(exc))
        print(f"Ошибка: {exc}", file=sys.stderr)
        return 1
