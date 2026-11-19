"""Рендер итогового видео через FFmpeg по монтажному плану."""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Callable

from ..core.config import require_tool
from ..core.proc import CancelToken, run
from ..integrations.ffmpeg import info as ffmpeg_info
from ..media import ffprobe
from .timeline import kept_ranges, output_duration_ms, snap_ms

DEFAULT_AUDIO = {
    "normalize": False, "target_lufs": -16.0, "true_peak_db": -1.5, "limiter": False,
    "volume_db": 0.0, "declick_ms": 8, "fade_in_s": 0.0, "fade_out_s": 0.0, "sample_rate": 48000,
    "denoise": False, "denoise_level": 12, "denoise_floor": -25,
    "voice_enhancer": "off",
}
MODES = {
    "fast": {"height": 480, "crf": 28, "preset": "veryfast", "audio_bitrate": "96k"},
    "final": {"height": None, "crf": 20, "preset": "veryfast", "audio_bitrate": "192k"},
}
_TIME = re.compile(r"out_time_us=(\d+)")


class RenderError(RuntimeError):
    pass


HW_ENCODERS = ("h264_nvenc", "h264_qsv", "h264_amf")
_encoder_cache: dict[str, bool] = {}


def encoder_works(name: str) -> bool:
    """Пробное кодирование одного кадра: наличие в списке кодеков не гарантирует, что есть железо."""
    if name == "libx264":
        return True
    if name not in _encoder_cache:
        try:
            code, _ = run([require_tool("ffmpeg"), "-v", "error", "-nostdin", "-f", "lavfi", "-i",
                           "color=s=256x256:d=0.2", "-frames:v", "2", "-c:v", name, "-f", "null", "-"])
        except Exception:  # noqa: BLE001
            code = 1
        _encoder_cache[name] = code == 0
    return _encoder_cache[name]


def _script_flags(version_line: str) -> list[str]:
    """`-filter_complex_script` убран в FFmpeg 8, вместо него `-/filter_complex` (есть с 7.0).
    Сборки master/git (N-12345-g...) считаем новыми."""
    m = re.search(r"version (\d+)\.", version_line or "")
    return ["-filter_complex_script"] if m and int(m.group(1)) < 7 else ["-/filter_complex"]


def pick_encoder(preference: str = "libx264") -> str:
    """'auto' — первый рабочий аппаратный энкодер, иначе libx264. Явно заданный нерабочий — откат на libx264."""
    if preference == "auto":
        return next((e for e in HW_ENCODERS if encoder_works(e)), "libx264")
    if preference in HW_ENCODERS and not encoder_works(preference):
        return "libx264"
    return preference if preference in HW_ENCODERS else "libx264"


def video_codec_args(encoder: str, v: dict) -> list[str]:
    crf = str(v["crf"])
    if encoder == "h264_nvenc":
        return ["-c:v", encoder, "-preset", "p5", "-rc", "vbr", "-cq", crf, "-b:v", "0", "-pix_fmt", "yuv420p"]
    if encoder == "h264_qsv":
        return ["-c:v", encoder, "-global_quality", crf, "-preset", "veryfast", "-pix_fmt", "nv12"]
    if encoder == "h264_amf":
        return ["-c:v", encoder, "-quality", "balanced", "-rc", "cqp", "-qp_i", crf, "-qp_p", crf, "-pix_fmt", "yuv420p"]
    return ["-c:v", "libx264", "-preset", str(v["preset"]), "-crf", crf, "-pix_fmt", "yuv420p"]


def _sec(ms: int) -> str:
    return f"{ms / 1000:.6f}"


def merge_options(mode: str, template: dict | None, overrides: dict | None) -> dict:
    """Приоритет: переопределения запроса > шаблон > умолчания режима."""
    if mode not in MODES:
        raise RenderError(f"Неизвестный режим рендера: {mode}")
    template = template or {}
    overrides = overrides or {}
    video = {"encoder": "libx264", **MODES[mode], **template.get("export", {})}
    if mode == "fast":  # быстрый режим всегда лёгкий, шаблон его не утяжеляет
        video.update({k: MODES["fast"][k] for k in ("height", "crf", "preset", "audio_bitrate")})
    video.update(overrides.get("video", {}))
    audio = {**DEFAULT_AUDIO, **template.get("audio", {}), **overrides.get("audio", {})}
    return {"mode": mode, "video": video, "audio": audio}


