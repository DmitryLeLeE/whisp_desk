import { useEffect, useMemo, useRef, useState } from "react";
import { fmtTime } from "../api";
import type { Cue, Segment, TimelineMarker, Waveform } from "../types";
import { useTranslation } from "../i18n";
import Icon from "./Icon";

interface Props {
  durationMs: number;
  fps: number;
  segments: Segment[];
  sceneMs: number[];
  wave: Waveform | null;
  current: number;
  pps: number;                       // пикселей на секунду
  selectedId: string | null;
  markIn: number | null;
  markOut: number | null;
  markers?: TimelineMarker[];
  cues?: Cue[];
  onSeek: (ms: number) => void;
  onSelect: (id: string) => void;
  onMoveBoundary: (leftId: string, ms: number) => void;
  onRange: (a: number, b: number) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  onContextAction?: (action: "toggle" | "split" | "marker" | "lock" | "play", seg: Segment | null, ms: number) => void;
  onZoom?: (factor: number) => void;
}

const tickStep = (pps: number): number => {
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]) if (s * pps >= 70) return s;
  return 3600;
};

export default function Timeline(p: Props) {
  const { lang } = useTranslation();
  const ru = lang === "ru";
  const inner = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; ms: number } | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const sel = useRef<{ x: number; ms: number; moved: boolean } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; ms: number; seg: Segment | null } | null>(null);
  const ppsRef = useRef(p.pps);
  ppsRef.current = p.pps;
  const onZoomRef = useRef(p.onZoom);
  onZoomRef.current = p.onZoom;

  // Ctrl + колесо: масштаб вокруг курсора мыши
  useEffect(() => {
    const el = p.scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !onZoomRef.current) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const offset = e.clientX - rect.left;
      const anchorSec = (el.scrollLeft + offset) / ppsRef.current;
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      const next = Math.min(300, Math.max(0.5, ppsRef.current * factor));
      onZoomRef.current(factor);
      requestAnimationFrame(() => { el.scrollLeft = Math.max(0, anchorSec * next - offset); });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [p.scrollRef]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); window.removeEventListener("blur", close); };
  }, [menu]);

  const width = Math.max(1, (p.durationMs / 1000) * p.pps);
  const x = (ms: number) => (ms / 1000) * p.pps;

  const path = useMemo(() => {
    if (!p.wave || !p.wave.peaks.length) return "";
    const peaks = p.wave.peaks;
    const top0 = Math.max(0.001, ...peaks);   // масштаб относительно самого громкого места записи
    const n = Math.min(peaks.length, 3000);
    const per = peaks.length / n;
    const top: string[] = [], bottom: string[] = [];
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = Math.floor(i * per); j < Math.floor((i + 1) * per) && j < peaks.length; j++) m = Math.max(m, peaks[j]);
      const h = Math.max(0.5, (m / top0) * 48);
      top.push(`${i},${50 - h}`);
      bottom.unshift(`${i},${50 + h}`);
    }
    return `M${top.join(" L")} L${bottom.join(" L")} Z`;
  }, [p.wave]);

  const msAt = (clientX: number) => {
    const r = inner.current!.getBoundingClientRect();
    return Math.min(p.durationMs, Math.max(0, ((clientX - r.left) / p.pps) * 1000));
  };
  const snap = (ms: number) => { const f = 1000 / p.fps; return Math.round(Math.round(ms / f) * f); };

  const ticks = useMemo(() => {
    const step = tickStep(p.pps), out: number[] = [];
    for (let s = 0; s * 1000 <= p.durationMs; s += step) out.push(s);
    return out;
  }, [p.pps, p.durationMs]);

  const startDrag = (e: React.PointerEvent, seg: Segment) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: seg.id, ms: seg.source_end_ms });
  };

  return (
    <div className="timeline-wrapper">
      <div className="track-headers">
        <div className="th-cell th-ruler" title="Ruler">
          <span className="th-code">TC</span>
        </div>
        <div className="th-cell th-v1" title="Video Track 1">
          <span className="th-badge">V1</span>
          <span className="th-icon"><Icon name="eye" style={{ width: 11, height: 11 }} /></span>
          <span className="th-icon"><Icon name="lock" style={{ width: 10, height: 10 }} /></span>
        </div>
        <div className="th-cell th-a1" title="Audio Track 1 (Waveform & Speech)">
          <span className="th-badge">A1</span>
          <span className="th-icon"><Icon name="volume" style={{ width: 11, height: 11 }} /></span>
          <span className="th-mute">M</span>
        </div>
        {p.cues && p.cues.length > 0 && (
          <div className="th-cell th-t1" title="Subtitle / Text Track 1">
            <span className="th-badge th-badge-t1">T1</span>
            <span className="th-icon"><Icon name="captions" style={{ width: 11, height: 11 }} /></span>
          </div>
        )}
      </div>

      <div className="timeline" ref={p.scrollRef}>
        <div className={`tl-inner ${p.cues && p.cues.length > 0 ? "with-subs" : ""}`} ref={inner} style={{ width }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            sel.current = { x: e.clientX, ms: msAt(e.clientX), moved: false };
            p.onSeek(sel.current.ms);
          }}
          onPointerMove={(e) => {
            setHoverMs(msAt(e.clientX));
            const s = sel.current;
            if (!s || drag) return;
            if (!s.moved && Math.abs(e.clientX - s.x) < 5) return;
            s.moved = true;
            const a = snap(s.ms), b = snap(msAt(e.clientX));
            p.onRange(Math.min(a, b), Math.max(a, b));
          }}
          onContextMenu={(e) => {
            if (!p.onContextAction) return;
            e.preventDefault();
            const ms = snap(msAt(e.clientX));
            const seg = p.segments.find((g) => g.source_start_ms <= ms && ms < g.source_end_ms) ?? null;
            if (seg) p.onSelect(seg.id);
            setMenu({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 220), ms, seg });
          }}
          onPointerLeave={() => { setHoverMs(null); }}
          onPointerUp={() => { sel.current = null; }}>
          <div className="ruler">
            {ticks.map((s) => <span key={s} style={{ left: s * p.pps }}>{fmtTime(s * 1000, false)}</span>)}
          </div>
          <div className="wave">
            <svg viewBox={`0 0 ${Math.min(p.wave?.peaks.length ?? 1, 3000)} 100`} preserveAspectRatio="none" width={width} height="100%">
              <path d={path} />
            </svg>
          </div>
          <div className="segs">
            {p.segments.map((s, i) => (
              <div key={s.id}
                className={`seg ${s.action.toLowerCase()} ${s.manual ? "manual" : ""} ${!s.reviewed ? "unrev" : ""} ${s.locked ? "locked" : ""} ${p.selectedId === s.id ? "sel" : ""}`}
                style={{ left: x(s.source_start_ms), width: Math.max(1, x(s.source_end_ms - s.source_start_ms)) }}
                title={`${fmtTime(s.source_start_ms)} – ${fmtTime(s.source_end_ms)} · ${s.action} · ${s.reason}${s.reviewed ? "" : (ru ? " · не проверено" : " · not reviewed")}`}
                onPointerDown={(e) => { if (e.button === 0) { p.onSelect(s.id); } }}>
                {i < p.segments.length - 1 && (
                  <div className="handle"
                    onPointerDown={(e) => startDrag(e, s)}
                    onPointerMove={(e) => { if (drag?.id === s.id) setDrag({ id: s.id, ms: snap(msAt(e.clientX)) }); }}
                    onPointerUp={() => { if (drag?.id === s.id) { p.onMoveBoundary(s.id, drag.ms); setDrag(null); } }} />
                )}
              </div>
            ))}
          </div>
          {p.sceneMs.map((ms) => <div key={ms} className="scene" style={{ left: x(ms) }} title={`${ru ? "Смена сцены" : "Scene change"} ${fmtTime(ms)}`} />)}
          {p.markIn != null && <div className="mark in" style={{ left: x(p.markIn) }} />}
          {p.markOut != null && <div className="mark out" style={{ left: x(p.markOut) }} />}
          {p.cues && p.cues.length > 0 && (
            <div className="sub-track">
              {p.cues.map((c, i) => (
                <div
                  key={i}
                  className="sub-block"
                  style={{ left: x(c.start_ms), width: Math.max(12, x(c.end_ms - c.start_ms)) }}
                  title={`${fmtTime(c.start_ms)} – ${fmtTime(c.end_ms)}: ${c.text}`}
                  onClick={(e) => { e.stopPropagation(); p.onSeek(c.start_ms); }}
                >
                  <span className="sub-text">{c.text}</span>
                </div>
              ))}
            </div>
          )}
          {drag && <div className="tl-ghost" style={{ left: x(drag.ms) }}><span>{fmtTime(drag.ms)}</span></div>}
          {hoverMs != null && !drag && (
            <div className="tl-hover-ghost" style={{ left: x(hoverMs) }}>
              <span>{fmtTime(hoverMs, true)}</span>
            </div>
          )}
          {p.markers?.map((m) => (
            <div
              key={m.id}
              className={`tl-user-marker ${m.color || "cyan"}`}
              style={{ left: x(m.time_ms) }}
              title={`${fmtTime(m.time_ms)} · ${m.label || (ru ? "Маркер" : "Marker")}`}
              onClick={(e) => { e.stopPropagation(); p.onSeek(m.time_ms); }}
            >
              <div className="marker-pin">◆</div>
              {m.label && <span className="marker-label">{m.label}</span>}
            </div>
          ))}
          <div className="playhead" style={{ left: x(p.current) }} />
        </div>
      </div>
      {menu && p.onContextAction && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <div className="ctx-head">{fmtTime(menu.ms, true)}</div>
          {menu.seg && (
            <>
              <button role="menuitem" onClick={() => { p.onContextAction!("toggle", menu.seg, menu.ms); setMenu(null); }}>
                {menu.seg.action === "KEEP" ? (ru ? "Вырезать фрагмент" : "Cut segment") : (ru ? "Оставить фрагмент" : "Keep segment")}<kbd>X</kbd>
              </button>
              <button role="menuitem" onClick={() => { p.onContextAction!("play", menu.seg, menu.ms); setMenu(null); }}>{ru ? "Прослушать фрагмент" : "Play segment"}</button>
              <button role="menuitem" onClick={() => { p.onContextAction!("lock", menu.seg, menu.ms); setMenu(null); }}>{menu.seg.locked ? (ru ? "Снять защиту" : "Unlock") : (ru ? "Защитить от изменений" : "Lock")}</button>
              <div className="ctx-sep" />
              <button role="menuitem" onClick={() => { p.onContextAction!("split", menu.seg, menu.ms); setMenu(null); }}>{ru ? "Разрезать здесь" : "Split here"}<kbd>C</kbd></button>
            </>
          )}
          <button role="menuitem" onClick={() => { p.onContextAction!("marker", menu.seg, menu.ms); setMenu(null); }}>{ru ? "Поставить маркер" : "Add marker"}<kbd>M</kbd></button>
        </div>
      )}
    </div>
  );
}
