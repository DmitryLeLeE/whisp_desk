"""Обработчики фоновых задач: анализ, рендер, расшифровка; а также экспорт пакета материалов."""
from __future__ import annotations

import shutil
from pathlib import Path

from ..analysis import compare as compare_mod, edit_planner, scene_detector, silence_detector, threshold
from ..editing import exports, render as render_mod, subtitles as subs
from ..editing.timeline import stats
from ..integrations import auto_editor, whisp
from ..media import ffprobe, proxy, waveform
from .fsutil import read_json, write_json_atomic, write_text_atomic
from .job_queue import JobContext, JobQueue
from .project_manager import ProjectError, ProjectManager
from .templates import load_template

EXPORT_FORMATS = {
    "premiere": ("exports", "premiere.xml"),
    "fcpxml": ("exports", "final.fcpxml"),
    "edl": ("exports", "final.edl"),
    "otio": ("exports", "final.otio"),
    "v3": ("exports", "final.v3"),
    "davinci_markers": ("exports", "davinci_markers.csv"),
    "chapters": ("exports", "chapters.txt"),
    "audacity": ("exports", "audacity_labels.txt"),
    "plan": ("exports", "edit_plan.json"),
    "info": ("exports", "source_info.json"),
    "srt": ("subtitles", "edited.srt"),
    "vtt": ("subtitles", "edited.vtt"),
    "ass": ("subtitles", "edited.ass"),
    "bilingual_srt": ("subtitles", "edited.bilingual.srt"),
    "transcript": ("exports", "transcript.txt"),
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
    extras: list[Path] = []
    if "premiere" in formats:
        write_text_atomic(targets["premiere"], exports.to_premiere_xml(plan, meta, source, pm.get(pid)["name"]))
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
    if "otio" in formats:
        write_text_atomic(targets["otio"], exports.to_otio(plan, meta, source, pm.get(pid)["name"]))
    if "davinci_markers" in formats:
        write_text_atomic(targets["davinci_markers"], exports.to_davinci_markers_csv(plan, meta))
    if "chapters" in formats:
        write_text_atomic(targets["chapters"], exports.to_chapters(plan, d / "exports" / "chapters.json"))
    if "audacity" in formats:
        write_text_atomic(targets["audacity"], exports.to_audacity_labels(plan))

    sub_formats = {"srt", "vtt", "ass", "bilingual_srt", "transcript"}
    if sub_formats & set(formats):
        cues = load_cues(pm, pid)
        if not cues:
            raise ProjectError("Расшифровка не загружена: нечего экспортировать как субтитры")
        new_cues = subs.remap_cues(cues, plan)
        if "srt" in formats:
            write_text_atomic(targets["srt"], subs.render_srt(new_cues))
            # Машинный перевод (если делали расшифровку с переводом) пересчитывается под монтаж так же, как оригинал.
            for tr in sorted((d / "subtitles").glob("translated.*.srt")):
                lang = tr.stem.split(".", 1)[1]
                extra = targets["srt"].with_name(f"{targets['srt'].stem}.{lang}.srt")
                write_text_atomic(extra, subs.render_srt(subs.remap_cues(subs.load_subtitles(tr), plan)))
                extras.append(extra)
        if "vtt" in formats:
            write_text_atomic(targets["vtt"], subs.render_vtt(new_cues))
        if "ass" in formats:
            write_text_atomic(targets["ass"], subs.render_ass(new_cues, tpl.get("subtitles")))
        if "transcript" in formats:
            write_text_atomic(targets["transcript"], subs.render_transcript(new_cues))
        if "bilingual_srt" in formats:
            tr_files = sorted((d / "subtitles").glob("translated.*.srt"))
            if tr_files:
                tr_cues = subs.load_subtitles(tr_files[0])
                new_tr_cues = subs.remap_cues(tr_cues, plan)
                write_text_atomic(targets["bilingual_srt"], subs.render_bilingual_srt(new_cues, new_tr_cues))
            else:
                write_text_atomic(targets["bilingual_srt"], subs.render_srt(new_cues))
    for t in [*targets.values(), *extras]:
        written.append(str(t.relative_to(d)).replace("\\", "/"))
    pm.log_history(pid, "export", ", ".join(formats))
    return {"written": written}


def _render_with_auto_editor(ctx: JobContext, plan: dict, meta: dict, source: Path, out: Path, work: Path,
                             options: dict, ass: str | None, overwrite: bool) -> dict:
    """Альтернативный рендер: монтаж передаётся Auto-Editor как .v3. Шаблон и вшитые субтитры не поддерживаются."""
    if ass:
        raise ProjectError("Auto-Editor не вшивает субтитры: выключите вшивание или выберите рендер FFmpeg")
    if out.exists() and not overwrite:
        raise FileExistsError(f"Файл уже существует: {out.name}. Подтвердите перезапись.")
    ctx.stage("Рендер (Auto-Editor)")
    part = out.with_name(out.stem + ".part" + out.suffix)
    expected = render_mod.output_duration_ms(plan) / 1000
    auto_editor.render_v3(plan, meta, source, part, work, normalize=options["audio"]["normalize"],
                          audio_bitrate=options["video"]["audio_bitrate"], token=ctx.token,
                          progress=lambda f: ctx.progress(0.02 + 0.93 * f))
    info = render_mod.verify_output(part, expected, meta["has_video"])
    part.replace(out)
    return {"output": out.name, "encoder": "auto-editor", "duration_ms": info["duration_ms"],
            "expected_ms": round(expected * 1000), "size_bytes": out.stat().st_size}


# ---------- задачи ----------

def register_all(queue: JobQueue, pm: ProjectManager) -> None:
    def analyze(ctx: JobContext, p: dict) -> dict:
        pid = ctx.project_id
        project = pm.get(pid)
        settings = {**project["settings"], **{k: v for k, v in p.items()
                                              if k in ("profile", "overrides", "audio_stream", "scene_threshold",
                                                       "detect_scenes", "engine")}}
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
                                                          "scene_threshold", "detect_scenes", "engine")})
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

        engine = settings.get("engine", "builtin")
        ae_cuts = None
        if engine == "auto-editor":
            ctx.stage("Поиск пауз (Auto-Editor)")
            fps0 = meta["video"]["fps"] if meta["has_video"] else {"numerator": 25, "denominator": 1}
            ae_cuts = auto_editor.detect_cuts(
                source, audio_index=a_idx, fps=fps0, duration_ms=dur, noise_db=params["noise_db"],
                min_pause_s=params["min_pause_s"], pad_before_s=params["pad_before_s"],
                pad_after_s=params["pad_after_s"], min_keep_s=params["min_keep_s"], token=ctx.token)
            if params.get("low_volume_db") is not None:
                ctx.log("Проход «низкая громкость» доступен только во встроенном движке — пропущен")
            write_json_atomic(adir / "silence.json", {"engine": engine, "params": params, "cuts": ae_cuts})
            silence, low = [], None
            ctx.progress(0.5)
        else:
            silence = silence_pass(params["noise_db"], params["min_pause_s"], 0.03, 0.40, "main")
            low = None
            if params.get("low_volume_db") is not None:
                low = silence_pass(params["low_volume_db"], params["low_volume_min_s"], 0.40, 0.50, "low")
            write_json_atomic(adir / "silence.json", {"engine": engine, "params": params, "silence": silence,
                                                      "low_volume": low or []})
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
        if ae_cuts is not None:
            plan = edit_planner.build_plan_from_cuts(project_id=pid, source=meta["filename"], duration_ms=dur,
                                                     fps=fps, audio_index=a_idx, cuts=ae_cuts)
        else:
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
        return {"engine": engine, "stats": stats(plan), "scenes": len(scenes["scenes"]) if scenes else 0}

    def render(ctx: JobContext, p: dict) -> dict:
        pid = ctx.project_id
        mode = p.get("mode", "final")
        plan, meta = pm.load_plan(pid), pm.metadata(pid)
        source = pm.source_path(pid)
        tpl, tpl_dir = template_for(pm, pid, p.get("template"))
        options = render_mod.merge_options(mode, tpl, p.get("options"))
        overwrite = bool(p.get("overwrite"))
        out_name = "preview.mp4" if mode == "fast" else "final.mp4"
        package = p.get("package", mode == "final")
        if p.get("range_start_ms") is not None and p.get("range_end_ms") is not None:
            r_start = int(p["range_start_ms"])
            r_end = int(p["range_end_ms"])
            import copy
            plan = copy.deepcopy(plan)
            plan["segments"] = [dict(s) for s in plan["segments"] if s["source_end_ms"] > r_start and s["source_start_ms"] < r_end]
            for s in plan["segments"]:
                s["source_start_ms"] = max(r_start, s["source_start_ms"])
                s["source_end_ms"] = min(r_end, s["source_end_ms"])
            out_name = f"range_{r_start // 1000}s_{r_end // 1000}s.mp4"
            package = False
        out = pm.dir(pid) / "exports" / out_name
        ass = None
        if p.get("burn_subtitles"):
            cues = load_cues(pm, pid)
            if not cues:
                raise ProjectError("Нельзя вшить субтитры: расшифровка не загружена")
            ass = subs.render_ass(subs.remap_cues(cues, plan), tpl.get("subtitles"))
        formats = list(p.get("formats") or ["premiere", "fcpxml", "davinci_markers", "srt", "plan", "info", "v3", "otio"])
        if not package or not read_json(pm.dir(pid) / "subtitles" / "cues.json"):
            formats = [f for f in formats if f not in ("srt", "ass")]
        if package and not overwrite:   # проверяем всё заранее, чтобы не рендерить впустую
            clash = [EXPORT_FORMATS[f][1] for f in formats if (pm.dir(pid) / EXPORT_FORMATS[f][0] / EXPORT_FORMATS[f][1]).exists()]
            if clash:
                raise FileExistsError("Файлы уже существуют: " + ", ".join(clash) + ". Подтвердите перезапись.")
        work = pm.dir(pid) / "exports" / ".work"
        if p.get("engine") == "auto-editor":
            result = _render_with_auto_editor(ctx, plan, meta, source, out, work, options, ass, overwrite)
        else:
            ctx.stage(f"Рендер ({'быстрый' if mode == 'fast' else 'финальный'})")
            result = render_mod.render(
                plan=plan, meta=meta, source=source, out_path=out, work_dir=work, options=options, template=tpl,
                template_dir=tpl_dir, subtitles_ass=ass, overwrite=overwrite, token=ctx.token,
                progress=lambda f: ctx.progress(0.02 + 0.93 * f), log=ctx.log)
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

        def on_event(ev: dict) -> None:
            kind = ev["k"]
            if kind == "stage":
                ctx.stage(ev["label"])
            elif kind == "download" and ev.get("total"):
                ctx.progress(0.02 + 0.08 * ev["done"] / ev["total"], message=f"Загрузка модели: {ev['done'] / 1048576:.0f} из {ev['total'] / 1048576:.0f} МБ")
            elif kind == "progress" and ev.get("total"):
                ctx.progress(0.12 + 0.83 * ev["done"] / ev["total"], message=f"Распознано {ev['done']:.0f} из {ev['total']:.0f} с")
            elif kind == "translate" and ev.get("total"):
                ctx.progress(0.95 + 0.04 * ev["done"] / ev["total"], message="Перевод субтитров")

        opts = {k: p[k] for k in ("device", "task", "translate_to", "vad", "max_line_chars", "max_lines", "max_duration", "initial_prompt") if k in p}
        files = whisp.transcribe(source, tmp, audio_index=a_idx, model=p.get("model", "small"),
                                 language=p.get("language", "auto"), token=ctx.token, on_event=on_event, on_line=ctx.log, **opts)
        srt = files["original"]
        raw = srt.read_bytes()
        cues = subs.load_subtitles(srt)
        save_cues(pm, pid, cues, f"{source.stem}.whisper.srt", raw)
        extra = []
        for variant, path in files.items():
            if variant != "original":
                lang = path.stem.rsplit(".", 1)[-1]
                dst = pm.dir(pid) / "subtitles" / f"translated.{lang}.srt"
                shutil.copyfile(path, dst)
                extra.append(dst.name)
        shutil.rmtree(tmp, ignore_errors=True)
        return {"cues": len(cues), "translations": extra}

    def compare_engines(ctx: JobContext, _p: dict) -> dict:
        pid = ctx.project_id
        meta = pm.metadata(pid)
        if not meta:
            raise ProjectError("Сначала запустите анализ: нужны метаданные файла")
        settings = pm.get(pid)["settings"]
        params = edit_planner.profile_params(settings["profile"], settings["overrides"])
        a_idx, dur = int(settings["audio_stream"]), meta["duration_ms"]
        source = pm.source_path(pid)
        fps = meta["video"]["fps"] if meta["has_video"] else {"numerator": 25, "denominator": 1}
        ctx.stage("Встроенный детектор")
        sil = silence_detector.detect_silence(source, a_idx, dur, params["noise_db"], params["min_pause_s"], ctx.token)
        mine = edit_planner.build_plan(project_id=pid, source=meta["filename"], duration_ms=dur, fps=fps,
                                       audio_index=a_idx, silence=sil, params=params)
        ctx.progress(0.5)
        ctx.stage("Auto-Editor")
        cuts = auto_editor.detect_cuts(source, audio_index=a_idx, fps=fps, duration_ms=dur, noise_db=params["noise_db"],
                                       min_pause_s=params["min_pause_s"], pad_before_s=params["pad_before_s"],
                                       pad_after_s=params["pad_after_s"], min_keep_s=params["min_keep_s"], token=ctx.token)
        theirs = edit_planner.build_plan_from_cuts(project_id=pid, source=meta["filename"], duration_ms=dur, fps=fps,
                                                   audio_index=a_idx, cuts=cuts)
        res = compare_mod.compare(compare_mod.cut_intervals(mine), compare_mod.cut_intervals(theirs),
                                  ("builtin", "auto_editor"))
        res["params"] = params
        write_json_atomic(pm.dir(pid) / "analysis" / "compare.json", res)
        ctx.log(f"Совпадение сокращений: {res['agreement'] * 100:.0f}%")
        return res

    def translate_subtitles(ctx: JobContext, p: dict) -> dict:
        pid = ctx.project_id
        cues = load_cues(pm, pid)
        if not cues:
            raise ProjectError("Расшифровка не найдена: сначала распознайте или загрузите субтитры")
        target_lang = p.get("target_lang", "en")
        source_lang = p.get("source_lang", "auto")
        device = p.get("device", "auto")
        ctx.stage(f"Перевод на {target_lang}")

        def on_event(ev: dict) -> None:
            if ev.get("k") == "stage":
                ctx.stage(ev.get("label", "Перевод"))
            elif ev.get("k") == "translate" and ev.get("total"):
                ctx.progress(ev["done"] / ev["total"], message=f"Переведено {ev['done']} из {ev['total']} реплик")

        tr_texts = whisp.translate_cues([c.to_dict() for c in cues], target_lang, source_lang=source_lang,
                                        device=device, token=ctx.token, on_event=on_event, on_line=ctx.log)
        tr_cues = [subs.Cue(c.start_ms, c.end_ms, tr) for c, tr in zip(cues, tr_texts)]
        dst = pm.dir(pid) / "subtitles" / f"translated.{target_lang}.srt"
        write_text_atomic(dst, subs.render_srt(tr_cues))
        pm.log_history(pid, "subtitles:translate", f"{target_lang}: {len(tr_cues)}")
        return {"target_lang": target_lang, "cues": len(tr_cues), "file": dst.name}

    queue.register("compare", compare_engines)
    queue.register("analyze", analyze)
    queue.register("render", render)
    queue.register("transcribe", transcribe)
    queue.register("translate_subtitles", translate_subtitles)
