import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtTime, parseTime } from "../api";
import { useTranslation } from "../i18n";
import type { Cue, PlanPayload, Project, Scenes, Segment, Thumbs, Waveform } from "../types";
import Icon from "./Icon";
import AutoPatternModal from "./AutoPatternModal";
import InsightsModal from "./InsightsModal";
import ShortcutsModal from "./ShortcutsModal";
import Timeline from "./Timeline";

interface Props {
  pid: string; project: Project; payload: PlanPayload; onPayload: (p: PlanPayload) => void;
  scenes: Scenes | null; wave: Waveform | null; cues: Cue[]; busy: boolean; seekTo: { ms: number; n: number } | null;
}

const REASONS: Record<string, string> = {
  long_silence: "длинная пауза", low_volume: "низкая громкость", manual_cut: "вручную удалено", manual_keep: "вручную оставлено",
  scene_boundary: "смена сцены", opening_trim: "тишина в начале", ending_trim: "тишина в конце", speech: "речь", opening: "начало",
};

function AudioMeter({ videoRef, playing }: { videoRef: React.RefObject<HTMLVideoElement>; playing: boolean }) {
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const animRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const connectedRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const setupAudio = () => {
      if (connectedRef.current) return;
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const source = ctx.createMediaElementSource(video);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        connectedRef.current = true;
      } catch {
        // Cross-origin or already hooked
      }
    };

    video.addEventListener("play", setupAudio, { once: true });
    return () => {
      video.removeEventListener("play", setupAudio);
    };
  }, [videoRef]);

  useEffect(() => {
    if (!playing || !analyserRef.current) {
      setLevel(0);
      return;
    }

    if (audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume().catch(() => undefined);
    }

    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const update = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const db = 20 * Math.log10(rms + 1e-4);
      const clamped = Math.max(0, Math.min(1, (db + 42) / 42));

      setLevel(clamped);
      setPeak((prev) => Math.max(clamped, prev * 0.94));
      animRef.current = requestAnimationFrame(update);
    };

    animRef.current = requestAnimationFrame(update);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [playing]);

  const leds = [
    { thresh: 0.90, color: "#ef4444" },
    { thresh: 0.76, color: "#f59e0b" },
    { thresh: 0.62, color: "#eab308" },
    { thresh: 0.48, color: "#10b981" },
    { thresh: 0.34, color: "#10b981" },
    { thresh: 0.20, color: "#10b981" },
    { thresh: 0.08, color: "#059669" },
  ];

  return (
    <div
      title="Audio Peak VU Meter (-42 dB .. 0 dB)"
      style={{
        position: "absolute",
        right: 12,
        bottom: 14,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 2,
        width: 6,
        height: 64,
        background: "rgba(0, 0, 0, 0.65)",
        padding: "3px 2px",
        borderRadius: 3,
        border: "1px solid rgba(255, 255, 255, 0.12)",
        zIndex: 6,
        pointerEvents: "none",
        backdropFilter: "blur(4px)",
      }}
    >
      {leds.map((led, i) => {
        const on = level >= led.thresh;
        const isPeak = peak >= led.thresh && peak < led.thresh + 0.14;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              borderRadius: 1,
              background: on ? led.color : isPeak ? `${led.color}88` : "rgba(255, 255, 255, 0.08)",
              boxShadow: on ? `0 0 3px ${led.color}` : "none",
              transition: "background 0.04s ease",
            }}
          />
        );
      })}
    </div>
  );
}

