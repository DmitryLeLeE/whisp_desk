import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtTime, parseTime } from "../api";
import { useTranslation } from "../i18n";
import type { Cue, PlanPayload, Project, Scenes, Segment, Thumbs, Waveform } from "../types";
import Icon from "./Icon";
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
  const [showScenes, setShowScenes] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const rangeEnd = useRef<number | null>(null);
  const segsRef = useRef(segs);
  segsRef.current = segs;
  const skipRef = useRef(skipCuts);
  skipRef.current = skipCuts;

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
    if (!el || !playing) return;
    const x = (current / 1000) * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - 80);
    }
  }, [current, playing, pps]);

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

  const selected = segs.find((s) => s.id === selectedId) ?? null;
  const here = segAt(current);
  const frameMs = 1000 / fps;
  const snapMs = (ms: number) => Math.round(Math.round(ms / frameMs) * frameMs);

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
      switch (e.key.toLowerCase()) {
        case " ": e.preventDefault(); togglePlay(); break;
        case "arrowleft": seek(current - (e.shiftKey ? 5000 : frameMs)); break;
        case "arrowright": seek(current + (e.shiftKey ? 5000 : frameMs)); break;
        case "i": setMarkIn(snapMs(current)); break;
        case "o": setMarkOut(snapMs(current)); break;
        case "k": if (sel) run({ op: "set_action", id: sel.id, action: "KEEP" }); break;
        case "c": if (sel) run({ op: "set_action", id: sel.id, action: "CUT" }); break;
        case "s": if (here) run({ op: "split", id: here.id, at_ms: snapMs(current) }); break;
        case "l": if (sel) run({ op: "lock", id: sel.id, locked: !sel.locked }); break;
        case "n": reviewNext(false); break;
        case "enter": reviewNext(true); break;
        case "r": if (sel) run({ op: "review", ids: [sel.id], reviewed: !sel.reviewed }); break;
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
    <div className="editor">
      <div className="player-row">
        <div className="player">
          {project.has_proxy ? (
            <video
              ref={videoRef}
              src={`/api/projects/${pid}/media/proxy`}
              preload="auto"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={togglePlay}
            />
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

        <div className="side">
          <div className="stats">
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

          <div className="reviewbar" title={`Проверено ${stats.segments - stats.unreviewed} из ${stats.segments}`}>
            <i style={{ width: `${stats.segments ? ((stats.segments - stats.unreviewed) / stats.segments) * 100 : 0}%` }} />
          </div>

          {msg && <p className="ok">{msg}</p>}

          <div className="row wrap">
            <button className="primary" onClick={() => reviewNext(true)} disabled={busy || stats.unreviewed === 0} title="Enter">
              <Icon name="check" /> {t("editor.accept_next")}
            </button>
            <button onClick={() => reviewNext(false)} disabled={stats.unreviewed === 0} title="N">
              {t("editor.next_unreviewed")}
            </button>
            {stats.unreviewed > 0 && (
              <button className="ghost small" onClick={acceptAll} disabled={busy} title="Принять все предложения авто-монтажа">
                <Icon name="check" /> {lang === "ru" ? `Принять всё (${stats.unreviewed})` : `Accept All (${stats.unreviewed})`}
              </button>
            )}
            <button onClick={() => history("undo")} disabled={!payload.can_undo || busy} title="Ctrl+Z">
              {t("editor.undo")}
            </button>
            <button onClick={() => history("redo")} disabled={!payload.can_redo || busy} title="Ctrl+Shift+Z">
              {t("editor.redo")}
            </button>
          </div>

          <form className="row" onSubmit={(e) => { e.preventDefault(); const ms = parseTime(jump); if (ms != null) seek(ms); }}>
            <input value={jump} onChange={(e) => setJump(e.target.value)} placeholder="01:23.500" style={{ maxWidth: 160 }} />
            <button>{lang === "ru" ? "Перейти" : "Jump"}</button>
          </form>

          {/* Скорость и звук */}
          <div className="row wrap">
            <div className="tabs">
              {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                <button key={r} className={`tab-btn ${rate === r ? "active" : ""}`} onClick={() => setRate(r)}>
                  {r}×
                </button>
              ))}
            </div>
            <div className="row" style={{ marginLeft: "auto" }}>
              <button className="ghost" onClick={() => setIsMuted(!isMuted)} title={isMuted ? "Включить звук" : "Выключить звук"}>
                <Icon name={isMuted ? "volume-x" : "volume"} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => { setVolume(Number(e.target.value)); setIsMuted(false); }}
                style={{ width: 80 }}
              />
            </div>
          </div>

          <label className="check">
            <input type="checkbox" checked={skipCuts} onChange={(e) => setSkipCuts(e.target.checked)} />
            {lang === "ru" ? "Предпросмотр результата (пропускать вырезаемое)" : "Preview final result (skip cuts)"}
          </label>
        </div>
      </div>

      {/* Панель инструментов таймлайна */}
      <div className="toolbar" style={{ marginTop: 12 }}>
        <button onClick={togglePlay} className="primary">
          <Icon name={playing ? "pause" : "play"} /> {playing ? (lang === "ru" ? "Пауза" : "Pause") : (lang === "ru" ? "Пуск" : "Play")}
        </button>
        <span className="tc">{fmtTime(current)}</span>

        <button onClick={() => setMarkIn(snapMs(current))}>[ In</button>
        <button onClick={() => setMarkOut(snapMs(current))}>Out ]</button>
        <span className="muted small">
          {markIn != null ? fmtTime(markIn) : "—"} → {markOut != null ? fmtTime(markOut) : "—"}
        </span>

        {rangeOk && (
          <>
            <button onClick={() => playRange(markIn!, markOut!)}>▶ {lang === "ru" ? "Интервал" : "Range"}</button>
            <button disabled={busy} onClick={() => run({ op: "set_range", start_ms: markIn, end_ms: markOut, action: "CUT" })}>
              {t("editor.cut")}
            </button>
            <button disabled={busy} onClick={() => run({ op: "set_range", start_ms: markIn, end_ms: markOut, action: "KEEP" })}>
              {t("editor.keep")}
            </button>
          </>
        )}

        <button disabled={!here || busy} onClick={() => here && run({ op: "split", id: here.id, at_ms: snapMs(current) })}>
          <Icon name="scissors" /> {t("editor.split")}
        </button>

        <span className="grow" />

        {/* Масштабирование */}
        <div className="row">
          <button className="ghost" onClick={() => setPps((p) => Math.max(0.5, p * 0.75))} title={t("editor.zoom_out")}>
            <Icon name="zoom-out" />
          </button>
          <input type="range" min={0.5} max={300} step={0.5} value={pps} onChange={(e) => setPps(Number(e.target.value))} style={{ width: 100 }} />
          <button className="ghost" onClick={() => setPps((p) => Math.min(300, p * 1.33))} title={t("editor.zoom_in")}>
            <Icon name="zoom-in" />
          </button>
          <button onClick={fit}>{t("editor.zoom_fit")}</button>
          <button className="ghost" onClick={() => setShowHelp(true)} title={t("common.help")}>
            <Icon name="help" />
          </button>
        </div>
      </div>

      {/* Таймлайн */}
      <div data-tour="timeline-area">
        <Timeline
          durationMs={plan.duration_ms}
          fps={fps}
          segments={segs}
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

      <div className="legend">
        <span className="sw keep" /> {lang === "ru" ? "оставить" : "keep"}
        <span className="sw cut" /> {lang === "ru" ? "удалить" : "cut"}
        <span className="sw manual" /> {lang === "ru" ? "изменено вручную" : "manual"}
        <span className="sw unrev" /> {lang === "ru" ? "не проверено" : "unreviewed"}
        <span className="sw scene" /> {lang === "ru" ? "смена сцены" : "scene change"}
        <span className="muted"> · {lang === "ru" ? "границы фрагментов можно перетаскивать мышью" : "drag fragment boundaries to adjust"}</span>
      </div>

      {/* Быстрая панель подсказок по управлению */}
      <div className="editor-hint-bar">
        <Icon name="lightbulb" style={{ color: "var(--accent)" }} />
        <span>
          {lang === "ru"
            ? "Клик по фрагменту переключает его статус (Оставить / Вырезать)."
            : "Click segment to toggle Keep / Cut."}
        </span>
        <div className="pills" style={{ marginLeft: "auto" }}>
          <span><kbd>Space</kbd> Play/Pause</span>
          <span><kbd>J / K / L</kbd> Seek</span>
          <span><kbd>S</kbd> Split</span>
          <span><kbd>K</kbd> / <kbd>C</kbd> Keep/Cut</span>
          <span><kbd>Ctrl+Z</kbd> Undo</span>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {thumbs && thumbs.files.length > 0 && (
        <div className="scenes">
          <button className="link" onClick={() => setShowScenes(!showScenes)}>
            {showScenes ? "▾" : "▸"} {lang === "ru" ? "Сцены" : "Scenes"} ({thumbs.files.length})
          </button>
          {showScenes && (
            <div className="strip">
              {thumbs.files.map((f, i) => (
                <figure key={f} onClick={() => seek(thumbs.times_ms[i])}>
                  <img src={`/api/projects/${pid}/thumbnails/${f}`} alt="" loading="lazy" />
                  <figcaption>{fmtTime(thumbs.times_ms[i], false)}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Список фрагментов */}
      <div className="row" style={{ marginTop: 14 }}>
        <h3 className="grow">{lang === "ru" ? "Список решений" : "Edit Decisions"} ({rows.length})</h3>
        <label className="check">
          <input type="checkbox" checked={onlyUnreviewed} onChange={(e) => setOnlyUnreviewed(e.target.checked)} />
          {lang === "ru" ? "только непроверенные" : "unreviewed only"}
        </label>
        <button disabled={busy || stats.unreviewed === 0} onClick={() => run({ op: "review", reviewed: true })}>
          {lang === "ru" ? "Отметить всё проверенным" : "Mark all as reviewed"}
        </button>
      </div>

      <div className="seglist">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{lang === "ru" ? "Начало" : "Start"}</th>
              <th>{lang === "ru" ? "Конец" : "End"}</th>
              <th>{lang === "ru" ? "Длит." : "Dur."}</th>
              <th>{lang === "ru" ? "Решение" : "Action"}</th>
              <th>{lang === "ru" ? "Причина" : "Reason"}</th>
              <th>{lang === "ru" ? "Статус" : "Status"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const idx = segs.indexOf(s);
              const next = segs[idx + 1];
              return (
                <tr
                  key={s.id}
                  className={`${s.action.toLowerCase()} ${selectedId === s.id ? "sel" : ""}`}
                  onClick={() => { setSelectedId(s.id); seek(s.source_start_ms); }}
                >
                  <td>{idx + 1}</td>
                  <td>{fmtTime(s.source_start_ms)}</td>
                  <td>{fmtTime(s.source_end_ms)}</td>
                  <td>{((s.source_end_ms - s.source_start_ms) / 1000).toFixed(2)} с</td>
                  <td>
                    <b>{s.action === "KEEP" ? (lang === "ru" ? "Оставить" : "Keep") : (lang === "ru" ? "Удалить" : "Cut")}</b>
                    {s.locked ? " 🔒" : ""}
                  </td>
                  <td>{REASONS[s.reason] ?? s.reason}</td>
                  <td>
                    {s.manual ? (lang === "ru" ? "вручную" : "manual")
                      : s.reviewed ? (lang === "ru" ? "проверено" : "reviewed")
                      : (lang === "ru" ? "не проверено" : "unreviewed")}
                  </td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <button title="Play" onClick={() => playRange(s.source_start_ms, s.source_end_ms)}>▶</button>
                    <button disabled={busy} onClick={() => run({ op: "set_action", id: s.id, action: s.action === "KEEP" ? "CUT" : "KEEP" })}>
                      {s.action === "KEEP" ? (lang === "ru" ? "Удалить" : "Cut") : (lang === "ru" ? "Вернуть" : "Keep")}
                    </button>
                    <button disabled={busy} title="Lock" onClick={() => run({ op: "lock", id: s.id, locked: !s.locked })}>
                      {s.locked ? "🔓" : "🔒"}
                    </button>
                    <button disabled={busy} title="Review" onClick={() => run({ op: "review", ids: [s.id], reviewed: !s.reviewed })}>
                      {s.reviewed ? "✓" : "○"}
                    </button>
                    {next && (
                      <button disabled={busy} title="Merge" onClick={() => run({ op: "merge", id: s.id, second_id: next.id, action: s.action })}>
                        ⇆
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && <p className="muted small" style={{ marginTop: 6 }}>{lang === "ru" ? "Выбран сегмент" : "Selected segment"}: {selected.id}</p>}
      {showHelp && <ShortcutsModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
