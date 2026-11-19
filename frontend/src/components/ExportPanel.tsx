import { useCallback, useEffect, useState } from "react";
import { api, fmtSize, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import Icon from "./Icon";
import ShowNotesModal from "./ShowNotesModal";
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
  const [denoise, setDenoise] = useState(false);
  const [denoiseLevel, setDenoiseLevel] = useState(12);
  const [aspectRatio, setAspectRatio] = useState("original");
  const [voiceEnhancer, setVoiceEnhancer] = useState("off");
  const [normalize, setNormalize] = useState(true);
  const [targetLufs, setTargetLufs] = useState(-14);
  const [audioOnly, setAudioOnly] = useState(false);
  const [bgmPath, setBgmPath] = useState("");
  const [bgmVolume, setBgmVolume] = useState(0.15);
  const [bgmDucking, setBgmDucking] = useState(true);
  const [wordHighlight, setWordHighlight] = useState(false);
  const [highlightColor, setHighlightColor] = useState("#FFEA00");
  const [lossless, setLossless] = useState(false);
  const [smartReframe, setSmartReframe] = useState(false);
  const [showNotesOpen, setShowNotesOpen] = useState(false);

  interface Chapter { time_ms: number; title: string; source_ms?: number }
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(false);

  const loadChapters = useCallback(() => {
    api.get<{ chapters: Chapter[] }>(`/api/projects/${pid}/chapters`).then((r) => setChapters(r.chapters || [])).catch(() => undefined);
  }, [pid]);

  useEffect(() => { loadChapters(); }, [loadChapters]);

  const generateChapters = async () => {
    setLoadingChapters(true);
    try {
      const res = await api.post<{ chapters: Chapter[]; formatted: string }>(`/api/projects/${pid}/chapters/generate`, {
        min_interval_s: 60,
        lang,
      });
      setChapters(res.chapters || []);
      setMsg(lang === "ru" ? "Умные главы успешно сгенерированы!" : "Smart chapters generated!");
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingChapters(false);
    }
  };

  const copyChapters = () => {
    const formatted = chapters.map((ch) => {
      const s = Math.floor(ch.time_ms / 1000);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      const h = Math.floor(m / 60);
      const min = m % 60;
      const ts = h > 0 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      return `${ts} ${ch.title}`;
    }).join("\n");
    navigator.clipboard.writeText(formatted);
    setMsg(t("chapters.copied"));
    setTimeout(() => setMsg(""), 3000);
  };

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

  const applyPlatformPreset = (preset: "telegram" | "youtube" | "shorts" | "podcast") => {
    if (preset === "telegram") {
      setAspectRatio("original");
      setEncoder("libx264");
      setNormalize(true);
      setTargetLufs(-14);
      setAudioOnly(false);
      setMsg(lang === "ru" ? "Применён пресет Telegram Fast: стандартный кадр, нормализация -14 LUFS" : "Applied Telegram Fast preset");
    } else if (preset === "youtube") {
      setAspectRatio("original");
      setEncoder("libx264");
      setNormalize(true);
      setTargetLufs(-14);
      setVoiceEnhancer("clarity");
      setAudioOnly(false);
      setMsg(lang === "ru" ? "Применён пресет YouTube Master: чёткость речи, нормализация -14 LUFS" : "Applied YouTube Master preset");
    } else if (preset === "shorts") {
      setAspectRatio("9:16_crop");
      setNormalize(true);
      setTargetLufs(-14);
      setAudioOnly(false);
      if (project.has_subtitles) {
        setBurn(true);
        setWordHighlight(true);
      }
      setMsg(lang === "ru" ? "Применён пресет Shorts / Reels: вертикальный кадр 9:16, караоке-субтитры" : "Applied Shorts 9:16 preset");
    } else if (preset === "podcast") {
      setAudioOnly(true);
      setVoiceEnhancer("podcast");
      setNormalize(true);
      setTargetLufs(-16);
      setMsg(lang === "ru" ? "Применён пресет Подкаст: экспорт в MP3 аудио, тёплый голос, нормализация -16 LUFS" : "Applied Podcast MP3 preset");
    }
    setTimeout(() => setMsg(""), 3500);
  };

  const render = (mode: "fast" | "final") => guard(async () => {
    await api.patch(`/api/projects/${pid}`, { settings: { template } });
    onJob(await api.post<Job>(`/api/projects/${pid}/render`, {
      mode, template, burn_subtitles: !lossless && burn && project.has_subtitles, overwrite, engine,
      lossless,
      options: {
        audio_only: audioOnly,
        video: { encoder, aspect_ratio: aspectRatio, smart_reframe: smartReframe },
        audio: {
          denoise: !lossless && denoise, denoise_level: denoiseLevel, voice_enhancer: voiceEnhancer,
          normalize: !lossless && normalize, target_lufs: targetLufs,
          bgm: !lossless && bgmPath.trim() ? { path: bgmPath.trim(), volume: bgmVolume, ducking: bgmDucking } : undefined,
        },
        subtitles: {
          word_highlight: wordHighlight,
          highlight_color: highlightColor,
        },
      },
    }));
  });

  const downloadThumbnail = () => {
    window.open(`/api/projects/${pid}/frame?time_ms=1000&download=true`, "_blank");
  };

  const toggle = (f: string) => setFormats(formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f]);

  const copyPath = (filePath?: string) => {
    if (!filePath) return;
    navigator.clipboard.writeText(filePath);
    setMsg(lang === "ru" ? "Полный путь к файлу скопирован в буфер обмена!" : "File path copied to clipboard!");
    setTimeout(() => setMsg(""), 3000);
  };

  const openFolder = async () => {
    try {
      await api.post(`/api/projects/${pid}/reveal`, { folder: "exports" });
    } catch { /* ignore */ }
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

  const [rtab, setRtab] = useState<"nle" | "extras" | "versions">("nle");
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

          <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <button className="primary big" onClick={() => render("final")} disabled={busy}>
              <Icon name="film" /> {t("export.btn_render_final")}
            </button>
            <button className="big" onClick={() => render("fast")} disabled={busy} title="480p preview render">
              {t("export.btn_render_fast")}
            </button>
            <button
              className="big ghost"
              onClick={() => setShowNotesOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              title={lang === "ru" ? "Сгенерировать шоу-ноуты, описание для YouTube и пост для Telegram" : "Show notes & publishing text"}
            >
              <Icon name="captions" /> {lang === "ru" ? "Шоу-ноуты" : "Show Notes"}
            </button>
          </div>

          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <label className="check" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={lossless} onChange={(e) => setLossless(e.target.checked)} />
              <span style={{ fontWeight: 500, fontSize: 13 }}>
                {lang === "ru" ? "Lossless экспорт (Stream Copy) — мгновенно за 2–3 сек без перекодирования" : "Lossless Export (Stream Copy) — instant 2–3s without re-encoding"}
              </span>
            </label>
          </div>

          {/* Пресеты экспорта в 1 клик */}
          <div style={{ marginTop: 14, marginBottom: 10 }}>
            <span className="muted small" style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
              {lang === "ru" ? "Готовые пресеты для соцсетей и стримингов:" : "1-Click Export Presets:"}
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
              <button
                type="button"
                className="ghost platform-preset-btn"
                onClick={() => applyPlatformPreset("telegram")}
                title="720p, быстрый рендер, малый вес"
              >
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <Icon name="send" />
                  <b>Telegram</b>
                </div>
                <span className="muted small">720p Fast</span>
              </button>
              <button
                type="button"
                className="ghost platform-preset-btn"
                onClick={() => applyPlatformPreset("youtube")}
                title="1080p, нормализация -14 LUFS, фильтр чёткости"
              >
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <Icon name="video" />
                  <b>YouTube</b>
                </div>
                <span className="muted small">1080p Master</span>
              </button>
              <button
                type="button"
                className="ghost platform-preset-btn"
                onClick={() => applyPlatformPreset("shorts")}
                title="9:16 вертикальный кроп, караоке-субтитры"
              >
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <Icon name="smartphone" />
                  <b>Shorts / Reels</b>
                </div>
                <span className="muted small">9:16 + Караоке</span>
              </button>
              <button
                type="button"
                className="ghost platform-preset-btn"
                onClick={() => applyPlatformPreset("podcast")}
                title="Только аудио MP3 192k, -16 LUFS, теплый тембр"
              >
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <Icon name="mic" />
                  <b>Подкаст</b>
                </div>
                <span className="muted small">MP3 Аудио</span>
              </button>
            </div>
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

            <label>
              {lang === "ru" ? "Формат кадра и соотношение сторон" : "Video Format & Aspect Ratio"}
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                <option value="original">{lang === "ru" ? "16:9 Горизонтальный (Оригинал)" : "16:9 Horizontal (Original)"}</option>
                <option value="9:16_crop">{lang === "ru" ? "9:16 Shorts / Reels (Кроп 1080x1920)" : "9:16 Shorts / Reels (1080x1920)"}</option>
                <option value="9:16_pad">{lang === "ru" ? "9:16 Shorts / Reels (С полями 1080x1920)" : "9:16 Shorts / Reels (Padded 1080x1920)"}</option>
              </select>
            </label>
            {aspectRatio === "9:16_crop" && (
              <label className="check" style={{ marginTop: 4, marginBottom: 8 }}>
                <input type="checkbox" checked={smartReframe} onChange={(e) => setSmartReframe(e.target.checked)} />
                <span>{lang === "ru" ? "Умный авто-кроп лица (Smart Reframe) — авто-центрирование спикера" : "Smart Face Reframe — keep speaker centered"}</span>
              </label>
            )}

            <label>
              {lang === "ru" ? "Улучшение голоса (Voice Enhancer)" : "Voice Enhancer Preset"}
              <select value={voiceEnhancer} onChange={(e) => setVoiceEnhancer(e.target.value)}>
                <option value="off">{lang === "ru" ? "Отключено (исходный звук)" : "Off (Original sound)"}</option>
                <option value="podcast">{lang === "ru" ? "Подкаст (НЧ-фильтр и сглаживание <80Гц)" : "Podcast (Warm, rumble filter)"}</option>
                <option value="clarity">{lang === "ru" ? "Чёткость речи (De-esser + присутствие)" : "Clarity (De-esser + presence)"}</option>
                <option value="warmth">{lang === "ru" ? "Тёплый тон голоса (Аналоговый характер)" : "Warmth (Gentle analog tone)"}</option>
                <option value="radio">{lang === "ru" ? "Студийное радио (Компрессия и плотность)" : "Broadcast Radio (Punchy compression)"}</option>
              </select>
            </label>

            <label className="check">
              <input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} />
              <span><b>{lang === "ru" ? "Экспорт только аудио (MP3 подкаст без видеоряда)" : "Audio-only export (MP3 podcast, no video)"}</b></span>
            </label>

            <label className="check">
              <input type="checkbox" checked={burn} disabled={!project.has_subtitles || engine === "auto-editor"} onChange={(e) => setBurn(e.target.checked)} />
              {lang === "ru" ? "Вшить субтитры в видеоряд (Hardsub)" : "Burn subtitles into video (Hardsub)"}
            </label>
            {burn && (
              <div style={{ marginLeft: 24, marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="check">
                  <input type="checkbox" checked={wordHighlight} onChange={(e) => setWordHighlight(e.target.checked)} />
                  <span>{lang === "ru" ? "Пословная подсветка караоке" : "Word-by-word active karaoke highlight"}</span>
                </label>
                {wordHighlight && (
                  <div className="row" style={{ gap: 10, alignItems: "center" }}>
                    <span className="muted small">{lang === "ru" ? "Цвет подсветки:" : "Highlight color:"}</span>
                    <input type="color" value={highlightColor} onChange={(e) => setHighlightColor(e.target.value)} style={{ width: 36, height: 24, padding: 0, border: "none", cursor: "pointer" }} />
                    <span className="muted small">{highlightColor}</span>
                  </div>
                )}
                {(() => {
                  const curTemplate = templates.find((tItem) => tItem.id === template);
                  const subStyle = curTemplate?.subtitles || {};
                  return (
                    <div style={{
                      marginTop: 6,
                      padding: "12px 14px",
                      background: "var(--bg-canvas, #09090b)",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="muted small" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>
                          {lang === "ru" ? "Предпросмотр стиля субтитров" : "Live Subtitle Preview"}
                        </span>
                        <span className="muted small" style={{ fontSize: 11 }}>
                          {subStyle.font || "Impact"} · {subStyle.size || 72}pt
                        </span>
                      </div>
                      <div style={{
                        minHeight: 64,
                        background: "radial-gradient(ellipse at center, rgba(39, 39, 42, 0.6) 0%, rgba(9, 9, 11, 0.95) 100%)",
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "8px 14px",
                        border: "1px dashed rgba(255, 255, 255, 0.12)",
                        textAlign: "center",
                        userSelect: "none",
                      }}>
                        <span style={{
                          fontFamily: subStyle.font ? `"${subStyle.font}", Impact, sans-serif` : "Impact, sans-serif",
                          fontSize: 18,
                          fontWeight: subStyle.bold !== 0 ? 800 : 500,
                          color: subStyle.colour || "#FFFFFF",
                          textShadow: subStyle.outline ? `
                            -${subStyle.outline}px -${subStyle.outline}px 0 ${subStyle.outline_colour || "#000"},
                             ${subStyle.outline}px -${subStyle.outline}px 0 ${subStyle.outline_colour || "#000"},
                            -${subStyle.outline}px  ${subStyle.outline}px 0 ${subStyle.outline_colour || "#000"},
                             ${subStyle.outline}px  ${subStyle.outline}px 0 ${subStyle.outline_colour || "#000"},
                             0 ${subStyle.shadow || 2}px 4px rgba(0,0,0,0.8)
                          ` : "0 2px 4px rgba(0,0,0,0.8)",
                          letterSpacing: "0.02em",
                          lineHeight: 1.25,
                        }}>
                          {lang === "ru" ? "Синхронизация речи и " : "Synchronized speech with "}
                          <span style={{
                            color: wordHighlight ? highlightColor : (subStyle.colour || "#FFFFFF"),
                            textDecoration: wordHighlight ? "underline" : "none",
                            textUnderlineOffset: "3px",
                          }}>
                            {lang === "ru" ? "активного слова" : "active word"}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
              <span><b>{lang === "ru" ? "Нормализация громкости (EBU R128 / LUFS)" : "Loudness Normalization (EBU R128 / LUFS)"}</b></span>
            </label>
            {normalize && (
              <div className="row" style={{ marginLeft: 24, gap: 12 }}>
                <span className="muted small">{lang === "ru" ? "Целевой стандарт:" : "Target Standard:"}</span>
                <select value={targetLufs} onChange={(e) => setTargetLufs(Number(e.target.value))}>
                  <option value={-14}>-14 LUFS (YouTube, Shorts, TikTok, Reels)</option>
                  <option value={-16}>-16 LUFS (Подкасты, Spotify, Apple Podcasts)</option>
                  <option value={-23}>-23 LUFS (ТВ / Европейский стандарт EBU R128)</option>
                </select>
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={denoise} onChange={(e) => setDenoise(e.target.checked)} />
              <span><b>{t("audio.denoise")}</b></span>
            </label>
            {denoise && (
              <div className="row" style={{ marginLeft: 24, gap: 12 }}>
                <span className="muted small">{t("audio.denoise_level")}:</span>
                <select value={denoiseLevel} onChange={(e) => setDenoiseLevel(Number(e.target.value))}>
                  <option value={6}>{t("audio.denoise.soft")}</option>
                  <option value={12}>{t("audio.denoise.std")}</option>
                  <option value={18}>{t("audio.denoise.strong")}</option>
                </select>
              </div>
            )}

            {/* Фоновая музыка и Auto-Ducking */}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 12 }}>
              <label style={{ fontWeight: 600 }}>
                {lang === "ru" ? "Фоновая музыка (BGM)" : "Background Music (BGM)"}
                <input
                  type="text"
                  value={bgmPath}
                  onChange={(e) => setBgmPath(e.target.value)}
                  placeholder={lang === "ru" ? "Полный путь к аудиофайлу (например, C:\\music\\track.mp3)" : "Full path to audio file (e.g. C:\\music\\track.mp3)"}
                  style={{ marginTop: 4 }}
                />
              </label>
              {bgmPath && (
                <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--panel2)", borderRadius: 6, border: "1px solid var(--line)" }}>
                  <label>
                    {lang === "ru" ? `Громкость музыки: ${Math.round(bgmVolume * 100)}%` : `Music volume: ${Math.round(bgmVolume * 100)}%`}
                    <input type="range" min="0.02" max="0.5" step="0.01" value={bgmVolume} onChange={(e) => setBgmVolume(Number(e.target.value))} />
                  </label>
                  <label className="check" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={bgmDucking} onChange={(e) => setBgmDucking(e.target.checked)} />
                    <span><b>{lang === "ru" ? "Умное авто-приглушение речи (Auto-Ducking Sidechain)" : "Speech Auto-Ducking (Sidechain)"}</b></span>
                  </label>
                  <p className="muted small" style={{ margin: "4px 0 0 24px" }}>
                    {lang === "ru"
                      ? "Музыка динамически приглушается во время речи спикера и возвращается в паузах."
                      : "Music volume ducks when speech is active and returns to full volume during pauses."}
                  </p>
                </div>
              )}
            </div>
            <label className="check">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              {lang === "ru" ? "Перезаписывать существующие файлы" : "Overwrite existing files"}
            </label>
          </details>
        </section>

        {/* Экспортированные файлы */}
        <section className="card">
          <div className="card-title" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div className="row">
              <span className="num"><Icon name="download" /></span>
              <h2>{t("export.files_title")}</h2>
            </div>
            <button className="ghost small" onClick={openFolder} title={lang === "ru" ? "Открыть папку экспорта на компьютере" : "Open exports folder on computer"}>
              <Icon name="folder" /> {lang === "ru" ? "Открыть в папке" : "Open in Folder"}
            </button>
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
        <div className="ptabs" role="tablist">
          {([["nle", "Монтажные программы"], ["extras", "Главы и обложка"], ["versions", "Версии монтажа"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={rtab === k} className={rtab === k ? "active" : ""} onClick={() => setRtab(k)}>{label}</button>
          ))}
        </div>
        {rtab === "nle" && (<>
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

        </>)}
        {rtab === "extras" && (<>
        {/* Умные главы (YouTube Chapters) */}
        <section className="card">
          <div className="card-title" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div className="row">
              <span className="num"><Icon name="captions" /></span>
              <h2>{t("chapters.title")}</h2>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="primary small" onClick={generateChapters} disabled={loadingChapters || busy} title="Сгенерировать смысловые главы по тексту и паузам">
                <Icon name="sparkles" /> {loadingChapters ? t("common.loading") : t("chapters.generate")}
              </button>
              {chapters.length > 0 && (
                <button className="ghost small" onClick={copyChapters} title={t("chapters.copy_desc")}>
                  <Icon name="file" /> {t("chapters.copy_desc")}
                </button>
              )}
            </div>
          </div>
          <p className="muted small">{t("chapters.hint")}</p>

          {chapters.length > 0 && (
            <ul className="list" style={{ maxHeight: 220, overflow: "auto" }}>
              {chapters.map((ch, idx) => {
                const s = Math.floor(ch.time_ms / 1000);
                const m = Math.floor(s / 60);
                const sec = s % 60;
                const h = Math.floor(m / 60);
                const min = m % 60;
                const ts = h > 0 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
                return (
                  <li key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px" }}>
                    <code style={{ minWidth: 65, color: "var(--accent)", fontWeight: 700 }}>{ts}</code>
                    <input
                      className="grow"
                      value={ch.title}
                      onChange={(e) => {
                        const updated = [...chapters];
                        updated[idx] = { ...updated[idx], title: e.target.value };
                        setChapters(updated);
                        api.put(`/api/projects/${pid}/chapters`, { chapters: updated }).catch(() => undefined);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Стоп-кадр / Обложка */}
        <section className="card">
          <div className="card-title" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div className="row">
              <span className="num"><Icon name="image" /></span>
              <h2>{lang === "ru" ? "Обложка видео (Стоп-кадр)" : "Video Thumbnail (Cover Art)"}</h2>
            </div>
            <button className="primary small" onClick={downloadThumbnail}>
              <Icon name="download" /> {lang === "ru" ? "Скачать стоп-кадр (HD)" : "Download HD Frame"}
            </button>
          </div>
          <p className="muted small">
            {lang === "ru"
              ? "Захват кадра в оригинальном качестве без пережатия для превью на YouTube или в соцсетях."
              : "Capture full-resolution video frame for YouTube or social media cover art."}
          </p>
          <div style={{ marginTop: 8, display: "flex", gap: 16, alignItems: "center" }}>
            <img
              src={`/api/projects/${pid}/frame?time_ms=1000`}
              alt="Thumbnail preview"
              style={{ width: 160, height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }}
            />
            <div className="small muted">
              {lang === "ru"
                ? "Вы также можете сохранить любой конкретный момент прямо в окне Монтажа кнопкой «Стоп-кадр»."
                : "You can also capture any specific moment directly in the Editor timeline."}
            </div>
          </div>
        </section>
        </>)}
        {rtab === "versions" && (<>
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
        </>)}
      </div>

      {showNotesOpen && <ShowNotesModal pid={pid} onClose={() => setShowNotesOpen(false)} />}
    </div>
  );
}
