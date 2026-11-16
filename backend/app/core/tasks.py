"""Обработчики фоновых задач: анализ, рендер, расшифровка; а также экспорт пакета материалов."""
from __future__ import annotations

import shutil
from pathlib import Path

from ..analysis import edit_planner, scene_detector, silence_detector, threshold
from ..editing import exports, render as render_mod, subtitles as subs
from ..editing.timeline import stats
from ..integrations import whisp
from ..media import ffprobe, proxy, waveform
from .fsutil import read_json, write_json_atomic, write_text_atomic
from .job_queue import JobContext, JobQueue
from .project_manager import ProjectError, ProjectManager
from .templates import load_template

EXPORT_FORMATS = {
    "srt": ("subtitles", "edited.srt"), "ass": ("subtitles", "edited.ass"),
    "plan": ("exports", "edit_plan.json"), "info": ("exports", "source_info.json"),
    "v3": ("exports", "final.v3"), "fcpxml": ("exports", "final.fcpxml"), "edl": ("exports", "final.edl"),
}


# ---------- субтитры ----------

def save_cues(pm: ProjectManager, pid: str, cues: list[subs.Cue], origin: str, raw: bytes | None = None) -> None:
    d = pm.dir(pid) / "subtitles"
    d.mkdir(exist_ok=True)
    if raw is not None:
        (d / f"import_{Path(origin).name}").write_bytes(raw)   # исходная расшифровка сохраняется как есть
    write_json_atomic(d / "cues.json", {"origin": origin, "cues": [c.to_dict() for c in cues]})
    write_text_atomic(d / "original.srt", subs.render_srt(cues))
    pm.log_history(pid, "subtitles:import", f"{origin}: {len(cues)}")


def load_cues(pm: ProjectManager, pid: str) -> list[subs.Cue]:
    data = read_json(pm.dir(pid) / "subtitles" / "cues.json")
    return [subs.Cue(**c) for c in data["cues"]] if data else []


def template_for(pm: ProjectManager, pid: str, name: str | None) -> tuple[dict, Path | None]:
    name = name or pm.get(pid)["settings"].get("template", "default")
    try:
        return load_template(name)
    except FileNotFoundError:
        return {}, None


# ---------- экспорт пакета ----------

def export_package(pm: ProjectManager, pid: str, formats: list[str], overwrite: bool = False) -> dict:
    unknown = [f for f in formats if f not in EXPORT_FORMATS]
    if unknown:
        raise ProjectError(f"Неизвестные форматы экспорта: {', '.join(unknown)}")
    d = pm.dir(pid)
    targets = {f: d / EXPORT_FORMATS[f][0] / EXPORT_FORMATS[f][1] for f in formats}
    existing = [t.name for t in targets.values() if t.exists()]
    if existing and not overwrite:
        raise FileExistsError("Файлы уже существуют: " + ", ".join(existing) + ". Подтвердите перезапись.")
    plan, meta = pm.load_plan(pid), pm.metadata(pid)
    source = Path(pm.get(pid)["source"]["path"])
    tpl, _ = template_for(pm, pid, None)
    written = []
    if "plan" in formats:
        write_json_atomic(targets["plan"], plan)
    if "info" in formats:
        write_json_atomic(targets["info"], meta)
    if "v3" in formats:
        write_text_atomic(targets["v3"], exports.v3_json(plan, meta, source))
    if "edl" in formats:
        write_text_atomic(targets["edl"], exports.to_edl(plan, meta, source, pm.get(pid)["name"]))
    if "fcpxml" in formats:
        write_text_atomic(targets["fcpxml"], exports.to_fcpxml(plan, meta, source, pm.get(pid)["name"]))
    if "srt" in formats or "ass" in formats:
        cues = load_cues(pm, pid)
        if not cues:
            raise ProjectError("Расшифровка не загружена: нечего экспортировать как субтитры")
        new_cues = subs.remap_cues(cues, plan)
        if "srt" in formats:
            write_text_atomic(targets["srt"], subs.render_srt(new_cues))
        if "ass" in formats:
            write_text_atomic(targets["ass"], subs.render_ass(new_cues, tpl.get("subtitles")))
    for f, t in targets.items():
        written.append(str(t.relative_to(d)).replace("\\", "/"))
    pm.log_history(pid, "export", ", ".join(formats))
    return {"written": written}


# ---------- задачи ----------

