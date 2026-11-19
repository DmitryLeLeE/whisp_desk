import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import type { Cue, FillerWordItem, Job, PlanPayload, Project, WhispModels } from "../types";
import Icon from "./Icon";
import ModelCards from "./ModelCards";

interface SubtitlesResponse {
  cues: Cue[];
  translations: Record<string, Cue[]>;
}

export default function SubtitlesPanel({ pid, project: _project, cues, busy, onJob, onChanged, onJump, payload, onPayload }: {
  pid: string; project?: Project; cues: Cue[]; busy: boolean; onJob: (j: Job) => void; onChanged: () => void; onJump: (ms: number) => void;
  payload?: PlanPayload | null; onPayload?: (p: PlanPayload) => void;
}) {
  const { t, lang } = useTranslation();
  const [wm, setWm] = useState<WhispModels | null>(null);
  const [q, setQ] = useState("");
  const [model, setModel] = useState("");
  const [language, setLanguage] = useState("ru");
  const [device, setDevice] = useState("auto");
  const [translateTo, setTranslateTo] = useState("");
  const [toEnglish, setToEnglish] = useState(false);
  const [lineChars, setLineChars] = useState(0);
  const [vad, setVad] = useState(true);
  const [initialPrompt, setInitialPrompt] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);

  // Переводы и вкладки отображения
  const [translations, setTranslations] = useState<Record<string, Cue[]>>({});
  const [viewMode, setViewMode] = useState<"orig" | "trans" | "bilingual">("orig");
  const [selectedTransLang, setSelectedTransLang] = useState<string>("en");

  // Редактирование реплики
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  // Найти и заменить
  const [showReplace, setShowReplace] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");

  // Быстрый перевод
  const [quickTargetLang, setQuickTargetLang] = useState("en");

  // Слова-паразиты
  const [showFillers, setShowFillers] = useState(false);
  const [fillerMatches, setFillerMatches] = useState<FillerWordItem[]>([]);
  const [cleaningFillers, setCleaningFillers] = useState(false);

  const loadFillers = useCallback(() => {
    api.get<{ matches: FillerWordItem[]; count: number }>(`/api/projects/${pid}/filler-words`)
      .then((d) => setFillerMatches(d.matches || []))
      .catch(() => undefined);
  }, [pid]);

  useEffect(() => {
    if (cues.length > 0) loadFillers();
  }, [cues, loadFillers]);

  const cleanAllFillers = async () => {
    if (fillerMatches.length === 0) return;
    if (!confirm(lang === "ru" ? `Вырезать все ${fillerMatches.length} слов-паразитов из видео?` : `Cut all ${fillerMatches.length} filler words from video?`)) return;
    setCleaningFillers(true);
    try {
      const res = await api.post<PlanPayload & { cleaned_count: number }>(`/api/projects/${pid}/filler-words/clean`, {});
      if (onPayload && res.plan) onPayload(res);
      setMsg(lang === "ru" ? `Успешно вырезано ${res.cleaned_count} слов-паразитов!` : `Successfully cut ${res.cleaned_count} filler words!`);
      setTimeout(() => setMsg(""), 3500);
      loadFillers();
      setShowFillers(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCleaningFillers(false);
    }
  };

  const isCueCut = (startMs: number, endMs: number): boolean => {
    if (!payload?.plan?.segments) return false;
    const mid = (startMs + endMs) / 2;
    const seg = payload.plan.segments.find((s) => s.source_start_ms <= mid && s.source_end_ms > mid);
    return seg?.action === "CUT";
  };

  const toggleCutCue = async (startMs: number, endMs: number, cut: boolean) => {
    if (!onPayload) return;
    try {
      const res = await api.post<PlanPayload>(`/api/projects/${pid}/timeline/ops`, {
        op: "set_range",
        start_ms: startMs,
        end_ms: endMs,
        action: cut ? "CUT" : "KEEP",
        reason: "text_edit",
      });
      onPayload(res);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const loadModels = useCallback(() => api.get<WhispModels>("/api/whisp/models").then((d) => {
    setWm(d);
    setModel((cur) => cur || d.models.find((m) => m.name === "turbo" && m.downloaded)?.name || d.models.find((m) => m.downloaded)?.name || "turbo");
  }).catch((e) => setError(e.message)), []);

  const loadSubtitlesData = useCallback(() => {
    api.get<SubtitlesResponse>(`/api/projects/${pid}/subtitles`).then((data) => {
      setTranslations(data.translations || {});
      const trKeys = Object.keys(data.translations || {});
      if (trKeys.length > 0 && !trKeys.includes(selectedTransLang)) {
        setSelectedTransLang(trKeys[0]);
      }
    }).catch(() => undefined);
  }, [pid, selectedTransLang]);

  useEffect(() => { loadModels(); }, [loadModels]);
  useEffect(() => { loadSubtitlesData(); }, [loadSubtitlesData, busy]);

  useEffect(() => {
    if (!wm?.models.some((m) => m.download?.state === "running")) return;
    const interval = setInterval(loadModels, 1000);
    return () => clearInterval(interval);
  }, [wm, loadModels]);

  const transLangs = Object.keys(translations);
  const activeTransCues = translations[selectedTransLang] || [];

  // Список реплик в зависимости от режима просмотра
  const displayCues = useMemo(() => {
    if (viewMode === "trans" && activeTransCues.length > 0) {
      return activeTransCues;
    }
    return cues;
  }, [viewMode, activeTransCues, cues]);

  const found = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return displayCues.slice(0, 500);
    return displayCues.filter((c, i) => {
      const matchSelf = c.text.toLowerCase().includes(n);
      const matchOther = activeTransCues[i]?.text?.toLowerCase().includes(n) || cues[i]?.text?.toLowerCase().includes(n);
      return matchSelf || matchOther;
    }).slice(0, 500);
  }, [q, displayCues, activeTransCues, cues]);

  const importFile = async (f: File) => {
    setError(""); setMsg("");
    if (cues.length && !confirm(lang === "ru" ? "Расшифровка уже загружена. Заменить?" : "Subtitles already loaded. Replace?")) return;
    try {
      const r = await api.upload<{ cues: number }>(`/api/projects/${pid}/subtitles/import`, f);
      setMsg(lang === "ru" ? `Загружено реплик: ${r.cues}` : `Imported ${r.cues} cues`);
      onChanged();
      loadSubtitlesData();
    } catch (e) { setError((e as Error).message); }
  };

  const transcribe = async () => {
    setError(""); setMsg("");
    if (cues.length && !confirm(lang === "ru" ? "Расшифровка уже есть. Заменить новой?" : "Subtitles already exist. Replace?")) return;
    try {
      onJob(await api.post<Job>(`/api/projects/${pid}/subtitles/transcribe`, {
        model, language, device, overwrite: cues.length > 0, translate_to: translateTo, task: toEnglish ? "translate" : "transcribe",
        max_line_chars: lineChars, vad, initial_prompt: initialPrompt,
      }));
    } catch (e) { setError((e as Error).message); }
  };

  const translateSubtitles = async () => {
    setError(""); setMsg("");
    try {
      onJob(await api.post<Job>(`/api/projects/${pid}/subtitles/translate`, {
        target_lang: quickTargetLang,
        device,
      }));
      setMsg(lang === "ru" ? `Запущен перевод на ${quickTargetLang}...` : `Translation to ${quickTargetLang} started...`);
    } catch (e) { setError((e as Error).message); }
  };

  const startEdit = (idx: number, text: string) => {
    setEditingIdx(idx);
    setEditingText(text);
  };

  const saveEdit = async (idx: number) => {
    if (editingIdx === null) return;
    const targetCues = viewMode === "trans" ? [...activeTransCues] : [...cues];
    if (targetCues[idx]) {
      targetCues[idx] = { ...targetCues[idx], text: editingText };
    }
    setEditingIdx(null);
    try {
      await api.put(`/api/projects/${pid}/subtitles`, {
        cues: targetCues,
        lang: viewMode === "trans" ? selectedTransLang : "original",
      });
      loadSubtitlesData();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const replaceAll = async () => {
    if (!findText) return;
    setError(""); setMsg("");
    try {
      let count = 0;
      const targetCues = (viewMode === "trans" ? activeTransCues : cues).map((c) => {
        if (c.text.includes(findText)) {
          count += c.text.split(findText).length - 1;
          return { ...c, text: c.text.split(findText).join(replaceText) };
        }
        return c;
      });
      if (count === 0) {
        setMsg(lang === "ru" ? "Совпадений не найдено" : "No matches found");
        return;
      }
      await api.put(`/api/projects/${pid}/subtitles`, {
        cues: targetCues,
        lang: viewMode === "trans" ? selectedTransLang : "original",
      });
      setMsg(lang === "ru" ? `Заменено вхождений: ${count}` : `Replaced ${count} occurrences`);
      setFindText("");
      setReplaceText("");
      setShowReplace(false);
      loadSubtitlesData();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const chosen = wm?.models.find((m) => m.name === model);
  const whispOk = wm?.info.available ?? true;
  const langs = wm ? Object.entries(wm.languages).filter(([k]) => k !== "auto") : [];

  return (
    <div className="grid2">
      <div className="stack">
        {/* Whisp распознавание речи */}
        <section className="card">
          <div className="card-title">
            <span className="num"><Icon name="mic" /></span>
            <h2>{t("subs.whisp_title")}</h2>
          </div>

          {!whispOk && (
            <div className="notice warn">
              <Icon name="alert" /> Whisp недоступен в этой копии программы. Импортируйте готовые субтитры ниже.
            </div>
          )}

          <p className="muted small">
            {lang === "ru"
              ? "Нейросетевое распознавание речи на компьютере без интернета. Модель turbo рекомендуется для баланса скорости и точности."
              : "On-device AI speech transcription. Turbo model is recommended for high accuracy and speed."}
          </p>

          {wm && <ModelCards models={wm.models} selected={model} onSelect={setModel} onChanged={loadModels} onError={setError} />}

          <div className="fields">
            <label>
              {lang === "ru" ? "Язык исходной речи" : "Spoken Language"}
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="auto">{lang === "ru" ? "Определить автоматически" : "Auto detect"}</option>
                {langs.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>
              {lang === "ru" ? "Устройство" : "Compute Device"}
              <select value={device} onChange={(e) => setDevice(e.target.value)}>
                <option value="auto">{lang === "ru" ? "Авто (NVIDIA GPU / CPU)" : "Auto (NVIDIA GPU / CPU)"}</option>
                <option value="cpu">CPU</option>
                <option value="cuda">NVIDIA GPU (CUDA)</option>
              </select>
            </label>
          </div>

          <details className="more">
            <summary>{lang === "ru" ? "Параметры перевода и форматирования" : "Translation & Formatting Options"}</summary>
            <div className="fields">
              <label>
                {lang === "ru" ? "Символов в строке (0 — авто)" : "Max characters per line"}
                <input type="number" min={0} max={120} value={lineChars} onChange={(e) => setLineChars(Math.max(0, Number(e.target.value)))} />
              </label>
              <label>
                {lang === "ru" ? "Сразу перевести на язык (NLLB-200)" : "Translate to language (NLLB-200)"}
                <select value={translateTo} onChange={(e) => { setTranslateTo(e.target.value); if (e.target.value) setToEnglish(false); }}>
                  <option value="">{lang === "ru" ? "Не переводить" : "Do not translate"}</option>
                  {langs.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={vad} onChange={(e) => setVad(e.target.checked)} />
              {lang === "ru" ? "Фильтр VAD (пропуск пауз и тишины при распознавании)" : "VAD speech filter (suppress background silence)"}
            </label>
            <label className="check">
              <input type="checkbox" checked={toEnglish} disabled={!!translateTo} onChange={(e) => setToEnglish(e.target.checked)} />
              {lang === "ru" ? "Переводить сразу на английский средствами Whisper" : "Direct translate to English via Whisper"}
            </label>
            <div style={{ marginTop: 10 }}>
              <label>
                {lang === "ru" ? "Словарь терминов и имён (Initial Prompt)" : "Custom Vocabulary & Terms (Initial Prompt)"}
                <input
                  type="text"
                  placeholder={lang === "ru" ? "Whisp, DaVinci, Premiere Pro, FastAPI, FFmpeg, редкие термины..." : "Whisp, DaVinci, Premiere Pro, FastAPI, names, acronyms..."}
                  value={initialPrompt}
                  onChange={(e) => setInitialPrompt(e.target.value)}
                  style={{ width: "100%", marginTop: 4 }}
                />
              </label>
              <span className="small muted" style={{ display: "block", marginTop: 3 }}>
                {lang === "ru"
                  ? "Задайте через запятую сложные слова, бренды и имена: Whisper использует их как контекст и пишет без ошибок."
                  : "Comma-separated technical terms, names, and brands to guide the AI decoder."}
              </span>
            </div>
          </details>

          <div className="row wrap">
            <button className="primary big" onClick={transcribe} disabled={busy || !whispOk || !model}>
              <Icon name="mic" /> {t("subs.btn.transcribe")}
            </button>
            {chosen && chosen.downloaded === false && (
              <span className="muted small">
                {lang === "ru" ? `Модель «${chosen.name}» скачается автоматически.` : `Model "${chosen.name}" will be downloaded first.`}
              </span>
            )}
          </div>
        </section>

        {/* Быстрый перевод готовых субтитров и импорт */}
        <section className="card">
          <div className="card-title">
            <span className="num"><Icon name="globe" /></span>
            <h2>{lang === "ru" ? "Перевод и импорт файлов" : "Translation & File Import"}</h2>
          </div>

          {cues.length > 0 && (
            <div className="col" style={{ padding: "12px 14px", background: "var(--panel2)", borderRadius: 10, border: "1px solid var(--line)" }}>
              <b>{lang === "ru" ? "Машинный перевод имеющихся субтитров" : "Translate Current Subtitles"}</b>
              <p className="muted small">
                {lang === "ru"
                  ? "Переводит текст реплик без повторной долгой обработки звука."
                  : "Translates subtitle cues directly without re-processing audio."}
              </p>
              <div className="row wrap">
                <select value={quickTargetLang} onChange={(e) => setQuickTargetLang(e.target.value)} style={{ minWidth: 160 }}>
                  {langs.map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
                </select>
                <button onClick={translateSubtitles} disabled={busy || !whispOk}>
                  <Icon name="globe" /> {t("subs.btn.translate_only")}
                </button>
              </div>
            </div>
          )}

          <div className="row wrap" style={{ marginTop: 4 }}>
            <input ref={file} type="file" accept=".srt,.vtt,.ass,.ssa,.txt,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
            <button onClick={() => file.current?.click()}>
              <Icon name="file" /> {t("subs.import_btn")}
            </button>
            <span className="muted small">SRT, VTT, ASS, TXT, JSON</span>
          </div>

          <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--panel2)", borderRadius: 8, border: "1px solid var(--line)" }}>
            <span className="small muted" style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>
              {lang === "ru" ? "Стили оформления субтитров для рендера (Hardsub):" : "Hardsub Style Presets:"}
            </span>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="badge" style={{ background: "#FFEA00", color: "#000", fontWeight: 800, border: "1px solid #eab308" }}>
                🔥 MrBeast Viral
              </span>
              <span className="badge" style={{ background: "rgba(0, 240, 255, 0.15)", color: "#00f0ff", border: "1px solid #d946ef", fontWeight: 700 }}>
                ⚡ Cyber Neon
              </span>
              <span className="badge" style={{ background: "rgba(255, 255, 255, 0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", fontWeight: 600 }}>
                ✨ Clean Minimal
              </span>
              <span className="badge" style={{ background: "rgba(255, 255, 255, 0.05)", color: "var(--muted)", border: "1px solid var(--line)" }}>
                📖 Классика
              </span>
            </div>
            <p className="small muted" style={{ margin: "6px 0 0", fontSize: 11 }}>
              {lang === "ru"
                ? "Шаблон оформления выбирается во вкладке Экспорт перед запуском финального рендера."
                : "Choose your desired visual template in the Export tab before rendering."}
            </p>
          </div>

          {msg && <p className="ok">{msg}</p>}
          {error && <p className="error">{error}</p>}
        </section>
      </div>

      {/* Список и предпросмотр реплик */}
      <section className="card" data-tour="subs-table">
        <div className="card-title" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div className="row">
            <h2>{lang === "ru" ? "Субтитры" : "Subtitles"} {cues.length ? `(${cues.length})` : ""}</h2>
          </div>

          {/* Вкладки: Оригинал / Перевод / Двуязычные */}
          {cues.length > 0 && (
            <div className="tabs">
              <button className={`tab-btn ${viewMode === "orig" ? "active" : ""}`} onClick={() => setViewMode("orig")}>
                {t("subs.tab.orig")}
              </button>
              {transLangs.length > 0 && (
                <>
                  <button className={`tab-btn ${viewMode === "trans" ? "active" : ""}`} onClick={() => setViewMode("trans")}>
                    {t("subs.tab.trans")} ({selectedTransLang.toUpperCase()})
                  </button>
                  <button className={`tab-btn ${viewMode === "bilingual" ? "active" : ""}`} onClick={() => setViewMode("bilingual")}>
                    {t("subs.tab.bilingual")}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {cues.length === 0 ? (
          <div className="empty">
            <Icon name="captions" />
            <span>{t("subs.no_cues")}</span>
          </div>
        ) : (
          <>
            <div className="row">
              <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("subs.search")} />
              <button
                className={`small ${showReplace ? "primary" : "ghost"}`}
                onClick={() => setShowReplace(!showReplace)}
                title={lang === "ru" ? "Найти и заменить текст в репликах" : "Find and replace text across cues"}
              >
                <Icon name="edit" /> {lang === "ru" ? "Замена…" : "Replace…"}
              </button>
              <button
                className={`small ${showFillers ? "primary" : "ghost"}`}
                onClick={() => setShowFillers(!showFillers)}
                title={lang === "ru" ? "Поиск и удаление слов-паразитов" : "Filler words cleaner"}
              >
                🧽 {lang === "ru" ? `Паразиты (${fillerMatches.length})` : `Fillers (${fillerMatches.length})`}
              </button>
              {viewMode === "trans" && transLangs.length > 1 && (
                <select value={selectedTransLang} onChange={(e) => setSelectedTransLang(e.target.value)}>
                  {transLangs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                </select>
              )}
            </div>

            {showFillers && (
              <div style={{ padding: "12px 14px", background: "var(--panel2)", borderRadius: 8, border: "1px solid var(--line)" }}>
                <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <b>{lang === "ru" ? `Найдено слов-паразитов: ${fillerMatches.length}` : `Found ${fillerMatches.length} filler words`}</b>
                    <span className="muted small" style={{ marginLeft: 8 }}>
                      {lang === "ru" ? "«эээ», «короче», «ну», «типа» и др." : "um, uh, like, etc."}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      className="primary small"
                      onClick={cleanAllFillers}
                      disabled={fillerMatches.length === 0 || cleaningFillers || busy}
                    >
                      {lang === "ru" ? `Вырезать все (${fillerMatches.length})` : `Cut all (${fillerMatches.length})`}
                    </button>
                    <button className="ghost small" onClick={() => setShowFillers(false)}>{t("common.cancel")}</button>
                  </div>
                </div>
                {fillerMatches.length > 0 && (
                  <div className="row wrap" style={{ gap: 6, maxHeight: 110, overflowY: "auto" }}>
                    {fillerMatches.slice(0, 25).map((f) => (
                      <span key={f.id} className="filler-tag">
                        «{f.word}» ({fmtTime(f.start_ms, false)})
                      </span>
                    ))}
                    {fillerMatches.length > 25 && <span className="muted small">+{fillerMatches.length - 25} ещё…</span>}
                  </div>
                )}
              </div>
            )}

            {showReplace && (
              <div className="row wrap" style={{ padding: "10px 14px", background: "var(--panel2)", borderRadius: 8, border: "1px solid var(--line)" }}>
                <input
                  style={{ minWidth: 160 }}
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  placeholder={lang === "ru" ? "Что найти…" : "Find text…"}
                />
                <input
                  style={{ minWidth: 160 }}
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder={lang === "ru" ? "Заменить на…" : "Replace with…"}
                />
                <button className="primary small" onClick={replaceAll} disabled={!findText || busy}>
                  {lang === "ru" ? "Заменить все" : "Replace All"}
                </button>
                <button className="ghost small" onClick={() => setShowReplace(false)}>
                  {t("common.cancel")}
                </button>
              </div>
            )}

            <p className="muted small">{t("subs.edit_hint")}</p>

            <ul className="list cues">
              {found.map((c, i) => {
                const isEditing = editingIdx === i;
                const origCue = cues[i];
                const transCue = activeTransCues[i];
                const isTooLong = c.text.length > 42;
                const isCut = isCueCut(c.start_ms, c.end_ms);

                return (
                  <li key={i} onDoubleClick={() => startEdit(i, c.text)} style={isCut ? { background: "rgba(239, 68, 68, 0.05)" } : undefined}>
                    <button className="link" onClick={() => onJump(c.start_ms)} title={lang === "ru" ? "Перейти в таймлайне" : "Jump in timeline"}>
                      {fmtTime(c.start_ms, false)}
                    </button>

                    <div className="grow" style={{ minWidth: 0 }}>
                      {isEditing ? (
                        <div className="row">
                          <input
                            className="grow"
                            autoFocus
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(i);
                              if (e.key === "Escape") setEditingIdx(null);
                            }}
                          />
                          <button className="primary" onClick={() => saveEdit(i)} title={t("common.save")}><Icon name="check" /></button>
                          <button className="ghost" onClick={() => setEditingIdx(null)} title={t("common.cancel")}><Icon name="x" /></button>
                        </div>
                      ) : (
                        <div>
                          {viewMode === "bilingual" ? (
                            <div style={isCut ? { textDecoration: "line-through", opacity: 0.55 } : undefined}>
                              <div style={{ fontWeight: 600 }}>{origCue?.text}</div>
                              <div className="muted" style={{ marginTop: 2, color: "var(--accent)" }}>{transCue?.text || "—"}</div>
                            </div>
                          ) : (
                            <span style={{ wordBreak: "break-word", textDecoration: isCut ? "line-through" : "none", opacity: isCut ? 0.55 : 1 }}>
                              {c.text}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="row" style={{ flex: "none", gap: 6, alignItems: "center" }}>
                      {isCut && (
                        <span className="badge small bad">
                          {lang === "ru" ? "Вырезано" : "Cut"}
                        </span>
                      )}
                      {payload && onPayload && !isEditing && (
                        <button
                          className="ghost small"
                          style={{ padding: "2px 6px" }}
                          onClick={() => toggleCutCue(c.start_ms, c.end_ms, !isCut)}
                          title={isCut
                            ? (lang === "ru" ? "Вернуть реплику в видео" : "Restore cue to video")
                            : (lang === "ru" ? "Вырезать реплику из видео (текстовый монтаж)" : "Cut cue from video")}
                        >
                          {isCut ? "↩️" : <Icon name="scissors" />}
                        </button>
                      )}
                      {isTooLong && (
                        <span className="badge warn small" title={lang === "ru" ? "Строка длиннее 42 символов" : "Line longer than 42 characters"}>
                          {c.text.length}зн
                        </span>
                      )}
                      {!isEditing && (
                        <button className="ghost" style={{ padding: "2px 6px" }} onClick={() => startEdit(i, c.text)} title={t("common.edit")}>
                          <Icon name="edit" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
