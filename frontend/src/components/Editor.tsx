import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtTime, parseTime } from "../api";
import type { Cue, PlanPayload, Project, Scenes, Segment, Thumbs, Waveform } from "../types";
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
  const [msg, setMsg] = useState("");
  const [thumbs, setThumbs] = useState<Thumbs | null>(null);
  const [showScenes, setShowScenes] = useState(false);
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
    const t = Math.max(0, Math.min(plan.duration_ms, ms));
    if (v) v.currentTime = t / 1000;
    setCurrent(t);
  }, [plan.duration_ms]);

  useEffect(() => { if (seekTo) { seek(seekTo.ms); const el = scrollRef.current; if (el) el.scrollLeft = Math.max(0, (seekTo.ms / 1000) * pps - 120); } }, [seekTo]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Цикл воспроизведения: пропуск вырезанных участков = предпросмотр результата без рендера.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const ms = v.currentTime * 1000;
      if (!v.paused) {
        if (rangeEnd.current != null && ms >= rangeEnd.current) { v.pause(); rangeEnd.current = null; }
        else if (skipRef.current && rangeEnd.current == null) {
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
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [current, playing, pps]);

  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate, project.has_proxy]);
  useEffect(() => { api.get<Thumbs>(`/api/projects/${pid}/analysis/thumbnails`).then(setThumbs).catch(() => setThumbs(null)); }, [pid]);

  // Ctrl + колесо — масштаб вокруг курсора; обычное колесо — обычная прокрутка.
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
        const t = (el.scrollLeft + cursor) / old;
        requestAnimationFrame(() => { el.scrollLeft = t * next - cursor; });
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
    if (v.paused) v.play().catch(() => undefined); else v.pause();
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

  // Быстрая проверка: следующее непроверенное решение, проигрывается с запасом до и после.
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
    if (!next) { setMsg("Все решения проверены"); return; }
    setMsg("");
    setSelectedId(next.id);
    const pre = 1500;
    playRange(Math.max(0, next.source_start_ms - pre), Math.min(plan.duration_ms, next.source_end_ms + pre));
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, (next.source_start_ms / 1000) * pps - el.clientWidth / 3);
  }, [selectedId, pid, onPayload, plan.duration_ms, pps]);  // eslint-disable-line react-hooks/exhaustive-deps

  const selected = segs.find((s) => s.id === selectedId) ?? null;
  const here = segAt(current);
  const frameMs = 1000 / fps;
  const snapMs = (ms: number) => Math.round(Math.round(ms / frameMs) * frameMs);

  // Горячие клавиши.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); history(e.shiftKey ? "redo" : "undo"); return; }
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
        case "n": reviewNext(false); break;
        case "enter": reviewNext(true); break;
        case "r": if (sel) run({ op: "review", ids: [sel.id], reviewed: !sel.reviewed }); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });  // eslint-disable-line react-hooks/exhaustive-deps

  const fit = () => {
    const w = scrollRef.current?.clientWidth ?? 800;
    setPps(Math.max(0.5, (w - 4) / (plan.duration_ms / 1000)));
  };
  useEffect(() => { fit(); }, [plan.duration_ms]);  // eslint-disable-line react-hooks/exhaustive-deps

  const cue = useMemo(() => cues.find((c) => current >= c.start_ms && current < c.end_ms), [cues, current]);
  const rows = onlyUnreviewed ? segs.filter((s) => !s.reviewed) : segs;
  const rangeOk = markIn != null && markOut != null && markOut > markIn;

  return (
    <div className="editor">
      <div className="player-row">
        <div className="player">
          {project.has_proxy ? (
            <video ref={videoRef} src={`/api/projects/${pid}/media/proxy`} preload="auto"
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={togglePlay} />
          ) : <p className="muted pad">Копия для предпросмотра ещё не создана — запустите анализ.</p>}
          {cue && <div className="subtitle">{cue.text}</div>}
          {here?.action === "CUT" && <div className="cutflag">вырезается</div>}
        </div>
        <div className="side">
          <div className="stats">
            <div><span>Исходник</span><b>{fmtTime(stats.source_ms, false)}</b></div>
            <div><span>Результат</span><b>{fmtTime(stats.output_ms, false)}</b></div>
            <div><span>Удалено</span><b>{fmtTime(stats.removed_ms, false)}</b></div>
            <div><span>Не проверено</span><b>{stats.unreviewed}</b></div>
          </div>
          <div className="reviewbar" title={`Проверено ${stats.segments - stats.unreviewed} из ${stats.segments}`}>
            <i style={{ width: `${stats.segments ? ((stats.segments - stats.unreviewed) / stats.segments) * 100 : 0}%` }} />
          </div>
          {msg && <p className="ok">{msg}</p>}
          <div className="row wrap">
            <button className="primary" onClick={() => reviewNext(true)} disabled={busy || stats.unreviewed === 0} title="Enter: принять текущее и показать следующее непроверенное">
              ✓ Принять и дальше</button>
            <button onClick={() => reviewNext(false)} disabled={stats.unreviewed === 0} title="N">Следующее непроверенное</button>
            <button onClick={() => history("undo")} disabled={!payload.can_undo || busy} title="Ctrl+Z">↶ Отменить</button>
            <button onClick={() => history("redo")} disabled={!payload.can_redo || busy} title="Ctrl+Shift+Z">↷ Повторить</button>
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); const ms = parseTime(jump); if (ms != null) seek(ms); }}>
            <input value={jump} onChange={(e) => setJump(e.target.value)} placeholder="Перейти: 1:23:45.500" />
            <button>Перейти</button>
          </form>
          <label>Скорость
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {[0.75, 1, 1.25, 1.5, 2, 3].map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={skipCuts} onChange={(e) => setSkipCuts(e.target.checked)} /> Предпросмотр результата (пропускать вырезаемое)</label>
          <div className="keys muted">Пробел — пуск · ←/→ кадр (Shift — 5 с) · I/O или протяжка мышью по шкале — интервал · K/C — оставить/удалить · S — разделить · R — проверено · N / Enter — следующее непроверенное · Ctrl+колесо — масштаб</div>
        </div>
      </div>

      <div className="toolbar">
        <button onClick={togglePlay}>{playing ? "⏸ Пауза" : "▶ Пуск"}</button>
        <span className="tc">{fmtTime(current)}</span>
        <button onClick={() => setMarkIn(snapMs(current))}>[ Начало</button>
        <button onClick={() => setMarkOut(snapMs(current))}>Конец ]</button>
        <span className="muted">{markIn != null ? fmtTime(markIn) : "—"} → {markOut != null ? fmtTime(markOut) : "—"}</span>
        <button disabled={!rangeOk} onClick={() => playRange(markIn!, markOut!)}>▶ Интервал</button>
        <button disabled={!rangeOk || busy} onClick={() => run({ op: "set_range", start_ms: markIn, end_ms: markOut, action: "CUT" })}>Вырезать интервал</button>
        <button disabled={!rangeOk || busy} onClick={() => run({ op: "set_range", start_ms: markIn, end_ms: markOut, action: "KEEP" })}>Оставить интервал</button>
        <button disabled={!here || busy} onClick={() => here && run({ op: "split", id: here.id, at_ms: snapMs(current) })}>Разделить (S)</button>
        <span className="grow" />
        <label className="zoom">Масштаб <input type="range" min={0.5} max={300} step={0.5} value={pps} onChange={(e) => setPps(Number(e.target.value))} /></label>
        <button onClick={fit}>Вписать</button>
      </div>

      <Timeline durationMs={plan.duration_ms} fps={fps} segments={segs} sceneMs={scenes?.boundaries_ms ?? []} wave={wave}
        current={current} pps={pps} selectedId={selectedId} markIn={markIn} markOut={markOut}
        onSeek={seek} onSelect={(id) => setSelectedId(id)} scrollRef={scrollRef}
        onMoveBoundary={(id, ms) => run({ op: "move_boundary", id, at_ms: ms })}
        onRange={(a, b) => { setMarkIn(a); setMarkOut(b); }} />
      <div className="legend">
        <span className="sw keep" /> оставить <span className="sw cut" /> удалить <span className="sw manual" /> изменено вручную
        <span className="sw unrev" /> не проверено <span className="sw scene" /> смена сцены
        <span className="muted"> · границы между фрагментами можно перетаскивать</span>
      </div>
      {error && <p className="error">{error}</p>}

      {thumbs && thumbs.files.length > 0 && (
        <div className="scenes">
          <button className="link" onClick={() => setShowScenes(!showScenes)}>{showScenes ? "▾" : "▸"} Сцены ({thumbs.files.length})</button>
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

      <div className="row">
        <h3 className="grow">События ({rows.length})</h3>
        <label className="check"><input type="checkbox" checked={onlyUnreviewed} onChange={(e) => setOnlyUnreviewed(e.target.checked)} /> только непроверенные</label>
        <button disabled={busy || stats.unreviewed === 0} onClick={() => run({ op: "review", reviewed: true })}>Отметить всё проверенным</button>
      </div>
      <div className="seglist">
        <table>
          <thead><tr><th>#</th><th>Начало</th><th>Конец</th><th>Длит.</th><th>Решение</th><th>Причина</th><th>Статус</th><th /></tr></thead>
          <tbody>
            {rows.map((s) => {
              const idx = segs.indexOf(s);
              const next = segs[idx + 1];
              return (
                <tr key={s.id} className={`${s.action.toLowerCase()} ${selectedId === s.id ? "sel" : ""}`}
                  onClick={() => { setSelectedId(s.id); seek(s.source_start_ms); }}>
                  <td>{idx + 1}</td>
                  <td>{fmtTime(s.source_start_ms)}</td><td>{fmtTime(s.source_end_ms)}</td>
                  <td>{((s.source_end_ms - s.source_start_ms) / 1000).toFixed(2)} с</td>
                  <td><b>{s.action === "KEEP" ? "Оставить" : "Удалить"}</b>{s.locked ? " 🔒" : ""}</td>
                  <td>{REASONS[s.reason] ?? s.reason}</td>
                  <td>{s.manual ? "вручную" : s.reviewed ? "проверено" : "не проверено"}</td>
                  <td className="actions" onClick={(e) => e.stopPropagation()}>
                    <button title="Воспроизвести интервал" onClick={() => playRange(s.source_start_ms, s.source_end_ms)}>▶</button>
                    <button disabled={busy} onClick={() => run({ op: "set_action", id: s.id, action: s.action === "KEEP" ? "CUT" : "KEEP" })}>
                      {s.action === "KEEP" ? "Удалить" : "Вернуть"}</button>
                    <button disabled={busy} title="Обязательно сохранить" onClick={() => run({ op: "lock", id: s.id, locked: !s.locked })}>{s.locked ? "🔓" : "🔒"}</button>
                    <button disabled={busy} title="Отметить проверенным" onClick={() => run({ op: "review", ids: [s.id], reviewed: !s.reviewed })}>{s.reviewed ? "✓" : "○"}</button>
                    {next && <button disabled={busy} title="Объединить со следующим" onClick={() => run({ op: "merge", id: s.id, second_id: next.id, action: s.action })}>⇆</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected && <p className="muted">Выбрано: {selected.id}</p>}
    </div>
  );
}