export default function Editor({ pid, project, payload, onPayload, scenes, wave, cues, busy, seekTo }: Props) {
  const { t, lang } = useTranslation();
  const { plan, stats } = payload;
  const segs = plan.segments;
  const fps = plan.fps.numerator / plan.fps.denominator;
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [skipCuts, setSkipCuts] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pps, setPps] = useState(8);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  const [jump, setJump] = useState("");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [error, setError] = useState("");
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [msg, setMsg] = useState("");
  const [thumbs, setThumbs] = useState<Thumbs | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showPatterns, setShowPatterns] = useState(false);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [exportingRange, setExportingRange] = useState(false);
  const [isFullscreenMonitor, setIsFullscreenMonitor] = useState(false);
  const [audioScrub, setAudioScrub] = useState(() => {
    try { return localStorage.getItem("whisp_audio_scrub") !== "false"; } catch { return true; }
  });
  const [editingTc, setEditingTc] = useState(false);
  const [tcInput, setTcInput] = useState("");
  const [inspectorTab, setInspectorTab] = useState<"decisions" | "params" | "scenes">("decisions");

  const rangeEnd = useRef<number | null>(null);
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const skipRef = useRef(skipCuts);
  skipRef.current = skipCuts;
  const followRef = useRef(followPlayhead);
  followRef.current = followPlayhead;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const playScrubBurst = useCallback((targetMs: number) => {
    const v = videoRef.current;
    if (!v || playingRef.current || !audioScrub || isMuted) return;
    v.currentTime = targetMs / 1000;
    v.muted = false;
    v.play().catch(() => undefined);
    setTimeout(() => {
      if (!playingRef.current) {
        v.pause();
      }
    }, 70);
  }, [audioScrub, isMuted]);

  const segAt = useCallback((ms: number): Segment | undefined => {
    const s = segsRef.current;
    let lo = 0, hi = s.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ms < s[mid].source_start_ms) hi = mid - 1;
      else if (ms >= s[mid].source_end_ms) lo = mid + 1;
      else return s[mid];
    }
    return undefined;
  }, []);

  const seek = useCallback((ms: number) => {
    const v = videoRef.current;
    const tMs = Math.max(0, Math.min(plan.duration_ms, ms));
    if (v) v.currentTime = tMs / 1000;
    setCurrent(tMs);
  }, [plan.duration_ms]);

  useEffect(() => {
    if (seekTo) {
      seek(seekTo.ms);
      const el = scrollRef.current;
      if (el) el.scrollLeft = Math.max(0, (seekTo.ms / 1000) * pps - 120);
    }
  }, [seekTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Цикл воспроизведения: пропуск вырезанных участков = предпросмотр результата без рендера.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const ms = v.currentTime * 1000;
      if (!v.paused) {
        if (rangeEnd.current != null && ms >= rangeEnd.current) {
          v.pause();
          rangeEnd.current = null;
        } else if (skipRef.current && rangeEnd.current == null) {
          const s = segAt(ms);
          if (s && s.action === "CUT") {
            if (s.source_end_ms >= plan.duration_ms - 20) v.pause();
            else v.currentTime = s.source_end_ms / 1000;
          }
        }
      }
      setCurrent(v.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [segAt, plan.duration_ms]);

  // Прокрутка шкалы за playhead во время воспроизведения.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing || !followPlayhead) return;
    const x = (current / 1000) * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 60) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
    }
  }, [current, playing, pps, followPlayhead]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      videoRef.current.volume = isMuted ? 0 : volume;
    }
  }, [rate, volume, isMuted, project.has_proxy]);

  useEffect(() => {
    api.get<Thumbs>(`/api/projects/${pid}/analysis/thumbnails`).then(setThumbs).catch(() => setThumbs(null));
  }, [pid]);

  // Ctrl + колесо — масштаб вокруг курсора.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursor = e.clientX - rect.left;
      setPps((old) => {
        const next = Math.max(0.5, Math.min(300, old * (e.deltaY < 0 ? 1.25 : 0.8)));
        const tPos = (el.scrollLeft + cursor) / old;
        requestAnimationFrame(() => { el.scrollLeft = tPos * next - cursor; });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    rangeEnd.current = null;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const playRange = (a: number, b: number) => {
    const v = videoRef.current;
    if (!v) return;
    rangeEnd.current = b;
    v.currentTime = a / 1000;
    v.play().catch(() => undefined);
  };

  const run = useCallback(async (body: Record<string, unknown>) => {
    setError("");
    try { onPayload(await api.post<PlanPayload>(`/api/projects/${pid}/timeline/ops`, body)); }
    catch (e) { setError((e as Error).message); }
  }, [pid, onPayload]);

  const history = async (what: "undo" | "redo") => {
    setError("");
    try { onPayload(await api.post<PlanPayload>(`/api/projects/${pid}/timeline/${what}`)); }
    catch (e) { setError((e as Error).message); }
  };

  // Быстрая проверка: следующее непроверенное решение.
  const reviewNext = useCallback(async (acceptCurrent: boolean) => {
    const list = segsRef.current;
    const cur = list.find((s) => s.id === selectedId);
    let updated = list;
    if (acceptCurrent && cur && !cur.reviewed) {
      setError("");
      try {
        const r = await api.post<PlanPayload>(`/api/projects/${pid}/timeline/ops`, { op: "review", ids: [cur.id], reviewed: true });
        onPayload(r);
        updated = r.plan.segments;
      } catch (e) { setError((e as Error).message); return; }
    }
    const from = Math.max(0, updated.findIndex((s) => s.id === selectedId));
    const order = [...updated.slice(from + 1), ...updated.slice(0, from + 1)];
    const next = order.find((s) => !s.reviewed);
    if (!next) { setMsg(lang === "ru" ? "Все решения проверены" : "All decisions reviewed"); return; }
    setMsg("");
    setSelectedId(next.id);
    const pre = 1500;
    playRange(Math.max(0, next.source_start_ms - pre), Math.min(plan.duration_ms, next.source_end_ms + pre));
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, (next.source_start_ms / 1000) * pps - el.clientWidth / 3);
  }, [selectedId, pid, onPayload, plan.duration_ms, pps, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const acceptAll = async () => {
    if (stats.unreviewed === 0) return;
    if (!confirm(lang === "ru" ? `Отметить все ${stats.unreviewed} непроверенных фрагментов как проверенные?` : `Mark all ${stats.unreviewed} unreviewed segments as reviewed?`)) return;
    setError("");
    try {
      onPayload(await api.post<PlanPayload>(`/api/projects/${pid}/timeline/ops`, { op: "review", ids: null, reviewed: true }));
      setMsg(lang === "ru" ? "Все фрагменты отмечены проверенными!" : "All cuts marked as reviewed!");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const here = segAt(current);
  const frameMs = 1000 / fps;
  const snapMs = (ms: number) => Math.round(Math.round(ms / frameMs) * frameMs);

  const captureFrame = () => {
    window.open(`/api/projects/${pid}/frame?time_ms=${snapMs(current)}&download=true`, "_blank");
  };

  const razorCut = useCallback(async () => {
    const at = snapMs(current);
    const target = segsRef.current.find((s) => s.source_start_ms < at && s.source_end_ms > at);
    if (!target) {
      setMsg(lang === "ru" ? "Курсор на границе фрагмента" : "Playhead is already at boundary");
      setTimeout(() => setMsg(""), 2000);
      return;
    }
    await run({ op: "split", id: target.id, at_ms: at });
    setMsg(lang === "ru" ? `Фрагмент разрезан в точке ${fmtTime(at, true)}` : `Split at ${fmtTime(at, true)}`);
    setTimeout(() => setMsg(""), 2500);
  }, [current, snapMs, run, lang]);

  const moveSequence = (segId: string, direction: "up" | "down") => {
    const keepSegments = segs.filter((s) => s.action === "KEEP");
    const currentSeq = plan.sequence && plan.sequence.length > 0
      ? plan.sequence.filter((id: string) => keepSegments.some((s) => s.id === id))
      : keepSegments.map((s) => s.id);

    const idx = currentSeq.indexOf(segId);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= currentSeq.length) return;

    const updatedSeq = [...currentSeq];
    const [moved] = updatedSeq.splice(idx, 1);
    updatedSeq.splice(targetIdx, 0, moved);

    run({ op: "reorder", sequence: updatedSeq });
  };

  const addMarkerAtCurrent = async () => {
    const at = snapMs(current);
    const existing = plan.markers?.find((m) => Math.abs(m.time_ms - at) < 150);
    if (existing) {
      const newLabel = prompt(
        lang === "ru" ? "Название маркера (оставьте пустым для удаления):" : "Marker label (leave empty to delete):",
        existing.label
      );
      if (newLabel === null) return;
      if (newLabel.trim() === "") {
        await run({ op: "delete_marker", marker_id: existing.id });
      } else {
        await run({ op: "delete_marker", marker_id: existing.id });
        await run({ op: "add_marker", time_ms: existing.time_ms, label: newLabel.trim(), color: existing.color });
      }
    } else {
      await run({ op: "add_marker", time_ms: at, label: "Маркер", color: "cyan" });
    }
  };

  const exportRange = async () => {
    if (markIn == null || markOut == null || markOut <= markIn) return;
    setExportingRange(true);
    setMsg(lang === "ru" ? "Рендеринг выделенного отрезка..." : "Rendering selected range...");
    try {
      const res = await api.post<{ task_id: string }>(`/api/projects/${pid}/render`, {
        preset: "youtube_1080p",
        codec: "libx264",
        crf: 18,
        range_start_ms: markIn,
        range_end_ms: markOut,
      });
      setMsg(
        lang === "ru"
          ? `Экспорт фрагмента запущен (${res.task_id.slice(0, 8)}). Проверьте панель Экспорт.`
          : `Range export started (${res.task_id.slice(0, 8)}). Check Export tab.`
      );
      setTimeout(() => setMsg(""), 6000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExportingRange(false);
    }
  };

  // Горячие клавиши.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        history(e.shiftKey ? "redo" : "undo");
        return;
      }
      const sel = segs.find((s) => s.id === selectedId);
      const preset = localStorage.getItem("whisp_kbd_preset") || "whisp";

      switch (e.key.toLowerCase()) {
        case " ": e.preventDefault(); togglePlay(); break;
        case "j": seek(current - (e.shiftKey ? 5000 : 2000)); break;
        case "l":
          if (preset === "premiere" || preset === "davinci") {
            seek(current + (e.shiftKey ? 5000 : 2000));
          } else {
            if (sel) run({ op: "lock", id: sel.id, locked: !sel.locked });
            else seek(current + (e.shiftKey ? 5000 : 2000));
          }
          break;
        case "k":
          if (preset === "premiere" || preset === "davinci") {
            togglePlay();
          } else {
            if (sel) run({ op: "set_action", id: sel.id, action: "KEEP" });
          }
          break;
        case "q":
          if (here && current > here.source_start_ms + 100) {
            run({ op: "set_range", start_ms: here.source_start_ms, end_ms: snapMs(current), action: "CUT" });
          }
          break;
        case "w":
          if (here && current < here.source_end_ms - 100) {
            run({ op: "set_range", start_ms: snapMs(current), end_ms: here.source_end_ms, action: "CUT" });
          }
          break;
        case "b":
          e.preventDefault();
          razorCut();
          break;
        case "arrowleft": {
          const tNext = Math.max(0, current - (e.shiftKey ? 5000 : frameMs));
          seek(tNext);
          if (!playing && audioScrub) playScrubBurst(tNext);
          break;
        }
        case "arrowright": {
          const tNext = Math.min(plan.duration_ms, current + (e.shiftKey ? 5000 : frameMs));
          seek(tNext);
          if (!playing && audioScrub) playScrubBurst(tNext);
          break;
        }
        case "`":
        case "~":
        case "f11":
          e.preventDefault();
          setIsFullscreenMonitor((prev) => !prev);
          break;
        case "i": setMarkIn(snapMs(current)); break;
        case "o": setMarkOut(snapMs(current)); break;
        case "c":
          if (preset === "premiere") {
            if (here) run({ op: "split", id: here.id, at_ms: snapMs(current) });
          } else {
            if (sel) run({ op: "set_action", id: sel.id, action: "CUT" });
          }
          break;
        case "s": if (here) run({ op: "split", id: here.id, at_ms: snapMs(current) }); break;
        case "n": reviewNext(false); break;
        case "enter": reviewNext(true); break;
        case "r": if (sel) run({ op: "review", ids: [sel.id], reviewed: !sel.reviewed }); break;
        case "m": e.preventDefault(); addMarkerAtCurrent(); break;
        case "?": setShowHelp(true); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = () => {
    const w = scrollRef.current?.clientWidth ?? 800;
    setPps(Math.max(0.5, (w - 4) / (plan.duration_ms / 1000)));
  };
  useEffect(() => { fit(); }, [plan.duration_ms]); // eslint-disable-line react-hooks/exhaustive-deps

  const cue = useMemo(() => cues.find((c) => current >= c.start_ms && current < c.end_ms), [cues, current]);
  const rows = onlyUnreviewed ? segs.filter((s) => !s.reviewed) : segs;
  const rangeOk = markIn != null && markOut != null && markOut > markIn;
  const cutPercent = Math.round((stats.removed_ms / (stats.source_ms || 1)) * 100);

  return (
    <div className="nle-editor-layout">
      {/* Верхняя часть: Видеомонитор + Инспектор решений */}
      <div className="nle-upper-deck">
        {/* Программный видеомонитор */}
        <div className={`nle-monitor-panel ${isFullscreenMonitor ? "fullscreen-monitor" : ""}`}>
          <div className="studio-panel-bar">
            <span className="studio-panel-title">
              <span className="rec-indicator" /> {lang === "ru" ? "ПРОГРАММНЫЙ МОНИТОР" : "PROGRAM MONITOR"}
            </span>
            <div className="row" style={{ gap: 6, marginLeft: "auto", alignItems: "center" }}>
              <span className="badge small" style={{ background: "rgba(255,255,255,0.06)", fontSize: 10, padding: "2px 6px" }}>
                {project.metadata?.video ? `${project.metadata.video.width}×${project.metadata.video.height}` : "1080p"}
              </span>
              <button
                className="nle-btn-ghost small"
                onClick={captureFrame}
                title={lang === "ru" ? "Сохранить HD стоп-кадр" : "Capture HD Frame"}
              >
                <Icon name="image" /> HD
              </button>
              <button
                className="nle-btn-ghost small"
                onClick={() => setIsFullscreenMonitor(!isFullscreenMonitor)}
                title={lang === "ru" ? "Во весь экран (~ / F11)" : "Fullscreen toggle (~ / F11)"}
              >
                <Icon name={isFullscreenMonitor ? "minimize" : "maximize"} /> {isFullscreenMonitor ? (lang === "ru" ? "Выход" : "Exit") : (lang === "ru" ? "Экран" : "Full")}
              </button>
            </div>
          </div>

          <div className="player">
            {project.has_proxy ? (
              <>
                <video
                  ref={videoRef}
                  src={`/api/projects/${pid}/media/proxy`}
                  preload="auto"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onClick={togglePlay}
                />
                <AudioMeter videoRef={videoRef} playing={playing} />
              </>
            ) : (
              <p className="muted pad" style={{ padding: 40, textAlign: "center" }}>
                {lang === "ru" ? "Копия для предпросмотра создаётся во время анализа." : "Proxy video is created during analysis."}
              </p>
            )}
            {cue && <div className="subtitle">{cue.text}</div>}
            {here?.action === "CUT" && (
              <div className="cutflag">{lang === "ru" ? "вырезается" : "cut"}</div>
            )}
          </div>

          {/* Интегрированная транспортная панель монитора */}
          <div className="nle-transport-bar">
            <div className="nle-transport-controls">
              <button
                className="nle-btn-ctrl"
                onClick={() => {
                  const tNext = Math.max(0, current - frameMs);
                  seek(tNext);
                  if (!playing && audioScrub) playScrubBurst(tNext);
                }}
                title={lang === "ru" ? "Кадр назад (←)" : "Step 1 frame backward (←)"}
              >
                ◀
              </button>
              <button
                className={`nle-btn-play ${playing ? "active" : ""}`}
                onClick={togglePlay}
                title={playing ? (lang === "ru" ? "Пауза (Space)" : "Pause (Space)") : (lang === "ru" ? "Воспроизведение (Space)" : "Play (Space)")}
              >
                <Icon name={playing ? "pause" : "play"} />
              </button>
              <button
                className="nle-btn-ctrl"
                onClick={() => {
                  const tNext = Math.min(plan.duration_ms, current + frameMs);
                  seek(tNext);
                  if (!playing && audioScrub) playScrubBurst(tNext);
                }}
                title={lang === "ru" ? "Кадр вперёд (→)" : "Step 1 frame forward (→)"}
              >
                ▶
              </button>
            </div>

            {/* Дисплей таймкода с мгновенным переходом */}
            <div className="nle-tc-display-wrap">
              {editingTc ? (
                <input
                  autoFocus
                  value={tcInput}
                  onChange={(e) => setTcInput(e.target.value)}
                  onBlur={() => {
                    const ms = parseTime(tcInput);
                    if (ms != null) seek(ms);
                    setEditingTc(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const ms = parseTime(tcInput);
                      if (ms != null) seek(ms);
                      setEditingTc(false);
                    }
                    if (e.key === "Escape") setEditingTc(false);
                  }}
                  className="tc nle-tc-input"
                />
              ) : (
                <span
                  className="tc nle-tc-readout"
                  onClick={() => { setTcInput(fmtTime(current)); setEditingTc(true); }}
                  title={lang === "ru" ? "Кликните для ввода точного таймкода" : "Click to edit timecode"}
                >
                  {fmtTime(current)}
                </span>
              )}
            </div>

            {/* Скорость воспроизведения */}
            <div className="nle-speed-chips">
              {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                <button
                  key={r}
                  className={`nle-speed-chip ${rate === r ? "active" : ""}`}
                  onClick={() => setRate(r)}
                >
                  {r}×
                </button>
              ))}
            </div>

            {/* Громкость */}
            <div className="nle-volume-wrap">
              <button
                className="nle-btn-ghost small"
                onClick={() => setIsMuted(!isMuted)}
                title={isMuted ? "Включить звук" : "Выключить звук"}
              >
                <Icon name={isMuted ? "volume-x" : "volume"} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => { setVolume(Number(e.target.value)); setIsMuted(false); }}
                className="nle-vol-slider"
              />
            </div>

            {/* Быстрые переключатели предпросмотра */}
            <label className="nle-check-chip" title="Пропускать тишину и вырезанные участки">
              <input type="checkbox" checked={skipCuts} onChange={(e) => setSkipCuts(e.target.checked)} />
              <span>{lang === "ru" ? "Без пауз" : "Skip cuts"}</span>
            </label>
            <label className="nle-check-chip" title="Звук при покадровом шаге">
              <input
                type="checkbox"
                checked={audioScrub}
                onChange={(e) => {
                  setAudioScrub(e.target.checked);
                  try { localStorage.setItem("whisp_audio_scrub", e.target.checked.toString()); } catch {}
                }}
              />
              <span>{lang === "ru" ? "Скраббинг" : "Scrub"}</span>
            </label>
          </div>
        </div>

        {/* Правая панель: Инспектор решений монтажа */}
        <div className="nle-inspector-panel">
          {/* Вкладки инспектора */}
          <div className="nle-inspector-tabs">
            <button
              className={`nle-insp-tab ${inspectorTab === "decisions" ? "active" : ""}`}
              onClick={() => setInspectorTab("decisions")}
            >
              <Icon name="scissors" /> <span>{lang === "ru" ? "Решения" : "Cuts"} ({rows.length})</span>
            </button>
            <button
              className={`nle-insp-tab ${inspectorTab === "params" ? "active" : ""}`}
              onClick={() => setInspectorTab("params")}
            >
              <Icon name="sliders" /> <span>{lang === "ru" ? "Параметры" : "Inspector"}</span>
            </button>
            <button
              className={`nle-insp-tab ${inspectorTab === "scenes" ? "active" : ""}`}
              onClick={() => setInspectorTab("scenes")}
            >
              <Icon name="film" /> <span>{lang === "ru" ? "Сцены" : "Scenes"} ({thumbs?.files.length ?? 0})</span>
            </button>
          </div>

          {/* Вкладка 1: Таблица решений монтажа */}
          {inspectorTab === "decisions" && (
            <div className="nle-tab-content decisions-content">
              {/* Верхняя микро-панель управления списком */}
              <div className="nle-decisions-toolbar">
                <label className="check" style={{ fontSize: 12, margin: 0 }}>
                  <input type="checkbox" checked={onlyUnreviewed} onChange={(e) => setOnlyUnreviewed(e.target.checked)} />
                  <span>{lang === "ru" ? "только непроверенные" : "unreviewed only"}</span>
                </label>
                <div className="row" style={{ gap: 4, marginLeft: "auto", alignItems: "center" }}>
                  <button className="primary small" onClick={() => reviewNext(true)} disabled={busy || stats.unreviewed === 0} title="Enter">
                    <Icon name="check" /> {t("editor.accept_next")}
                  </button>
                  {stats.unreviewed > 0 && (
                    <button className="nle-btn-ghost small" onClick={acceptAll} disabled={busy} title="Принять всё">
                      {lang === "ru" ? `Принять всё (${stats.unreviewed})` : `Accept All (${stats.unreviewed})`}
                    </button>
                  )}
                  <button className="nle-btn-ghost small" onClick={() => history("undo")} disabled={!payload.can_undo || busy} title="Ctrl+Z">
                    <Icon name="arrow-left" />
                  </button>
                  <button className="nle-btn-ghost small" onClick={() => history("redo")} disabled={!payload.can_redo || busy} title="Ctrl+Shift+Z">
                    <Icon name="arrow" />
                  </button>
                </div>
              </div>

              {msg && <div className="notice ok small" style={{ margin: "4px 8px" }}>{msg}</div>}
              {error && <div className="notice bad small" style={{ margin: "4px 8px" }}>{error}</div>}

              {/* Таблица сегментов */}
              <div className="nle-seglist-wrap">
                <table className="nle-table">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>#</th>
                      <th>{lang === "ru" ? "Начало" : "Start"}</th>
                      <th>{lang === "ru" ? "Длит." : "Dur."}</th>
                      <th>{lang === "ru" ? "Действие" : "Action"}</th>
                      <th>{lang === "ru" ? "Причина" : "Reason"}</th>
                      <th style={{ textAlign: "right" }}>{lang === "ru" ? "Опции" : "Controls"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const idx = segs.indexOf(s);
                      const next = segs[idx + 1];
                      const isSel = selectedId === s.id;
                      return (
                        <tr
                          key={s.id}
                          className={`${s.action.toLowerCase()} ${isSel ? "sel" : ""}`}
                          onClick={() => { setSelectedId(s.id); seek(s.source_start_ms); }}
                        >
                          <td className="idx">{idx + 1}</td>
                          <td className="tc-cell">{fmtTime(s.source_start_ms)}</td>
                          <td className="dur-cell">{((s.source_end_ms - s.source_start_ms) / 1000).toFixed(2)}s</td>
                          <td>
                            <span className={`badge ${s.action === "KEEP" ? "ok" : "bad"}`} style={{ fontSize: 10 }}>
                              {s.action === "KEEP" ? (lang === "ru" ? "Оставить" : "Keep") : (lang === "ru" ? "Вырезать" : "Cut")}
                            </span>
                            {s.locked && <span className="badge small" style={{ marginLeft: 3 }}>LOCK</span>}
                          </td>
                          <td className="reason-cell">{REASONS[s.reason] ?? s.reason}</td>
                          <td className="actions" onClick={(e) => e.stopPropagation()}>
                            <button className="nle-btn-micro" title="Play" onClick={() => playRange(s.source_start_ms, s.source_end_ms)}>▶</button>
                            <button
                              className="nle-btn-micro"
                              disabled={busy}
                              title={s.action === "KEEP" ? (lang === "ru" ? "Вырезать" : "Cut") : (lang === "ru" ? "Оставить" : "Keep")}
                              onClick={() => run({ op: "set_action", id: s.id, action: s.action === "KEEP" ? "CUT" : "KEEP" })}
                            >
                              {s.action === "KEEP" ? "✂" : "✓"}
                            </button>
                            <button
                              className="nle-btn-micro"
                              disabled={busy}
                              title={s.locked ? "Unlock" : "Lock"}
                              onClick={() => run({ op: "lock", id: s.id, locked: !s.locked })}
                            >
                              <Icon name={s.locked ? "unlock" : "lock"} style={{ width: 10, height: 10 }} />
                            </button>
                            <button
                              className="nle-btn-micro"
                              disabled={busy}
                              title="Reviewed toggle"
                              onClick={() => run({ op: "review", ids: [s.id], reviewed: !s.reviewed })}
                            >
                              {s.reviewed ? "✓" : "—"}
                            </button>
                            {next && (
                              <button
                                className="nle-btn-micro"
                                disabled={busy}
                                title="Merge with next"
                                onClick={() => run({ op: "merge", id: s.id, second_id: next.id, action: s.action })}
                              >
                                ⇆
                              </button>
                            )}
                            {s.action === "KEEP" && (
                              <>
                                <button className="nle-btn-micro" disabled={busy} title="Move up" onClick={() => moveSequence(s.id, "up")}>▲</button>
                                <button className="nle-btn-micro" disabled={busy} title="Move down" onClick={() => moveSequence(s.id, "down")}>▼</button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Вкладка 2: Параметры, статистика и шаблоны */}
          {inspectorTab === "params" && (
            <div className="nle-tab-content params-content">
              <div className="stats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                <div>
                  <span>{t("editor.stats.source")}</span>
                  <b>{fmtTime(stats.source_ms, false)}</b>
                </div>
                <div>
                  <span>{t("editor.stats.output")}</span>
                  <b>{fmtTime(stats.output_ms, false)}</b>
                </div>
                <div>
                  <span>{t("editor.stats.saved")}</span>
                  <b style={{ color: "var(--keep)" }}>-{cutPercent}%</b>
                </div>
                <div>
                  <span>{t("editor.stats.unreviewed")}</span>
                  <b style={{ color: stats.unreviewed > 0 ? "var(--warn)" : "var(--ok)" }}>{stats.unreviewed}</b>
                </div>
              </div>

              <div className="reviewbar" title={`Проверено ${stats.segments - stats.unreviewed} из ${stats.segments}`} style={{ margin: "10px 0" }}>
                <i style={{ width: `${stats.segments ? ((stats.segments - stats.unreviewed) / stats.segments) * 100 : 0}%` }} />
              </div>

              <div className="col" style={{ gap: 8, marginTop: 12 }}>
                <button className="primary" onClick={() => setShowPatterns(true)} style={{ width: "100%", justifyContent: "center" }}>
                  <Icon name="zap" /> {lang === "ru" ? "Умные шаблоны сборки (Shorts, Подкаст)" : "Smart Assembly Presets"}
                </button>
                <button onClick={() => setShowInsights(true)} style={{ width: "100%", justifyContent: "center" }}>
                  <Icon name="sliders" /> {lang === "ru" ? "Аналитика пауз и речи" : "Speech & Pause Insights"}
                </button>
              </div>

              <div className="col" style={{ gap: 8, marginTop: 16 }}>
                <span className="muted small" style={{ fontWeight: 600 }}>{lang === "ru" ? "БЫСТРЫЙ ПЕРЕХОД ПО ТАЙМКОДУ" : "JUMP TO TIMECODE"}</span>
                <form className="row" onSubmit={(e) => { e.preventDefault(); const ms = parseTime(jump); if (ms != null) seek(ms); }}>
                  <input value={jump} onChange={(e) => setJump(e.target.value)} placeholder="01:23.500" style={{ flex: 1 }} />
                  <button>{lang === "ru" ? "Перейти" : "Jump"}</button>
                </form>
              </div>
            </div>
          )}

          {/* Вкладка 3: Сцены */}
          {inspectorTab === "scenes" && (
            <div className="nle-tab-content scenes-content">
              {thumbs && thumbs.files.length > 0 ? (
                <div className="nle-scene-grid">
                  {thumbs.files.map((f, i) => (
                    <figure key={f} className="nle-scene-card" onClick={() => seek(thumbs.times_ms[i])}>
                      <img src={`/api/projects/${pid}/thumbnails/${f}`} alt="" loading="lazy" />
                      <figcaption>{fmtTime(thumbs.times_ms[i], false)}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <div className="empty" style={{ padding: "40px 10px" }}>
                  <Icon name="film" style={{ opacity: 0.3, width: 32, height: 32 }} />
                  <span className="muted small">{lang === "ru" ? "Сцены не обнаружены или анализ ещё выполняется" : "No scene cuts found"}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Тулбар монтажного таймлайна */}
      <div className="nle-timeline-toolbar">
        <div className="row" style={{ gap: 4, alignItems: "center" }}>
          <button
            className="nle-tool-btn"
            disabled={!here || busy}
            onClick={razorCut}
            title={lang === "ru" ? "Лезвие: разрезать фрагмент по курсору (C)" : "Razor tool: split at playhead (C)"}
          >
            <Icon name="scissors" /> <span>{lang === "ru" ? "Лезвие (C)" : "Razor (C)"}</span>
          </button>
          <button
            className="nle-tool-btn"
            onClick={() => setMarkIn(snapMs(current))}
            title={lang === "ru" ? "Установить точку входа [In (I)" : "Mark In (I)"}
          >
            [ In
          </button>
          <button
            className="nle-tool-btn"
            onClick={() => setMarkOut(snapMs(current))}
            title={lang === "ru" ? "Установить точку выхода Out] (O)" : "Mark Out (O)"}
          >
            Out ]
          </button>
          <span className="nle-range-display">
            {markIn != null ? fmtTime(markIn) : "—"} → {markOut != null ? fmtTime(markOut) : "—"}
          </span>

          {rangeOk && (
            <>
              <button className="nle-tool-btn active" onClick={() => playRange(markIn!, markOut!)}>
                ▶ {lang === "ru" ? "Интервал" : "Range"}
              </button>
              <button className="nle-tool-btn danger" disabled={busy} onClick={() => run({ op: "set_range", start_ms: markIn, end_ms: markOut, action: "CUT" })}>
                {t("editor.cut")}
              </button>
              <button className="nle-tool-btn success" disabled={busy} onClick={() => run({ op: "set_range", start_ms: markIn, end_ms: markOut, action: "KEEP" })}>
                {t("editor.keep")}
              </button>
              <button
                className="nle-tool-btn"
                disabled={exportingRange || busy}
                onClick={exportRange}
                title={lang === "ru" ? "Быстрый рендер выделенного отрезка" : "Export range"}
              >
                <Icon name="download" /> {lang === "ru" ? "Экспорт отрезка" : "Export"}
              </button>
            </>
          )}

          <button
            className="nle-tool-btn"
            disabled={busy}
            onClick={addMarkerAtCurrent}
            title={lang === "ru" ? "Поставить маркер на таймлайне (M)" : "Add marker (M)"}
          >
            <Icon name="bookmark" /> <span>{lang === "ru" ? "Маркер" : "Marker"}</span>
          </button>
        </div>

        <div className="row" style={{ gap: 6, marginLeft: "auto", alignItems: "center" }}>
          <span className="nle-badge-fps">
            {fps.toFixed(0)} FPS
          </span>
          <button className="nle-btn-ghost small" onClick={() => setPps((p) => Math.max(0.5, p * 0.75))} title={t("editor.zoom_out")}>
            <Icon name="zoom-out" />
          </button>
          <input
            type="range"
            min={0.5}
            max={300}
            step={0.5}
            value={pps}
            onChange={(e) => setPps(Number(e.target.value))}
            className="nle-zoom-slider"
          />
          <button className="nle-btn-ghost small" onClick={() => setPps((p) => Math.min(300, p * 1.33))} title={t("editor.zoom_in")}>
            <Icon name="zoom-in" />
          </button>
          <button className="nle-btn-ghost small" onClick={fit} title={t("editor.zoom_fit")}>
            {t("editor.zoom_fit")}
          </button>
          <button
            className={`nle-btn-ghost small ${followPlayhead ? "active" : ""}`}
            onClick={() => setFollowPlayhead(!followPlayhead)}
            title={t("editor.autoscroll.title")}
          >
            <Icon name="compass" />
          </button>
          <button className="nle-btn-ghost small" onClick={() => setShowHelp(true)} title={t("common.help")}>
            <Icon name="help" />
          </button>
        </div>
      </div>

      {/* Полноэкранная дорожка таймлайна */}
      <div className="nle-timeline-deck" data-tour="timeline-area">
        <Timeline
          durationMs={plan.duration_ms}
          fps={fps}
          segments={segs}
          markers={plan.markers || []}
          cues={cues}
          sceneMs={scenes?.boundaries_ms ?? []}
          wave={wave}
          current={current}
          pps={pps}
          selectedId={selectedId}
          markIn={markIn}
          markOut={markOut}
          onSeek={seek}
          onSelect={(id) => setSelectedId(id)}
          scrollRef={scrollRef}
          onMoveBoundary={(id, ms) => run({ op: "move_boundary", id, at_ms: ms })}
          onRange={(a, b) => { setMarkIn(a); setMarkOut(b); }}
        />
      </div>

      {/* Нижняя информационная панель (статус и горячие клавиши) */}
      <footer className="nle-editor-footer">
        <div className="nle-legend-row">
          <span className="sw keep" /> {lang === "ru" ? "Оставить" : "Keep"}
          <span className="sw cut" /> {lang === "ru" ? "Удалить" : "Cut"}
          <span className="sw manual" /> {lang === "ru" ? "Вручную" : "Manual"}
          <span className="sw unrev" /> {lang === "ru" ? "Не проверено" : "Unreviewed"}
          <span className="sw scene" /> {lang === "ru" ? "Смена сцены" : "Scene change"}
        </div>
        <div className="nle-hotkey-cheatsheet">
          <span><kbd>Space</kbd> Play</span>
          <span><kbd>J / K / L</kbd> Shuttle</span>
          <span><kbd>C</kbd> Razor</span>
          <span><kbd>X</kbd> Toggle Cut</span>
          <span><kbd>Ctrl+Z</kbd> Undo</span>
        </div>
      </footer>

      {showHelp && <ShortcutsModal onClose={() => setShowHelp(false)} />}
      {showInsights && <InsightsModal pid={pid} onClose={() => setShowInsights(false)} />}
      {showPatterns && <AutoPatternModal pid={pid} onClose={() => setShowPatterns(false)} onPayload={onPayload} />}
    </div>
  );
}
