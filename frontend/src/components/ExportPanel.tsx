import { useCallback, useEffect, useState } from "react";
import { api, fmtSize, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import Icon from "./Icon";
import type { ExportFile, Job, PlanPayload, Project, TemplateInfo, VersionInfo } from "../types";

interface NlePreset {
  id: string;
  name: string;
  software: string;
  icon: string;
  badge: string;
  desc: string;
  formats: string[];
}

export default function ExportPanel({ pid, project, payload, busy, onJob, onPayload }: {
  pid: string; project: Project; payload: PlanPayload; busy: boolean; onJob: (j: Job) => void; onPayload: (p: PlanPayload) => void;
}) {
  const { t, lang } = useTranslation();
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState(project.settings.template);
  const [burn, setBurn] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [encoder, setEncoder] = useState("libx264");
  const [engine, setEngine] = useState("ffmpeg");
  const [aeOk, setAeOk] = useState(false);
  const [formats, setFormats] = useState<string[]>(
    project.has_subtitles ? ["premiere", "fcpxml", "davinci_markers", "srt"] : ["premiere", "fcpxml", "davinci_markers"]
  );
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
    onJob(await api.post<Job>(`/api/projects/${pid}/render`, {
      mode, template, burn_subtitles: burn && project.has_subtitles, overwrite, engine,
      options: { video: { encoder } },
    }));
  });

  const toggle = (f: string) => setFormats(formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f]);

  const copyPath = (filePath?: string) => {
    if (!filePath) return;
    navigator.clipboard.writeText(filePath);
    setMsg(lang === "ru" ? "Полный путь к файлу скопирован в буфер обмена!" : "File path copied to clipboard!");
    setTimeout(() => setMsg(""), 3000);
  };

  const selectPreset = (presetFormats: string[]) => {
    setFormats(Array.from(new Set([...formats, ...presetFormats])));
  };

  const nlePresets: NlePreset[] = [
    {
      id: "premiere",
      name: "Adobe Premiere Pro",
      software: "Premiere Pro / DaVinci Resolve",
      icon: "film",
      badge: "XML (xmeml v5)",
      desc: lang === "ru"
        ? "Стандартный проект Final Cut Pro 7 XML. Импортируется в Premiere через Файл > Импорт. Сохраняет дорожки, склейки и привязку видеофайла."
        : "Final Cut Pro 7 XML timeline. Opens in Premiere Pro via File > Import. Preserves cuts, tracks, and source media.",
      formats: ["premiere"],
    },
    {
      id: "davinci",
      name: "DaVinci Resolve",
      software: "DaVinci Resolve 17/18/19",
      icon: "scissors",
      badge: "FCPXML + Markers",
      desc: lang === "ru"
        ? "FCPXML 1.9 и CSV маркеры таймлайна (зелёные для речи, красные для пауз) для быстрой сверки в Resolve."
        : "FCPXML 1.9 timeline + CSV marker list (green for speech, red for cuts) for visual inspection in Resolve.",
      formats: ["fcpxml", "davinci_markers"],
    },
    {
      id: "fcpx",
      name: "Final Cut Pro X",
      software: "Apple Final Cut Pro",
      icon: "film",
      badge: "FCPXML 1.9",
      desc: lang === "ru"
        ? "Родной формат FCPXML для Final Cut Pro X со структурированным spine и медиа-ссылками."
        : "Native FCPXML format for Final Cut Pro with spine clips and media references.",
      formats: ["fcpxml"],
    },
    {
      id: "otio",
      name: "OpenTimelineIO",
      software: "Универсальный стандарт",
      icon: "film",
      badge: ".otio",
      desc: lang === "ru"
        ? "Открытый JSON формат обмена таймлайнами, поддерживаемый современными киностудиями и редакторами."
        : "Open-source interchange format supported across modern production pipelines.",
      formats: ["otio"],
    },
    {
      id: "edl",
      name: "Kdenlive / Avid / Vegas",
      software: "CMX3600 EDL",
      icon: "file",
      badge: ".edl",
      desc: lang === "ru"
        ? "Классический текстовый список решений монтажа (CMX 3600 NDF) для Kdenlive, Vegas Pro и других программ."
        : "Standard CMX 3600 edit decision list for Kdenlive, Vegas Pro, Avid.",
      formats: ["edl"],
    },
    {
      id: "chapters",
      name: "YouTube Chapters & Audio",
      software: "YouTube / Audacity",
      icon: "captions",
      badge: "TXT / Labels",
      desc: lang === "ru"
        ? "Список глав с таймкодами для описания на YouTube и дорожка меток для Audacity / Reaper."
        : "Formatted video chapters for YouTube and label tracks for Audacity and Reaper.",
      formats: ["chapters", "audacity"],
    },
  ];

  const subOptions: [string, string][] = [
    ["srt", lang === "ru" ? "Субтитры SRT (и перевод, если есть)" : "SRT Subtitles (and translation)"],
    ["vtt", lang === "ru" ? "Субтитры WebVTT (.vtt для веб-плееров)" : "WebVTT Subtitles (.vtt for web)"],
    ["ass", lang === "ru" ? "Субтитры ASS (стилизованные)" : "Styled ASS Subtitles"],
    ["bilingual_srt", lang === "ru" ? "Двуязычные субтитры SRT (оригинал + перевод)" : "Bilingual SRT (original + translation)"],
    ["transcript", lang === "ru" ? "Текстовая расшифровка с таймкодами (.txt)" : "Text transcript with timestamps (.txt)"],
    ["plan", lang === "ru" ? "Монтажный план JSON (edit_plan.json)" : "Edit plan JSON (edit_plan.json)"],
    ["info", lang === "ru" ? "Технические данные файла (source_info.json)" : "Technical file info (source_info.json)"],
    ["v3", lang === "ru" ? "Auto-Editor .v3 проект" : "Auto-Editor .v3 project"],
  ];

  const hasOut = files.some((f) => f.name.endsWith(".mp4"));

  return (
    <div className="grid2">
      <div className="stack">
        {/* Карточка рендера готового видео */}
        <section className="card">
          <div className="card-title">
            <span className="num"><Icon name="film" /></span>
            <h2>{t("export.render_mp4")}</h2>
          </div>
          <p className="muted">
            {lang === "ru"
              ? `Итоговая длительность: ${fmtTime(payload.stats.output_ms, false)} из ${fmtTime(payload.stats.source_ms, false)}.`
              : `Result duration: ${fmtTime(payload.stats.output_ms, false)} of ${fmtTime(payload.stats.source_ms, false)}.`}
            {payload.stats.unreviewed > 0 && (
              <span className="badge warn" style={{ marginLeft: 8 }}>
                {t("editor.stats.unreviewed")}: {payload.stats.unreviewed}
              </span>
            )}
          </p>

          <div className="row wrap">
            <button className="primary big" onClick={() => render("final")} disabled={busy}>
              <Icon name="film" /> {t("export.btn_render_final")}
            </button>
            <button className="big" onClick={() => render("fast")} disabled={busy} title="480p preview render">
              {t("export.btn_render_fast")}
            </button>
          </div>

          {error && <p className="error">{error}</p>}
          {msg && <p className="ok">{msg}</p>}

          <details className="more">
            <summary>{lang === "ru" ? "Параметры видео и кодирования" : "Render & Encoding Settings"}</summary>
            <label>
              {lang === "ru" ? "Шаблон оформления" : "Visual Template"}
              <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                {templates.map((tItem) => <option key={tItem.id} value={tItem.id}>{tItem.name}</option>)}
              </select>
            </label>
            <p className="muted small">{templates.find((tItem) => tItem.id === template)?.description}</p>

            <label>
              {lang === "ru" ? "Аппаратное кодирование" : "Hardware Encoder"}
              <select value={encoder} onChange={(e) => setEncoder(e.target.value)}>
                <option value="libx264">{lang === "ru" ? "Процессор (libx264) — максимальное качество" : "CPU (libx264) — standard quality"}</option>
                <option value="auto">{lang === "ru" ? "Видеокарта (NVIDIA NVENC / Intel QSV / AMD AMF) с авто-возвратом" : "GPU (NVENC / QSV / AMF) with CPU fallback"}</option>
              </select>
            </label>

            <label>
              {lang === "ru" ? "Движок рендеринга" : "Render Engine"}
              <select value={engine} onChange={(e) => { setEngine(e.target.value); if (e.target.value === "auto-editor") setBurn(false); }}>
                <option value="ffmpeg">FFmpeg — шаблоны, субтитры, нормализация звука</option>
                <option value="auto-editor" disabled={!aeOk}>Auto-Editor{aeOk ? "" : " (не установлен)"}</option>
              </select>
            </label>

            <label className="check">
              <input type="checkbox" checked={burn} disabled={!project.has_subtitles || engine === "auto-editor"} onChange={(e) => setBurn(e.target.checked)} />
              {lang === "ru" ? "Вшить субтитры в видеоряд (Hardsub)" : "Burn subtitles into video (Hardsub)"}
            </label>
            <label className="check">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              {lang === "ru" ? "Перезаписывать существующие файлы" : "Overwrite existing files"}
            </label>
          </details>
        </section>

        {/* Экспортированные файлы */}
        <section className="card">
          <div className="card-title">
            <span className="num"><Icon name="download" /></span>
            <h2>{t("export.files_title")}</h2>
          </div>
          {files.length === 0 ? (
            <p className="muted">{lang === "ru" ? "Пока ничего не экспортировано. Сгенерируйте проекты или видео выше." : "No files yet. Export a project or render video above."}</p>
          ) : (
            <ul className="list">
              {files.map((f) => (
                <li key={f.where + f.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px" }}>
                  <Icon name={f.name.endsWith(".mp4") ? "film" : f.name.endsWith(".xml") || f.name.endsWith(".fcpxml") ? "scissors" : "file"} />
                  <span style={{ fontWeight: 600, wordBreak: "break-all" }} className="grow">{f.name}</span>
                  <span className="badge">{f.where}</span>
                  <span className="muted small">{fmtSize(f.size)}</span>
                  <div className="row" style={{ gap: 6 }}>
                    {f.path && (
                      <button
                        className="ghost small"
                        onClick={() => copyPath(f.path)}
                        title={lang === "ru" ? "Копировать полный путь к файлу на диске" : "Copy full file path on disk"}
                      >
                        {lang === "ru" ? "Путь" : "Path"}
                      </button>
                    )}
                    <a
                      className="btn primary small"
                      href={`/api/projects/${pid}/exports/${encodeURIComponent(f.name)}`}
                      download
                      title={lang === "ru" ? "Скачать файл" : "Download file"}
                    >
                      <Icon name="download" /> {lang === "ru" ? "Скачать" : "Download"}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hasOut && (
            <p className="muted small">
              {lang === "ru"
                ? "Нажмите на файл, чтобы скачать его. Все файлы также находятся в папке проекта (exports)."
                : "Click on any file to download. Files are also stored in the project's 'exports' directory."}
            </p>
          )}
        </section>
      </div>

      <div className="stack">
        {/* Экспорт проекта во внешние монтажные программы */}
        <section className="card">
          <div className="card-title">
            <span className="num"><Icon name="scissors" /></span>
            <h2>{t("export.nle_section")}</h2>
          </div>
          <p className="muted small">
            {lang === "ru"
              ? "Перенесите монтаж в профессиональный видеоредактор без перекодирования исходного видео."
              : "Send your cuts into a professional NLE without re-encoding original video."}
          </p>

          <div className="nle-grid" data-tour="nle-presets">
            {nlePresets.map((preset) => {
              const active = preset.formats.every((f) => formats.includes(f));
              return (
                <div
                  key={preset.id}
                  className={`nle-card ${active ? "selected" : ""}`}
                  onClick={() => selectPreset(preset.formats)}
                >
                  <div className="nle-head">
                    <Icon name={preset.icon} />
                    <b>{preset.name}</b>
                    <span className="badge accent" style={{ marginLeft: "auto" }}>{preset.badge}</span>
                  </div>
                  <p className="muted small" style={{ margin: 0 }}>{preset.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Инструкция по импорту файлов в NLE */}
          <div className="nle-help-box">
            <b style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
              <Icon name="lightbulb" style={{ color: "var(--accent)" }} />
              {t("export.nle_help.title")}
            </b>
            <div className="nle-help-grid">
              <div className="nle-help-item">
                <b>Adobe Premiere Pro</b>
                <p>{t("export.nle_help.premiere")}</p>
              </div>
              <div className="nle-help-item">
                <b>DaVinci Resolve</b>
                <p>{t("export.nle_help.davinci")}</p>
              </div>
              <div className="nle-help-item">
                <b>Final Cut Pro X</b>
                <p>{t("export.nle_help.fcpx")}</p>
              </div>
            </div>
          </div>

          <details className="more" style={{ marginTop: 8 }}>
            <summary>{lang === "ru" ? "Выбрать отдельные форматы для экспорта" : "Customize Export Formats"}</summary>
            {subOptions.map(([k, desc]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={formats.includes(k)} onChange={() => toggle(k)} />
                <span><b>{k.toUpperCase()}</b>: {desc}</span>
              </label>
            ))}
          </details>

          <div className="row wrap" style={{ marginTop: 8 }}>
            <button
              className="primary big"
              disabled={!formats.length}
              onClick={() => guard(async () => {
                const r = await api.post<{ written: string[] }>(`/api/projects/${pid}/export`, { formats, overwrite });
                setMsg(lang === "ru" ? `Успешно экспортировано: ${r.written.join(", ")}` : `Successfully exported: ${r.written.join(", ")}`);
              })}
            >
              <Icon name="download" /> {t("export.btn_export_nle")} ({formats.length})
            </button>
            <button className="ghost" onClick={() => setFormats(["premiere", "fcpxml", "davinci_markers", "edl", "otio", "chapters", "srt", "vtt", "ass", "bilingual_srt", "transcript", "plan", "info"])}>
              {lang === "ru" ? "Выбрать всё" : "Select All"}
            </button>
          </div>
        </section>

        {/* Версии монтажа */}
        <section className="card">
          <div className="card-title">
            <span className="num"><Icon name="folder" /></span>
            <h2>{t("export.versions_title")}</h2>
          </div>
          <div className="row">
            <input
              className="grow"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={lang === "ru" ? "Метка версии (например, 'до правок интро')" : "Version label"}
            />
            <button onClick={() => guard(async () => { await api.post(`/api/projects/${pid}/timeline/versions`, { label }); setLabel(""); })}>
              {t("export.save_version")}
            </button>
          </div>
          {versions.length === 0 ? (
            <p className="muted small">{lang === "ru" ? "Сохранённых версий пока нет. Сохраняйте версии перед крупными изменениями." : "No saved versions yet."}</p>
          ) : (
            <ul className="list">
              {versions.map((v) => (
                <li key={v.name}>
                  <b>{v.name}</b> {v.label}
                  <span className="muted">{v.created && new Date(v.created).toLocaleString(lang === "ru" ? "ru-RU" : "en-US")}</span>
                  <button
                    disabled={busy}
                    onClick={() => confirm(lang === "ru" ? `Восстановить версию ${v.name}?` : `Restore version ${v.name}?`) &&
                      guard(async () => onPayload(await api.post<PlanPayload>(`/api/projects/${pid}/timeline/versions/${v.name}/restore`)),
                        lang === "ru" ? "Версия восстановлена" : "Version restored")}
                  >
                    {lang === "ru" ? "Восстановить" : "Restore"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
