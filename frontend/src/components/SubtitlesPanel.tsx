import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtTime } from "../api";
import type { Cue, Job, Project, WhispModels } from "../types";
import Icon from "./Icon";
import ModelCards from "./ModelCards";

export default function SubtitlesPanel({ pid, cues, busy, onJob, onChanged, onJump }: {
  pid: string; project?: Project; cues: Cue[]; busy: boolean; onJob: (j: Job) => void; onChanged: () => void; onJump: (ms: number) => void;
}) {
  const [wm, setWm] = useState<WhispModels | null>(null);
  const [q, setQ] = useState("");
  const [model, setModel] = useState("");
  const [language, setLanguage] = useState("ru");
  const [device, setDevice] = useState("auto");
  const [translateTo, setTranslateTo] = useState("");
  const [toEnglish, setToEnglish] = useState(false);
  const [lineChars, setLineChars] = useState(0);
  const [vad, setVad] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.get<WhispModels>("/api/whisp/models").then((d) => {
    setWm(d);
    setModel((cur) => cur || d.models.find((m) => m.name === "turbo" && m.downloaded)?.name || d.models.find((m) => m.downloaded)?.name || "turbo");
  }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!wm?.models.some((m) => m.download?.state === "running")) return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [wm, load]);

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
    setError(""); setMsg("");
    if (cues.length && !confirm("Расшифровка уже есть. Заменить новой? Прежняя останется в папке проекта.")) return;
    try {
      onJob(await api.post<Job>(`/api/projects/${pid}/subtitles/transcribe`, {
        model, language, device, overwrite: cues.length > 0, translate_to: translateTo, task: toEnglish ? "translate" : "transcribe",
        max_line_chars: lineChars, vad,
      }));
    } catch (e) { setError((e as Error).message); }
  };

  const chosen = wm?.models.find((m) => m.name === model);
  const whispOk = wm?.info.available ?? true;
  const langs = wm ? Object.entries(wm.languages).filter(([k]) => k !== "auto") : [];

  return (
    <div className="grid2">
      <div className="stack">
        <section className="card">
          <div className="card-title"><span className="num"><Icon name="mic" /></span><h2>Расшифровать речь (Whisp)</h2></div>
          {!whispOk && <div className="notice warn"><Icon name="alert" /> Whisp недоступен в этой копии программы. Импортируйте готовые субтитры ниже.</div>}
          <p className="muted">Выберите модель. Скачанные модели работают без интернета. При первом запуске нужная модель скачается автоматически.</p>
          {wm && <ModelCards models={wm.models} selected={model} onSelect={setModel} onChanged={load} onError={setError} />}
          <div className="fields">
            <label>Язык речи
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="auto">Определить автоматически</option>
                {langs.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <details className="more"><summary>Дополнительно</summary>
            <div className="fields">
              <label>Устройство
                <select value={device} onChange={(e) => setDevice(e.target.value)}>
                  <option value="auto">Автоматически (видеокарта NVIDIA, если есть)</option>
                  <option value="cpu">Процессор</option>
                  <option value="cuda">Видеокарта NVIDIA (CUDA)</option>
                </select>
              </label>
              <label>Символов в строке (0 — как получилось)
                <input type="number" min={0} max={120} value={lineChars} onChange={(e) => setLineChars(Math.max(0, Number(e.target.value)))} />
              </label>
              <label>Перевести субтитры на язык
                <select value={translateTo} onChange={(e) => { setTranslateTo(e.target.value); if (e.target.value) setToEnglish(false); }}>
                  <option value="">Не переводить</option>
                  {langs.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            <label className="check"><input type="checkbox" checked={vad} onChange={(e) => setVad(e.target.checked)} /> Пропускать тишину при распознавании (меньше ложных фраз)</label>
            <label className="check"><input type="checkbox" checked={toEnglish} disabled={!!translateTo} onChange={(e) => setToEnglish(e.target.checked)} /> Сразу переводить речь на английский средствами Whisper</label>
            {translateTo && <p className="muted small">Машинный перевод использует модель NLLB-200 (~620 МБ, скачается при первом использовании). Лицензия весов CC-BY-NC-4.0: только некоммерческое использование.
              Перевод проверьте глазами: каждая реплика переводится отдельно. Файл перевода появится при экспорте субтитров.</p>}
          </details>
          <div className="row wrap">
            <button className="primary big" onClick={transcribe} disabled={busy || !whispOk || !model}><Icon name="mic" /> Расшифровать</button>
            {chosen && chosen.downloaded === false && <span className="muted">Модель «{chosen.name}» скачается сначала (≈ {chosen.size_mb >= 1000 ? `${(chosen.size_mb / 1000).toFixed(1)} ГБ` : `${chosen.size_mb} МБ`}).</span>}
          </div>
        </section>

        <section className="card">
          <div className="card-title"><span className="num"><Icon name="file" /></span><h2>Или загрузить готовые субтитры</h2></div>
          <div className="row">
            <input ref={file} type="file" accept=".srt,.vtt,.ass,.ssa,.txt,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
            <button onClick={() => file.current?.click()}>Выбрать файл…</button>
            <span className="muted">SRT, VTT, ASS, TXT с метками времени, JSON</span>
          </div>
          {msg && <p className="ok">{msg}</p>}
          {error && <p className="error">{error}</p>}
          <p className="muted small">При экспорте время реплик пересчитывается под новый монтаж; реплика на границе удаления обрезается или делится. Исходная расшифровка сохраняется без изменений.</p>
        </section>
      </div>

      <section className="card">
        <div className="card-title"><h2>Текст {cues.length ? `(${cues.length})` : ""}</h2></div>
        {cues.length === 0 ? (
          <div className="empty"><Icon name="captions" /><span>Расшифровки пока нет. Запустите Whisp слева или загрузите готовый файл.</span></div>
        ) : (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск слов и фраз" />
            <ul className="list cues">
              {found.map((c, i) => (
                <li key={i}><button className="link" onClick={() => onJump(c.start_ms)} title="Показать в монтаже">{fmtTime(c.start_ms, false)}</button><span>{c.text}</span></li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
