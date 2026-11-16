import { useCallback, useEffect, useState } from "react";
import { api, fmtSize, fmtTime } from "../api";
import Icon from "./Icon";
import type { ExportFile, Job, PlanPayload, Project, TemplateInfo, VersionInfo } from "../types";

const FORMATS: [string, string][] = [
  ["srt", "Субтитры SRT под новый монтаж (и перевод, если он есть)"], ["ass", "Субтитры ASS"], ["plan", "Монтажный план JSON"],
  ["info", "Технические данные об исходнике"], ["edl", "EDL CMX3600 (экспериментально)"], ["v3", "Auto-Editor .v3 (экспериментально)"], ["fcpxml", "FCPXML для DaVinci Resolve (экспериментально)"],
];

export default function ExportPanel({ pid, project, payload, busy, onJob, onPayload }: {
  pid: string; project: Project; payload: PlanPayload; busy: boolean; onJob: (j: Job) => void; onPayload: (p: PlanPayload) => void;
}) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState(project.settings.template);
  const [burn, setBurn] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [encoder, setEncoder] = useState("libx264");
  const [engine, setEngine] = useState("ffmpeg");
  const [aeOk, setAeOk] = useState(false);
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
  useEffect(() => {
    api.get<TemplateInfo[]>("/api/templates").then(setTemplates);
    api.get<{ auto_editor: { available: boolean } }>("/api/system").then((s) => setAeOk(s.auto_editor.available)).catch(() => undefined);
  }, []);
  useEffect(() => { reload(); }, [reload, busy]);

  const guard = async (fn: () => Promise<unknown>, ok = "") => {
    setError(""); setMsg("");
    try { await fn(); if (ok) setMsg(ok); reload(); } catch (e) { setError((e as Error).message); }
  };
  const render = (mode: "fast" | "final") => guard(async () => {
    await api.patch(`/api/projects/${pid}`, { settings: { template } });
    onJob(await api.post<Job>(`/api/projects/${pid}/render`, { mode, template, burn_subtitles: burn && project.has_subtitles, overwrite, engine,
      options: { video: { encoder } } }));
  });
  const toggle = (f: string) => setFormats(formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f]);

  const hasOut = files.some((f) => f.name.endsWith(".mp4"));
  return (
    <div className="grid2">
      <div className="stack">
        <section className="card">
          <div className="card-title"><span className="num"><Icon name="film" /></span><h2>Готовое видео</h2></div>
          <p className="muted">Получится {fmtTime(payload.stats.output_ms, false)} из {fmtTime(payload.stats.source_ms, false)}.
            {payload.stats.unreviewed > 0 && <> Непроверенных решений: <b>{payload.stats.unreviewed}</b> — они войдут в результат как есть.</>}</p>
          <div className="row wrap">
            <button className="primary big" onClick={() => render("final")} disabled={busy}><Icon name="film" /> Собрать видео и материалы</button>
            <button className="big" onClick={() => render("fast")} disabled={busy} title="Низкое разрешение, чтобы быстро проверить монтаж">Быстрый тест (480p)</button>
          </div>
          <p className="muted small">Финальная сборка создаёт MP4, субтитры (если есть расшифровка), монтажный план и проектные файлы для Auto-Editor и DaVinci Resolve. Результат проверяется FFprobe.</p>
          {error && <p className="error">{error}</p>}
          {msg && <p className="ok">{msg}</p>}
          <details className="more"><summary>Параметры сборки</summary>
            <label>Оформление
              <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <p className="muted small">{templates.find((t) => t.id === template)?.description}</p>
            <label>Кодирование
              <select value={encoder} onChange={(e) => setEncoder(e.target.value)}>
                <option value="libx264">Процессор (libx264) — надёжно</option>
                <option value="auto">Видеокарта, если доступна (NVENC / QSV / AMF), иначе процессор</option>
              </select>
            </label>
            <label>Движок рендера
              <select value={engine} onChange={(e) => { setEngine(e.target.value); if (e.target.value === "auto-editor") setBurn(false); }}>
                <option value="ffmpeg">FFmpeg — оформление, субтитры, заставки</option>
                <option value="auto-editor" disabled={!aeOk}>Auto-Editor{aeOk ? " — без оформления и вшитых субтитров" : " (не найден)"}</option>
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={burn} disabled={!project.has_subtitles || engine === "auto-editor"} onChange={(e) => setBurn(e.target.checked)} /> Вшить субтитры в видео {project.has_subtitles ? "" : "(нет расшифровки)"}</label>
            <label className="check"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Перезаписать, если результат уже существует</label>
          </details>
        </section>

        <section className="card">
          <div className="card-title"><span className="num"><Icon name="download" /></span><h2>Готовые файлы</h2></div>
          {files.length === 0 ? <p className="muted">Пока ничего нет. Файлы появятся здесь после сборки.</p> : (
            <ul className="list">
              {files.map((f) => <li key={f.where + f.name}><Icon name={f.name.endsWith(".mp4") ? "film" : "file"} /><a href={`/api/projects/${pid}/exports/${encodeURIComponent(f.name)}`} download>{f.name}</a><span className="muted">{fmtSize(f.size)}</span></li>)}
            </ul>
          )}
          {hasOut && <p className="muted small">Нажмите на имя файла, чтобы сохранить его. Копия лежит и в папке проекта (exports).</p>}
        </section>
      </div>

      <div className="stack">
        <section className="card">
          <div className="card-title"><h2>Экспорт без рендера</h2></div>
          <p className="muted">Для работы в других программах. Видео при этом не перекодируется.</p>
          {FORMATS.map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={formats.includes(k)} onChange={() => toggle(k)} /> {label}</label>
          ))}
          <button disabled={!formats.length} onClick={() => guard(async () => {
            const r = await api.post<{ written: string[] }>(`/api/projects/${pid}/export`, { formats, overwrite });
            setMsg("Записано: " + r.written.join(", "));
          })}>Экспортировать</button>
          <p className="muted small">Форматы .v3 и FCPXML проверены не во всех версиях программ: .v3 открывается в Auto-Editor 29, FCPXML и EDL в DaVinci Resolve и Kdenlive не проверялись.</p>
        </section>

        <section className="card">
          <div className="card-title"><h2>Версии монтажа</h2></div>
          <div className="row">
            <input className="grow" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Название версии (необязательно)" />
            <button onClick={() => guard(async () => { await api.post(`/api/projects/${pid}/timeline/versions`, { label }); setLabel(""); })}>Сохранить версию</button>
          </div>
          {versions.length === 0 ? <p className="muted">Сохранённых версий пока нет. Версию стоит сохранить перед большими правками.</p> : (
            <ul className="list">
              {versions.map((v) => (
                <li key={v.name}><b>{v.name}</b> {v.label}<span className="muted">{v.created && new Date(v.created).toLocaleString("ru-RU")}</span>
                  <button disabled={busy} onClick={() => confirm(`Вернуть версию ${v.name}? Текущий план можно будет отменить (Ctrl+Z).`) &&
                    guard(async () => onPayload(await api.post<PlanPayload>(`/api/projects/${pid}/timeline/versions/${v.name}/restore`)), "Версия восстановлена")}>Восстановить</button></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
