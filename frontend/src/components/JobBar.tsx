import { useState } from "react";
import { api } from "../api";
import type { Job } from "../types";

const KIND: Record<string, string> = { analyze: "Анализ", render: "Рендер", transcribe: "Расшифровка" };
const STATUS: Record<string, string> = { QUEUED: "В очереди", RUNNING: "Выполняется", COMPLETED: "Готово", FAILED: "Ошибка", CANCELLED: "Отменено" };

export default function JobBar({ job, onJob, onDone }: { job: Job | null; onJob: (j: Job) => void; onDone: () => void }) {
  const [showLog, setShowLog] = useState(false);
  if (!job) return null;
  const active = job.status === "QUEUED" || job.status === "RUNNING";
  const cancel = async () => onJob(await api.post<Job>(`/api/jobs/${job.id}/cancel`));
  const retry = async () => { onJob(await api.post<Job>(`/api/jobs/${job.id}/retry`)); onDone(); };
  return (
    <div className={`jobbar ${job.status.toLowerCase()}`}>
      <div className="jobline">
        <b>{KIND[job.kind] ?? job.kind}</b>
        <span>{STATUS[job.status]}</span>
        <span className="stage">{job.stage}</span>
        {active && <progress value={job.progress} max={1} />}
        {active && <span className="muted">{Math.round(job.progress * 100)}% · {job.elapsed_s ?? 0} с</span>}
        <span className="grow" />
        {active && <button onClick={cancel}>Отменить</button>}
        {(job.status === "FAILED" || job.status === "CANCELLED") && <button onClick={retry}>Повторить</button>}
        <button className="link" onClick={async () => { setShowLog(!showLog); if (!showLog) onJob(await api.get<Job>(`/api/jobs/${job.id}`)); }}>
          {showLog ? "Скрыть журнал" : "Журнал"}
        </button>
      </div>
      {job.error && <div className="error">{job.error}</div>}
      {showLog && <pre className="log">{(job.log ?? []).join("\n") || "Журнал пуст"}</pre>}
    </div>
  );
}
