import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import type { Cue, Job, Project, WhispModels } from "../types";
import Icon from "./Icon";
import ModelCards from "./ModelCards";

interface SubtitlesResponse {
  cues: Cue[];
  translations: Record<string, Cue[]>;
}

export default function SubtitlesPanel({ pid, cues, busy, onJob, onChanged, onJump }: {
  pid: string; project?: Project; cues: Cue[]; busy: boolean; onJob: (j: Job) => void; onChanged: () => void; onJump: (ms: number) => void;
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

  // Быстрый перевод
  const [quickTargetLang, setQuickTargetLang] = useState("en");

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
        max_line_chars: lineChars, vad,
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
              {viewMode === "trans" && transLangs.length > 1 && (
                <select value={selectedTransLang} onChange={(e) => setSelectedTransLang(e.target.value)}>
                  {transLangs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                </select>
              )}
            </div>

            <p className="muted small">{t("subs.edit_hint")}</p>

            <ul className="list cues">
              {found.map((c, i) => {
                const isEditing = editingIdx === i;
                const origCue = cues[i];
                const transCue = activeTransCues[i];
                const isTooLong = c.text.length > 42;

                return (
                  <li key={i} onDoubleClick={() => startEdit(i, c.text)}>
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
                            <div>
                              <div style={{ fontWeight: 600 }}>{origCue?.text}</div>
                              <div className="muted" style={{ marginTop: 2, color: "var(--accent)" }}>{transCue?.text || "—"}</div>
                            </div>
                          ) : (
                            <span style={{ wordBreak: "break-word" }}>{c.text}</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="row" style={{ flex: "none", gap: 6 }}>
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
