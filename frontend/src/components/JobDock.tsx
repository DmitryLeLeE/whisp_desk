import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Job } from "../types";
import { useTranslation } from "../i18n";
import Icon from "./Icon";

const KIND: Record<string, [string, string]> = { analyze: ["Анализ", "Analysis"], render: ["Рендер", "Render"], transcribe: ["Расшифровка", "Transcription"], compare: ["Сравнение движков", "Engine comparison"] };
const STATUS: Record<string, [string, string]> = { QUEUED: ["В очереди", "Queued"], RUNNING: ["Выполняется", "Running"], COMPLETED: ["Готово", "Done"], FAILED: ["Ошибка", "Failed"], CANCELLED: ["Отменено", "Cancelled"] };

function playCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => undefined);
    }
    const now = ctx.currentTime;

    // Первый гармонический тон (C5: 523.25 Гц)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.12, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Второй гармонический тон (E5: 659.25 Гц) с мягкой задержкой
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(659.25, now + 0.08);
    gain2.gain.setValueAtTime(0, now + 0.08);
    gain2.gain.linearRampToValueAtTime(0.14, now + 0.11);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.46);

    setTimeout(() => {
      ctx.close().catch(() => undefined);
    }, 600);
  } catch {
    // Безопасное подавление при запрете воспроизведения звука браузером
  }
}

/** Плавающая панель текущей задачи: прогресс, отмена, повтор, журнал. */
export default function JobDock({ job, onJob, onDone }: { job: Job | null; onJob: (j: Job | null) => void; onDone: () => void }) {
  const { lang } = useTranslation();
  const ru = lang === "ru";
  const [showLog, setShowLog] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (job) {
      const prev = prevStatusRef.current;
      if ((prev === "RUNNING" || prev === "QUEUED") && job.status === "COMPLETED") {
        playCompletionChime();
      }
      prevStatusRef.current = job.status;
    } else {
      prevStatusRef.current = null;
    }
  }, [job?.status]);

  if (!job) return null;
  const active = job.status === "QUEUED" || job.status === "RUNNING";
  const cancel = async () => onJob(await api.post<Job>(`/api/jobs/${job.id}/cancel`));
  const retry = async () => { onJob(await api.post<Job>(`/api/jobs/${job.id}/retry`)); onDone(); };
  const toggleLog = async () => { setShowLog(!showLog); if (!showLog) onJob(await api.get<Job>(`/api/jobs/${job.id}`)); };

  return (
    <aside className={`dock ${job.status.toLowerCase()}`} role="status">
      <div className="head">
        <b>{KIND[job.kind] ? KIND[job.kind][ru ? 0 : 1] : job.kind}</b>
        <span className={`badge ${job.status === "COMPLETED" ? "ok" : job.status === "FAILED" ? "bad" : "accent"}`}>{STATUS[job.status][ru ? 0 : 1]}</span>
        {!active && <button className="ghost" onClick={() => onJob(null)} aria-label={ru ? "Скрыть" : "Hide"}><Icon name="x" /></button>}
      </div>
      {active && <div className="bar" aria-hidden><i style={{ width: `${Math.max(2, Math.round(job.progress * 100))}%` }} /></div>}
      <div className="muted">{job.message || job.stage}{active ? ` · ${Math.round(job.progress * 100)}% · ${job.elapsed_s ?? 0} ${ru ? "с" : "s"}` : ""}</div>
      {job.error && <div className="error">{job.error}</div>}
      {job.status === "COMPLETED" && job.kind === "render" && typeof job.result?.output === "string" && <div className="ok">{ru ? "Готово" : "Done"}: {String(job.result.output)}</div>}
      <div className="row">
        {active && <button onClick={cancel}>{ru ? "Отменить" : "Cancel"}</button>}
        {(job.status === "FAILED" || job.status === "CANCELLED") && <button onClick={retry}>{ru ? "Повторить" : "Retry"}</button>}
        <span className="grow" />
        <button className="link" onClick={toggleLog}>{showLog ? (ru ? "Скрыть журнал" : "Hide log") : (ru ? "Журнал" : "Log")}</button>
      </div>
      {showLog && <pre className="log">{(job.log ?? []).join("\n") || (ru ? "Журнал пуст" : "Log is empty")}</pre>}
    </aside>
  );
}
