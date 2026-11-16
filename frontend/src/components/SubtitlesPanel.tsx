import { useMemo, useRef, useState } from "react";
import { api, fmtTime } from "../api";
import type { Cue, Job, Project } from "../types";

export default function SubtitlesPanel({ pid, project, cues, busy, onJob, onChanged, onJump }: {
  pid: string; project: Project; cues: Cue[]; busy: boolean; onJob: (j: Job) => void; onChanged: () => void; onJump: (ms: number) => void;
}) {
  const [q, setQ] = useState("");
  const [model, setModel] = useState("small");
  const [language, setLanguage] = useState("auto");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const found = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (n ? cues.filter((c) => c.text.toLowerCase().includes(n)) : cues).slice(0, 500);
  }, [q, cues]);

  const importFile = async (f: File) => {
    setError(""); setMsg("");
    if (cues.length && !confirm("Расшифровка уже загружена. Заменить? Прежний импорт останется в папке проекта.")) return;
    try { const r = await api.upload<{ cues: number }>(`/api/projects/${pid}/subtitles/import`, f); setMsg(`Загружено реплик: ${r.cues}`); onChanged(); }
    catch (e) { setError((e as Error).message); }
  };

  const transcribe = async () => {
    setError("");
    try { onJob(await api.post<Job>(`/api/projects/${pid}/subtitles/transcribe`, { model, language, overwrite: cues.length > 0 })); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="grid2">
      <section className="card">
        <h2>Расшифровка</h2>
        <div className="row">
          <input ref={file} type="file" accept=".srt,.vtt,.ass,.ssa,.txt,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
          <button className="primary" onClick={() => file.current?.click()}>Импортировать файл…</button>
          <span className="muted">SRT, VTT, ASS, TXT с метками [чч:мм:сс], JSON</span>
        </div>
        <hr />
        <p className="muted">Или запустите Whisp (faster-whisper) на этом файле. Нужна установленная модель и Python с faster-whisper.</p>
        <div className="row wrap">
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {["tiny", "base", "small", "medium", "large-v3"].map((m) => <option key={m}>{m}</option>)}
          </select>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="auto">Язык: авто</option><option value="ru">Русский</option><option value="en">English</option>
          </select>
          <button onClick={transcribe} disabled={busy}>Расшифровать через Whisp</button>
        </div>
        {msg && <p className="ok">{msg}</p>}
        {error && <p className="error">{error}</p>}
        <p className="muted">При экспорте время реплик пересчитывается под новый монтаж; реплика на границе удаления обрезается или делится.
          Исходная расшифровка сохраняется без изменений.</p>
        {!project.has_subtitles && <p className="muted">Расшифровка не загружена. Монтаж и рендер работают и без неё.</p>}
      </section>
      <section className="card">
        <h2>Текст {cues.length ? `(${cues.length})` : ""}</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск слов и фраз" disabled={!cues.length} />
        <ul className="list cues">
          {found.map((c, i) => (
            <li key={i}><button className="link" onClick={() => onJump(c.start_ms)}>{fmtTime(c.start_ms, false)}</button><span>{c.text}</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