def output_size(meta: dict, height: int | None, aspect_ratio: str = "original") -> tuple[int, int]:
    if aspect_ratio in ("9:16_crop", "9:16_pad"):
        return (1080, 1920) if not height or height >= 1080 else (720, 1280)
    w, h = meta["video"]["width"], meta["video"]["height"]
    if height and h > height:
        w, h = round(w * height / h / 2) * 2, height
    return w - w % 2, h - h % 2


def build_filter_script(plan: dict, meta: dict, options: dict, *, has_subs: bool, logo: dict | None,
                        extra_inputs: dict[str, int], size: tuple[int, int],
                        intro_s: float = 0.0, outro_s: float = 0.0) -> tuple[str, float]:
    """Возвращает (текст filter_complex, ожидаемая длительность основной части в секундах)."""
    ranges = kept_ranges(plan)
    if not ranges:
        raise RenderError("В плане нет сохраняемых фрагментов: нечего рендерить.")
    audio = options["audio"]
    sr = int(audio["sample_rate"] or meta["audio_streams"][plan.get("audio_stream", 0)]["sample_rate"] or 48000)
    a_idx = plan.get("audio_stream", 0)
    has_video = meta["has_video"]
    n = len(ranges)
    declick = audio["declick_ms"] / 1000
    parts: list[str] = []
    fps = meta["video"]["fps"] if has_video else None
    vsrc = "[0:v:0]"
    if has_video:
        if meta["video"]["variable_frame_rate"]:
            parts.append(f"[0:v:0]fps={fps['numerator']}/{fps['denominator']}[vcfr]")
            vsrc = "[vcfr]"
        if n > 1:
            labels = "".join(f"[vs{i}]" for i in range(n))
            parts.append(f"{vsrc}split={n}{labels}")
    for i, (a, b) in enumerate(ranges):
        dur = (b - a) / 1000
        if has_video:
            src = f"[vs{i}]" if n > 1 else vsrc
            parts.append(f"{src}trim=start={_sec(a)}:end={_sec(b)},setpts=PTS-STARTPTS[v{i}]")
        chain = f"[0:a:{a_idx}]atrim=start={_sec(a)}:end={_sec(b)},asetpts=PTS-STARTPTS,aresample={sr}"
        if declick > 0 and dur > 2 * declick:
            if a > 0:
                chain += f",afade=t=in:st=0:d={declick:.4f}"
            if b < plan["duration_ms"]:
                chain += f",afade=t=out:st={dur - declick:.6f}:d={declick:.4f}"
        parts.append(f"{chain}[a{i}]")
    if has_video:
        inputs = "".join(f"[v{i}][a{i}]" for i in range(n))
        parts.append(f"{inputs}concat=n={n}:v=1:a=1[vc][ac]")
    else:
        inputs = "".join(f"[a{i}]" for i in range(n))
        parts.append(f"{inputs}concat=n={n}:v=0:a=1[ac]")

    # --- звук после склейки ---
    a_chain: list[str] = []
    if audio.get("denoise"):
        nr = int(audio.get("denoise_level") or 12)
        nf = int(audio.get("denoise_floor") or -25)
        a_chain.append(f"afftdn=nr={nr}:nf={nf}:tn=1")
    enhancer = audio.get("voice_enhancer", "off")
    if enhancer == "podcast":
        a_chain.append("highpass=f=80,equalizer=f=3000:width_type=o:w=1:g=3,acompressor=threshold=-18dB:ratio=3:attack=10:release=100")
    elif enhancer == "clarity":
        a_chain.append("highpass=f=100,equalizer=f=6000:width_type=o:w=1:g=-4,equalizer=f=4000:width_type=o:w=1:g=3.5")
    elif enhancer == "warmth":
        a_chain.append("highpass=f=75,equalizer=f=220:width_type=o:w=1:g=3,equalizer=f=3500:width_type=o:w=1:g=1.5")
    elif enhancer == "radio":
        a_chain.append("highpass=f=90,lowpass=f=11000,equalizer=f=250:width_type=o:w=1:g=3,equalizer=f=4500:width_type=o:w=1:g=4,acompressor=threshold=-14dB:ratio=4:attack=5:release=50")
    if audio["volume_db"]:
        a_chain.append(f"volume={audio['volume_db']}dB")
    if audio["normalize"]:
        a_chain.append(f"loudnorm=I={audio['target_lufs']}:TP={audio['true_peak_db']}:LRA=11")
    if audio["limiter"]:
        limit = 10 ** (audio["true_peak_db"] / 20)
        a_chain.append(f"alimiter=limit={limit:.4f}")
    total_s = sum(b - a for a, b in ranges) / 1000
    if audio["fade_in_s"]:
        a_chain.append(f"afade=t=in:st=0:d={audio['fade_in_s']}")
    if audio["fade_out_s"]:
        a_chain.append(f"afade=t=out:st={max(0.0, total_s - audio['fade_out_s']):.3f}:d={audio['fade_out_s']}")
    has_cards = bool(intro_s or outro_s)
    if has_cards:
        a_chain.append(f"aformat=sample_rates={sr}:channel_layouts=stereo")
    parts.append(f"[ac]{','.join(a_chain) if a_chain else 'anull'}[amain]")

    # --- фоновая музыка с авто-приглушением (BGM + Auto-Ducking) ---
    bgm = options.get("audio", {}).get("bgm")
    if bgm and "bgm" in extra_inputs:
        bi = extra_inputs["bgm"]
        bgm_vol = max(0.01, min(1.0, float(bgm.get("volume", 0.15))))
        ducking = bool(bgm.get("ducking", True))
        parts.append(f"[{bi}:a]aformat=sample_rates={sr}:channel_layouts=stereo,volume={bgm_vol:.3f}[bgm_raw]")
        if ducking:
            parts.append("[bgm_raw][amain]sidechaincompress=threshold=0.035:ratio=7:attack=120:release=700[bgm_ducked]")
            parts.append("[amain][bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2[amixed]")
        else:
            parts.append("[amain][bgm_raw]amix=inputs=2:duration=first:dropout_transition=2[amixed]")
        label_a = "[amixed]"
    else:
        label_a = "[amain]"

    if not has_video:
        parts.append(f"{label_a}anull[aout]")
        return ";\n".join(parts) + "\n", total_s

    # --- видео после склейки ---
    w, h = size
    aspect = options.get("video", {}).get("aspect_ratio", "original")
    v_chain = []
    if aspect == "9:16_crop":
        v_chain.extend(["crop=ih*9/16:ih:(iw-ih*9/16)/2:0", f"scale={w}:{h}:flags=bicubic", "setsar=1"])
    elif aspect == "9:16_pad":
        v_chain.extend([f"scale={w}:{h}:force_original_aspect_ratio=decrease", f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black", "setsar=1"])
    else:
        if (w, h) != (meta["video"]["width"], meta["video"]["height"]):
            v_chain.append(f"scale={w}:{h}:flags=bicubic")
        v_chain.append("setsar=1")
    if has_subs:
        v_chain.append("subtitles=subs.ass")
    label = "[vc]"
    parts.append(f"{label}{','.join(v_chain)}[vtxt]")
    label = "[vtxt]"
    if logo:
        li = extra_inputs["logo"]
        lw = max(16, round(w * float(logo.get("scale", 0.12))))
        m = int(logo.get("margin", 24))
        pos = {"top-left": f"{m}:{m}", "top-right": f"W-w-{m}:{m}",
               "bottom-left": f"{m}:H-h-{m}", "bottom-right": f"W-w-{m}:H-h-{m}"}[logo.get("position", "top-right")]
        parts.append(f"[{li}:v]scale={lw}:-1[lg]")
        parts.append(f"{label}[lg]overlay={pos}[vlogo]")
        label = "[vlogo]"
    fps_expr = f"{fps['numerator']}/{fps['denominator']}"
    seq_v, seq_a = [], []

    def card(key: str, dur: float, tag: str) -> None:
        idx = extra_inputs[key]
        parts.append(f"[{idx}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
                     f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps_expr},format=yuv420p[v{tag}]")
        parts.append(f"anullsrc=r={sr}:cl=stereo,atrim=0:{dur}[a{tag}]")
        seq_v.append(f"[v{tag}]")
        seq_a.append(f"[a{tag}]")

    if intro_s:
        card("intro", intro_s, "intro")
    seq_v.append(label)
    seq_a.append(label_a)
    if outro_s:
        card("outro", outro_s, "outro")
    if has_cards:
        joined = "".join(f"{v}{a}" for v, a in zip(seq_v, seq_a))
        parts.append(f"{joined}concat=n={len(seq_v)}:v=1:a=1[vout][aout]")
    else:
        parts.append(f"{label}null[vout]")
        parts.append(f"{label_a}anull[aout]")
    return ";\n".join(parts) + "\n", total_s


def check_disk_space(target_dir: Path, estimate_bytes: int) -> None:
    free = shutil.disk_usage(target_dir).free
    if free < estimate_bytes:
        raise RenderError(
            f"Недостаточно места на диске: нужно около {estimate_bytes // 2**20} МБ, свободно {free // 2**20} МБ."
        )


def verify_output(part: Path, expected_s: float, has_video: bool) -> dict:
    """Повторный FFprobe результата: читается, длительность в допуске, дорожки на месте. При неудаче файл удаляется."""
    try:
        res = ffprobe.probe(part)
    except Exception as exc:
        part.unlink(missing_ok=True)
        raise RenderError(f"Результат не прошёл проверку FFprobe: {exc}") from exc
    got_s = res["duration_ms"] / 1000
    problems = []
    if abs(got_s - expected_s) > max(0.5, expected_s * 0.01):
        problems.append(f"длительность {got_s:.2f} с вместо {expected_s:.2f} с")
    if not res["audio_streams"]:
        problems.append("нет аудиодорожки")
    if has_video and not res["has_video"]:
        problems.append("нет видеодорожки")
    if problems:
        part.unlink(missing_ok=True)
        raise RenderError("Проверка результата не пройдена: " + "; ".join(problems))
    return res


def render(*, plan: dict, meta: dict, source: Path, out_path: Path, work_dir: Path, options: dict,
           template: dict | None = None, template_dir: Path | None = None, subtitles_ass: str | None = None,
           overwrite: bool = False, token: CancelToken | None = None,
           progress: Callable[[float], None] | None = None, log: Callable[[str], None] | None = None) -> dict:
    log = log or (lambda _m: None)
    template = template or {}
    if not source.is_file():
        raise RenderError(f"Исходный файл недоступен: {source}")
    if out_path.exists() and not overwrite:
        raise FileExistsError(f"Файл уже существует: {out_path.name}. Подтвердите перезапись.")
    work_dir.mkdir(parents=True, exist_ok=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    has_video = meta["has_video"]
    size = output_size(meta, options["video"].get("height"), options["video"].get("aspect_ratio", "original")) if has_video else (0, 0)
    kept_ms = output_duration_ms(plan)
    ratio = kept_ms / max(1, plan["duration_ms"])
    check_disk_space(out_path.parent, int(meta["size_bytes"] * ratio * 1.2) + 200 * 2**20)

    inputs: list[str] = ["-i", str(source)]
    extra: dict[str, int] = {}
    logo = None
    intro_s = outro_s = 0.0
    if has_video and template_dir:
        def asset(name: str) -> Path | None:
            p = (template_dir / name).resolve()
            if template_dir.resolve() not in p.parents:
                raise RenderError(f"Файл шаблона вне каталога шаблона: {name}")
            return p if p.is_file() else None

        if template.get("logo") and (lp := asset(template["logo"]["file"])):
            logo = template["logo"]
            extra["logo"] = len(extra) + 1
            inputs += ["-i", str(lp)]
        if template.get("intro") and (ip := asset(template["intro"]["image"])):
            intro_s = float(template["intro"].get("duration_s", 3))
            extra["intro"] = len(extra) + 1
            inputs += ["-loop", "1", "-t", str(intro_s), "-i", str(ip)]
        if template.get("outro") and (op := asset(template["outro"]["image"])):
            outro_s = float(template["outro"].get("duration_s", 3))
            extra["outro"] = len(extra) + 1
            inputs += ["-loop", "1", "-t", str(outro_s), "-i", str(op)]

    # Фоновая музыка с авто-приглушением (BGM)
    bgm = options.get("audio", {}).get("bgm")
    if bgm and bgm.get("path"):
        bgm_path = Path(bgm["path"]).resolve()
        if bgm_path.is_file():
            extra["bgm"] = len(extra) + 1
            inputs += ["-stream_loop", "-1", "-i", str(bgm_path)]

    is_audio_only = bool(options.get("audio_only")) or out_path.suffix.lower() == ".mp3"
    effective_has_video = has_video and not is_audio_only

    has_subs = bool(subtitles_ass) and effective_has_video
    if has_subs:
        (work_dir / "subs.ass").write_text(subtitles_ass or "", encoding="utf-8")
    script, main_s = build_filter_script(plan, meta, options, has_subs=has_subs, logo=logo, extra_inputs=extra,
                                         size=size, intro_s=intro_s, outro_s=outro_s)
    script_path = work_dir / "filter.txt"
    script_path.write_text(script, encoding="utf-8")
    expected_s = main_s + intro_s + outro_s

    part = out_path.with_name(out_path.stem + ".part" + out_path.suffix)
    v = options["video"]
    encoder = pick_encoder(v.get("encoder", "libx264")) if effective_has_video else "libx264"

    script_flag = _script_flags(ffmpeg_info().get("version", ""))

    def build_cmd(enc: str) -> list[str]:
        c = [require_tool("ffmpeg"), "-y", "-v", "error", "-nostdin", "-progress", "pipe:1", *inputs,
             *script_flag, str(script_path)]
        if effective_has_video:
            c += ["-map", "[vout]", "-map", "[aout]", *video_codec_args(enc, v)]
            return c + ["-c:a", "aac", "-b:a", str(v["audio_bitrate"]), "-ar", str(options["audio"]["sample_rate"]),
                        "-movflags", "+faststart", "-f", "mp4", str(part)]
        else:
            c += ["-map", "[aout]"]
            if out_path.suffix.lower() == ".mp3":
                return c + ["-c:a", "libmp3lame", "-b:a", str(v.get("audio_bitrate", "192k")),
                            "-ar", str(options["audio"]["sample_rate"]), "-f", "mp3", str(part)]
            return c + ["-c:a", "aac", "-b:a", str(v.get("audio_bitrate", "192k")),
                        "-ar", str(options["audio"]["sample_rate"]), "-movflags", "+faststart", "-f", "mp4", str(part)]

    log(f"Рендер: {len(kept_ranges(plan))} фрагментов, ожидаемая длительность {expected_s:.1f} с, кодек {encoder}")

    def on_line(line: str) -> None:
        m = _TIME.match(line)
        if m and progress:
            progress(min(1.0, int(m.group(1)) / 1e6 / max(expected_s, 0.001)))

    try:
        code, out = run(build_cmd(encoder), cwd=work_dir, token=token, on_line=on_line)
        if code != 0 and encoder != "libx264":
            log(f"Аппаратный энкодер {encoder} не сработал, повтор на процессоре (libx264)")
            part.unlink(missing_ok=True)
            encoder = "libx264"
            code, out = run(build_cmd(encoder), cwd=work_dir, token=token, on_line=on_line)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    if code != 0:
        part.unlink(missing_ok=True)
        raise RenderError(f"FFmpeg завершился с ошибкой (код {code}):\n{out[-1500:]}")

    res = verify_output(part, expected_s, effective_has_video)
    part.replace(out_path)
    if progress:
        progress(1.0)
    return {"output": out_path.name, "encoder": encoder, "duration_ms": res["duration_ms"], "expected_ms": round(expected_s * 1000),
            "size_bytes": out_path.stat().st_size, "video": res.get("video"),
            "audio": res["audio_streams"][0] if res["audio_streams"] else None}
