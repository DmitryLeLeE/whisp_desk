import { useMemo, useRef, useState } from "react";
import { fmtTime } from "../api";
import type { Segment, Waveform } from "../types";

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
  onSeek: (ms: number) => void;
  onSelect: (id: string) => void;
  onMoveBoundary: (leftId: string, ms: number) => void;
  onRange: (a: number, b: number) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
}

const tickStep = (pps: number): number => {
  for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]) if (s * pps >= 70) return s;
  return 3600;
};

export default function Timeline(p: Props) {
  const inner = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; ms: number } | null>(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const sel = useRef<{ x: number; ms: number; moved: boolean } | null>(null);
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
    <div className="timeline" ref={p.scrollRef}>
      <div className="tl-inner" ref={inner} style={{ width }}
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
              title={`${fmtTime(s.source_start_ms)} – ${fmtTime(s.source_end_ms)} · ${s.action} · ${s.reason}${s.reviewed ? "" : " · не проверено"}`}
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
        {p.sceneMs.map((ms) => <div key={ms} className="scene" style={{ left: x(ms) }} title={`Смена сцены ${fmtTime(ms)}`} />)}
        {p.markIn != null && <div className="mark in" style={{ left: x(p.markIn) }} />}
        {p.markOut != null && <div className="mark out" style={{ left: x(p.markOut) }} />}
        {drag && <div className="tl-ghost" style={{ left: x(drag.ms) }}><span>{fmtTime(drag.ms)}</span></div>}
        {hoverMs != null && !drag && (
          <div className="tl-hover-ghost" style={{ left: x(hoverMs) }}>
            <span>{fmtTime(hoverMs, true)}</span>
          </div>
        )}
        <div className="playhead" style={{ left: x(p.current) }} />
      </div>
    </div>
  );
}