def register_all(queue: JobQueue, pm: ProjectManager) -> None:
    def analyze(ctx: JobContext, p: dict) -> dict:
        pid = ctx.project_id
        project = pm.get(pid)
        settings = {**project["settings"], **{k: v for k, v in p.items()
                                              if k in ("profile", "overrides", "audio_stream", "scene_threshold",
                                                       "detect_scenes")}}
        adir = pm.dir(pid) / "analysis"
        source = pm.source_path(pid)
        ctx.stage("Чтение параметров файла (FFprobe)")
        meta = ffprobe.probe(source)
        if not meta["audio_stream_count"]:
            raise ProjectError("В файле нет аудиодорожек: автоматическое сокращение пауз невозможно")
        a_idx = int(settings["audio_stream"])
        if not 0 <= a_idx < meta["audio_stream_count"]:
            raise ProjectError(f"Нет аудиодорожки №{a_idx}: в файле их {meta['audio_stream_count']}")
        write_json_atomic(adir / "metadata.json", meta)
        pm.update(pid, settings={k: settings[k] for k in ("profile", "overrides", "audio_stream",
                                                          "scene_threshold", "detect_scenes")})
        ctx.progress(0.03)
        params = edit_planner.profile_params(settings["profile"], settings["overrides"])
        dur = meta["duration_ms"]
        state = read_json(adir / "state.json", {})
        if p.get("auto_threshold"):
            ctx.stage("Подбор порога громкости")
            if not (adir / "waveform.json").is_file() or state.get("waveform_audio") != a_idx:
                write_json_atomic(adir / "waveform.json", waveform.compute_peaks(source, a_idx, dur, token=ctx.token))
                state["waveform_audio"] = a_idx
                write_json_atomic(adir / "state.json", state)
            sug = threshold.suggest_threshold(read_json(adir / "waveform.json")["peaks"])
            params["noise_db"] = sug["noise_db"]
            ctx.log(f"Фон {sug['floor_db']} dB, речь {sug['speech_db']} dB -> порог {sug['noise_db']} dBFS"
                    + ("" if sug["confident"] else " (разница мала, значение осторожное)"))

        def sub(lo: float, hi: float):
            return lambda f: ctx.progress(lo + (hi - lo) * f)

        # --- тишина (с кэшем по параметрам) ---
        def silence_pass(noise: float, min_s: float, lo: float, hi: float, label: str) -> list[dict]:
            key = {"audio_stream": a_idx, "noise_db": noise, "min_pause_s": min_s, "source_size": meta["size_bytes"]}
            cache = read_json(adir / f"silence_{label}.json")
            if cache and cache.get("key") == key:
                ctx.log(f"Тишина ({label}): использую сохранённый результат")
                return cache["intervals"]
            ctx.stage(f"Поиск тишины ({label}: {noise} dBFS, от {min_s} с)")
            res = silence_detector.detect_silence(source, a_idx, dur, noise, min_s, ctx.token, sub(lo, hi))
            write_json_atomic(adir / f"silence_{label}.json", {"key": key, "intervals": res})
            return res

        silence = silence_pass(params["noise_db"], params["min_pause_s"], 0.03, 0.40, "main")
        low = None
        if params.get("low_volume_db") is not None:
            low = silence_pass(params["low_volume_db"], params["low_volume_min_s"], 0.40, 0.50, "low")
        write_json_atomic(adir / "silence.json", {"params": params, "silence": silence, "low_volume": low or []})
        ctx.check()

        # --- сцены ---
        scenes = None
        if meta["has_video"] and settings["detect_scenes"]:
            ctx.stage("Поиск смены сцен")
            scenes = scene_detector.detect_scenes(source, dur, settings["scene_threshold"], ctx.token)
            write_json_atomic(adir / "scenes.json", scenes)
            ctx.log(f"Сцен: {len(scenes['scenes'])} ({scenes['engine']})")
        ctx.progress(0.55)

        # --- монтажный план ---
        fps = meta["video"]["fps"] if meta["has_video"] else {"numerator": 25, "denominator": 1}
        plan = edit_planner.build_plan(project_id=pid, source=meta["filename"], duration_ms=dur, fps=fps,
                                       audio_index=a_idx, silence=silence, params=params, low_volume=low)
        if (pm.dir(pid) / "timeline" / "edit_plan.json").is_file():
            name = pm.save_version(pid, "Перед пересозданием плана")
            ctx.log(f"Прежний план сохранён как {name}")
        pm.save_plan(pid, plan)
        ctx.log("План: " + ", ".join(f"{k}={v}" for k, v in stats(plan).items()))
        ctx.check()

        # --- волна, proxy, миниатюры ---
        state = read_json(adir / "state.json", {})
        ctx.stage("Аудиоволна")
        if not (adir / "waveform.json").is_file() or state.get("waveform_audio") != a_idx:
            write_json_atomic(adir / "waveform.json", waveform.compute_peaks(source, a_idx, dur, token=ctx.token))
            state["waveform_audio"] = a_idx
        ctx.progress(0.65)
        ctx.stage("Облегчённая копия для предпросмотра")
        if not (adir / "proxy.mp4").is_file() or state.get("proxy_audio") != a_idx:
            render_mod.check_disk_space(adir, int(meta["size_bytes"] * 0.3) + 100 * 2**20)
            proxy.make_proxy(source, adir / "proxy.mp4", a_idx, dur, meta["has_video"], ctx.token, sub(0.65, 0.93))
            state["proxy_audio"] = a_idx
        if meta["has_video"] and scenes:
            ctx.stage("Контактный лист сцен")
            shutil.rmtree(adir / "thumbnails", ignore_errors=True)
            times = [s["start_ms"] + min(500, (s["end_ms"] - s["start_ms"]) // 2) for s in scenes["scenes"][:80]]
            names = proxy.make_thumbnails(source, adir / "thumbnails", times, ctx.token)
            write_json_atomic(adir / "thumbnails.json", {"files": names, "times_ms": times[:len(names)]})
        write_json_atomic(adir / "state.json", state)
        pm.log_history(pid, "analyze", settings["profile"])
        return {"stats": stats(plan), "scenes": len(scenes["scenes"]) if scenes else 0}

    def render(ctx: JobContext, p: dict) -> dict:
        pid = ctx.project_id
        mode = p.get("mode", "final")
        plan, meta = pm.load_plan(pid), pm.metadata(pid)
        source = pm.source_path(pid)
        tpl, tpl_dir = template_for(pm, pid, p.get("template"))
        options = render_mod.merge_options(mode, tpl, p.get("options"))
        overwrite = bool(p.get("overwrite"))
        out_name = "preview.mp4" if mode == "fast" else "final.mp4"
        out = pm.dir(pid) / "exports" / out_name
        ass = None
        if p.get("burn_subtitles"):
            cues = load_cues(pm, pid)
            if not cues:
                raise ProjectError("Нельзя вшить субтитры: расшифровка не загружена")
            ass = subs.render_ass(subs.remap_cues(cues, plan), tpl.get("subtitles"))
        package = p.get("package", mode == "final")
        formats = list(p.get("formats") or ["srt", "ass", "plan", "info", "v3", "fcpxml"])
        if not package or not read_json(pm.dir(pid) / "subtitles" / "cues.json"):
            formats = [f for f in formats if f not in ("srt", "ass")]
        if package and not overwrite:   # проверяем всё заранее, чтобы не рендерить впустую
            clash = [EXPORT_FORMATS[f][1] for f in formats if (pm.dir(pid) / EXPORT_FORMATS[f][0] / EXPORT_FORMATS[f][1]).exists()]
            if clash:
                raise FileExistsError("Файлы уже существуют: " + ", ".join(clash) + ". Подтвердите перезапись.")
        ctx.stage(f"Рендер ({'быстрый' if mode == 'fast' else 'финальный'})")
        result = render_mod.render(
            plan=plan, meta=meta, source=source, out_path=out, work_dir=pm.dir(pid) / "exports" / ".work",
            options=options, template=tpl, template_dir=tpl_dir, subtitles_ass=ass, overwrite=overwrite,
            token=ctx.token, progress=lambda f: ctx.progress(0.02 + 0.93 * f), log=ctx.log)
        shutil.rmtree(pm.dir(pid) / "exports" / ".work", ignore_errors=True)
        if package and formats:
            ctx.stage("Экспорт сопутствующих материалов")
            result["package"] = export_package(pm, pid, formats, overwrite=True)["written"]
        pm.log_history(pid, f"render:{mode}", out_name)
        return result

    def transcribe(ctx: JobContext, p: dict) -> dict:
        pid = ctx.project_id
        source = pm.source_path(pid)
        a_idx = int(p.get("audio_stream", pm.get(pid)["settings"]["audio_stream"]))
        if (pm.dir(pid) / "subtitles" / "cues.json").is_file() and not p.get("overwrite"):
            raise FileExistsError("Расшифровка уже загружена. Подтвердите перезапись.")
        tmp = pm.dir(pid) / "subtitles" / ".whisp"
        shutil.rmtree(tmp, ignore_errors=True)
        ctx.stage("Расшифровка (Whisp)")
        srt = whisp.transcribe(source, tmp, audio_index=a_idx, model=p.get("model", "small"),
                               language=p.get("language", "auto"), token=ctx.token, on_line=ctx.log)
        raw = srt.read_bytes()
        cues = subs.load_subtitles(srt)
        shutil.rmtree(tmp, ignore_errors=True)
        save_cues(pm, pid, cues, f"{source.stem}.whisper.srt", raw)
        return {"cues": len(cues)}

    queue.register("analyze", analyze)
    queue.register("render", render)
    queue.register("transcribe", transcribe)
