import { useState } from "react";
import { api } from "../api";
import type { Job } from "../types";
import Icon from "./Icon";

const KIND: Record<string, string> = { analyze: "Анализ", render: "Рендер", transcribe: "Расшифровка", compare: "Сравнение движков" };
const STATUS: Record<string, string> = { QUEUED: "В очереди", RUNNING: "Выполняется", COMPLETED: "Готово", FAILED: "Ошибка", CANCELLED: "Отменено" };

/** Плавающая панель текущей задачи: прогресс, отмена, повтор, журнал. */
export default function JobDock({ job, onJob, onDone }: { job: Job | null; onJob: (j: Job | null) => void; onDone: () => void }) {
  const [showLog, setShowLog] = useState(false);
  if (!job) return null;
  const active = job.status === "QUEUED" || job.status === "RUNNING";
  const cancel = async () => onJob(await api.post<Job>(`/api/jobs/${job.id}/cancel`));
  const retry = async () => { onJob(await api.post<Job>(`/api/jobs/${job.id}/retry`)); onDone(); };
  const toggleLog = async () => { setShowLog(!showLog); if (!showLog) onJob(await api.get<Job>(`/api/jobs/${job.id}`)); };
  return (
    <aside className={`dock ${job.status.toLowerCase()}`} role="status">
      <div className="head">
        <b>{KIND[job.kind] ?? job.kind}</b>
        <span className={`badge ${job.status === "COMPLETED" ? "ok" : job.status === "FAILED" ? "bad" : "accent"}`}>{STATUS[job.status]}</span>
        {!active && <button className="ghost" onClick={() => onJob(null)} aria-label="Скрыть"><Icon name="x" /></button>}
      </div>
      {active && <div className="bar" aria-hidden><i style={{ width: `${Math.max(2, Math.round(job.progress * 100))}%` }} /></div>}
      <div className="muted">{job.message || job.stage}{active ? ` · ${Math.round(job.progress * 100)}% · ${job.elapsed_s ?? 0} с` : ""}</div>
      {job.error && <div className="error">{job.error}</div>}
      {job.status === "COMPLETED" && job.kind === "render" && typeof job.result?.output === "string" && <div className="ok">Готово: {String(job.result.output)}</div>}
      <div className="row">
        {active && <button onClick={cancel}>Отменить</button>}
        {(job.status === "FAILED" || job.status === "CANCELLED") && <button onClick={retry}>Повторить</button>}
        <span className="grow" />
        <button className="link" onClick={toggleLog}>{showLog ? "Скрыть журнал" : "Журнал"}</button>
      </div>
      {showLog && <pre className="log">{(job.log ?? []).join("\n") || "Журнал пуст"}</pre>}
    </aside>
  );
}
