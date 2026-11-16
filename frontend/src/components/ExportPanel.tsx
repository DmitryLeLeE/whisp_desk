import { useCallback, useEffect, useState } from "react";
import { api, fmtSize, fmtTime } from "../api";
import type { ExportFile, Job, PlanPayload, Project, TemplateInfo, VersionInfo } from "../types";

const FORMATS: [string, string][] = [
  ["srt", "Субтитры SRT (под новый монтаж)"], ["ass", "Субтитры ASS"], ["plan", "Монтажный план JSON"],
  ["info", "Технические данные об исходнике"], ["v3", "Auto-Editor .v3 (экспериментально)"], ["fcpxml", "FCPXML для DaVinci Resolve (экспериментально)"],
];

export default function ExportPanel({ pid, project, payload, busy, onJob, onPayload }: {
  pid: string; project: Project; payload: PlanPayload; busy: boolean; onJob: (j: Job) => void; onPayload: (p: PlanPayload) => void;
}) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState(project.settings.template);
  const [burn, setBurn] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [formats, setFormats] = useState<string[]>(project.has_subtitles ? ["srt", "plan", "v3", "fcpxml"] : ["plan", "v3", "fcpxml"]);
  const [files, setFiles] = useState<ExportFile[]>([]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    api.get<ExportFile[]>(`/api/projects/${pid}/exports`).then(setFiles);
    api.get<VersionInfo[]>(`/api/projects/${pid}/timeline/versions`).then(setVersions);
  }, [pid]);
  useEffect(() => { api.get<TemplateInfo[]>("/api/templates").then(setTemplates); }, []);
  useEffect(() => { reload(); }, [reload, busy]);

  const guard = async (fn: () => Promise<unknown>, ok = "") => {
    setError(""); setMsg("");
    try { await fn(); if (ok) setMsg(ok); reload(); } catch (e) { setError((e as Error).message); }
  };
  const render = (mode: "fast" | "final") => guard(async () => {
    await api.patch(`/api/projects/${pid}`, { settings: { template } });
    onJob(await api.post<Job>(`/api/projects/${pid}/render`, { mode, template, burn_subtitles: burn && project.has_subtitles, overwrite }));
  });
  const toggle = (f: string) => setFormats(formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f]);

  return (
    <div className="grid2">
      <section className="card">
        <h2>Рендер</h2>
        <p className="muted">Результат: {fmtTime(payload.stats.output_ms, false)} из {fmtTime(payload.stats.source_ms, false)}.
          {payload.stats.unreviewed > 0 && <> Непроверенных решений: <b>{payload.stats.unreviewed}</b>.</>}</p>
        <label>Шаблон оформления
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <p className="muted">{templates.find((t) => t.id === template)?.description}</p>
        <label className="check"><input type="checkbox" checked={burn} disabled={!project.has_subtitles} onChange={(e) => setBurn(e.target.checked)} /> Вшить субтитры в видео {project.has_subtitles ? "" : "(нет расшифровки)"}</label>
        <label className="check"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Разрешить перезапись существующих результатов</label>
        <div className="row">
          <button onClick={() => render("fast")} disabled={busy}>Быстрый тест (480p)</button>
          <button className="primary" onClick={() => render("final")} disabled={busy}>Финальный рендер + материалы</button>
        </div>
        <p className="muted">Финальный рендер создаёт MP4, SRT/ASS (если есть расшифровка), edit_plan.json, данные об исходнике, .v3 и FCPXML. После рендера результат проверяется FFprobe.</p>
        {error && <p className="error">{error}</p>}
        {msg && <p className="ok">{msg}</p>}
      </section>

      <section className="card">
        <h2>Экспорт без рендера</h2>
        {FORMATS.map(([k, label]) => (
          <label key={k} className="check"><input type="checkbox" checked={formats.includes(k)} onChange={() => toggle(k)} /> {label}</label>
        ))}
        <button disabled={!formats.length} onClick={() => guard(async () => {
          const r = await api.post<{ written: string[] }>(`/api/projects/${pid}/export`, { formats, overwrite });
          setMsg("Записано: " + r.written.join(", "));
        })}>Экспортировать</button>
        <p className="muted">Форматы .v3 и FCPXML нужно проверить на ваших версиях Auto-Editor и DaVinci Resolve. Kdenlive пока не поддерживается.</p>
      </section>

      <section className="card">
        <h2>Готовые файлы</h2>
        {files.length === 0 ? <p className="muted">Пока ничего нет.</p> : (
          <ul className="list">
            {files.map((f) => <li key={f.where + f.name}><a href={`/api/projects/${pid}/exports/${encodeURIComponent(f.name)}`} download>{f.name}</a><span className="muted">{fmtSize(f.size)}</span></li>)}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Версии монтажа</h2>
        <div className="row">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Название версии (необязательно)" />
          <button onClick={() => guard(async () => { await api.post(`/api/projects/${pid}/timeline/versions`, { label }); setLabel(""); })}>Сохранить версию</button>
        </div>
        <ul className="list">
          {versions.map((v) => (
            <li key={v.name}><b>{v.name}</b> {v.label}<span className="muted">{v.created && new Date(v.created).toLocaleString("ru-RU")}</span>
              <button disabled={busy} onClick={() => confirm(`Вернуть версию ${v.name}? Текущий план можно будет отменить (Ctrl+Z).`) &&
                guard(async () => onPayload(await api.post<PlanPayload>(`/api/projects/${pid}/timeline/versions/${v.name}/restore`)), "Версия восстановлена")}>Восстановить</button></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
