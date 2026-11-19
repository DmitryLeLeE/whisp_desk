import { useEffect, useState } from "react";
import { api, fmtSize, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import { hasNativePicker, nativePickFile } from "../native";
import type { Compare, Job, PlanPayload, Profile, Project } from "../types";
import FileBrowser from "./FileBrowser";
import Icon from "./Icon";

const FIELDS: { key: keyof Profile; labelRu: string; labelEn: string; step: number; hintRu: string; hintEn: string }[] = [
  { key: "noise_db", labelRu: "Порог громкости, dBFS", labelEn: "Noise Threshold, dBFS", step: 1, hintRu: "Всё тише считается паузой.", hintEn: "Audio below this level is marked as silence." },
  { key: "min_pause_s", labelRu: "Минимальная пауза, с", labelEn: "Min Silence Duration, s", step: 0.1, hintRu: "Более короткие паузы не трогаем.", hintEn: "Pauses shorter than this are not cut." },
  { key: "pad_before_s", labelRu: "Запас перед речью, с", labelEn: "Padding Before Speech, s", step: 0.05, hintRu: "Запас перед началом фразы.", hintEn: "Audio preserved before speech starts." },
  { key: "pad_after_s", labelRu: "Запас после речи, с", labelEn: "Padding After Speech, s", step: 0.05, hintRu: "Запас после конца фразы.", hintEn: "Audio preserved after speech ends." },
  { key: "min_keep_s", labelRu: "Минимальный фрагмент, с", labelEn: "Min Keep Duration, s", step: 0.1, hintRu: "Короткие куски помечаются на проверку.", hintEn: "Short speech fragments flagged for review." },
];

const PROFILE_TEXT_RU: Record<string, string> = {
  careful: "Для спокойных лекций и бесед. Оставляет паузы для размышлений и естественное дыхание (паузы от 2.0 с).",
  standard: "Рекомендуется: оптимальный баланс темпа. Вырезает явные паузы (от 1.2 с) с мягким запасом речи.",
  aggressive: "Плотный и быстрый монтаж. Вырезает даже короткие паузы (от 0.7 с). Идеально для Shorts и Reels.",
};

const PROFILE_TEXT_EN: Record<string, string> = {
  careful: "Preserves natural breathing and thinking gaps. Ideal for slow-paced lectures and discussions (2.0s+).",
  standard: "Recommended: balanced pacing. Trims noticeable pauses (1.2s+) with smooth speech padding.",
  aggressive: "Fast-paced jump-cut pacing. Cuts short pauses (0.7s+). Ideal for Shorts and TikTok.",
};

const sec = (n: number) => String(n).replace(".", ",");

export default function SetupPanel({ project, payload: _payload, busy, onJob, onChanged }: {
  project: Project; payload: PlanPayload | null; busy: boolean; onJob: (j: Job) => void; onChanged: () => void;
}) {
  const { t, lang } = useTranslation();
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [profile, setProfile] = useState(project.settings.profile);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [audio, setAudio] = useState(project.settings.audio_stream);
  const [scenes, setScenes] = useState(project.settings.detect_scenes);
  const [auto, setAuto] = useState(!project.has_plan);
  const [hint, setHint] = useState("");
  const [engine, setEngine] = useState(project.settings.engine ?? "builtin");
  const [denoise, setDenoise] = useState(Boolean(project.settings.denoise));
  const [ae, setAe] = useState<{ available: boolean; version?: string } | null>(null);
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [path, setPath] = useState(project.source?.path ?? "");
  const [browse, setBrowse] = useState(false);
  const [error, setError] = useState("");
  const meta = project.metadata;

  useEffect(() => { api.get<Record<string, Profile>>("/api/profiles").then(setProfiles); }, []);
  useEffect(() => {
    api.get<{ auto_editor: { available: boolean; version?: string } }>("/api/system").then((s) => setAe(s.auto_editor)).catch(() => undefined);
    api.get<Compare>(`/api/projects/${project.id}/analysis/compare`).then(setCmp).catch(() => setCmp(null));
  }, [project.id, busy]);

  const value = (k: keyof Profile) => overrides[k] ?? (profiles[profile]?.[k] as number | undefined) ?? "";

  const saveSource = async (p: string) => {
    setError(""); setBrowse(false);
    try { await api.put(`/api/projects/${project.id}/source`, { path: p }); setPath(p); onChanged(); }
    catch (e) { setError((e as Error).message); }
  };
  const pick = async () => { if (hasNativePicker()) { const p = await nativePickFile(); if (p) saveSource(p); } else setBrowse(true); };

  const suggest = async () => {
    setError(""); setHint("");
    try {
      const r = await api.get<{ noise_db: number; floor_db: number; speech_db: number; confident: boolean }>(`/api/projects/${project.id}/analysis/threshold`);
      setOverrides({ ...overrides, noise_db: r.noise_db }); setAuto(false);
      setHint(lang === "ru"
        ? `Фон ≈ ${r.floor_db} dB, речь ≈ ${r.speech_db} dB → порог ${r.noise_db} dBFS${r.confident ? "" : " (примерная оценка)"}`
        : `Noise floor ≈ ${r.floor_db} dB, speech ≈ ${r.speech_db} dB → threshold ${r.noise_db} dBFS`);
    } catch (e) { setError((e as Error).message); }
  };

  const analyze = async () => {
    setError("");
    try {
      await api.patch(`/api/projects/${project.id}`, { settings: { profile, overrides, audio_stream: audio, detect_scenes: scenes, engine, denoise } });
      onJob(await api.post<Job>(`/api/projects/${project.id}/analyze`, { profile, overrides, audio_stream: audio, detect_scenes: scenes, engine, auto_threshold: auto, denoise }));
    } catch (e) { setError((e as Error).message); }
  };

  const compare = async () => {
    setError("");
    try {
      await api.patch(`/api/projects/${project.id}`, { settings: { profile, overrides, audio_stream: audio } });
      onJob(await api.post<Job>(`/api/projects/${project.id}/analysis/compare`, { profile, overrides, audio_stream: audio }));
    } catch (e) { setError((e as Error).message); }
  };

  const profText = lang === "ru" ? PROFILE_TEXT_RU : PROFILE_TEXT_EN;

  return (
    <div className="grid2 setup-layout">
      <div className="stack">
        <section className="card">
          <div className="card-title">
            <h2>{t("setup.source_file")}</h2>
          </div>
          {project.source ? (
            <div className="filecard">
              <Icon name="film" />
              <div className="grow">
                <b>{project.source.filename}</b>
                <p className="muted small">{path}</p>
                {meta && (
                  <p className="muted small">
                    {fmtTime(meta.duration_ms, false)} · {meta.video ? `${meta.video.width}×${meta.video.height}` : (lang === "ru" ? "Аудио" : "Audio")} · {fmtSize(meta.size_bytes)}
                  </p>
                )}
              </div>
              <button onClick={pick}>{lang === "ru" ? "Заменить…" : "Replace…"}</button>
            </div>
          ) : (
            <div className="pick">
              <Icon name="film" />
              <div className="grow">
                <b>{lang === "ru" ? "Видео пока не выбрано" : "No video selected"}</b>
                <p className="muted">{lang === "ru" ? "Укажите файл на диске." : "Choose a local video file."}</p>
              </div>
              <button className="primary" onClick={pick}>{t("setup.select_file")}</button>
            </div>
          )}
          {browse && <FileBrowser onPick={saveSource} onClose={() => setBrowse(false)} />}
        </section>

        <section className="card">
          <div className="card-title">
            <h2>{lang === "ru" ? "Параметры анализа" : "Analysis Parameters"}</h2>
          </div>
          <div className="fields">
            {meta?.audio_streams && meta.audio_streams.length > 1 && (
              <label>
                {lang === "ru" ? "Аудиодорожка для поиска речи" : "Audio track for speech"}
                <select value={audio} onChange={(e) => setAudio(Number(e.target.value))}>
                  {meta.audio_streams.map((s) => (
                    <option key={s.index} value={s.index}>
                      #{s.index + 1} {s.title || s.language || s.codec} ({s.channels}ch, {s.sample_rate}Hz)
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {lang === "ru" ? "Движок поиска пауз" : "Silence Detection Engine"}
              <select value={engine} onChange={(e) => setEngine(e.target.value)}>
                <option value="builtin">{lang === "ru" ? "Встроенный (FFmpeg silencedetect)" : "Built-in (FFmpeg silencedetect)"}</option>
                <option value="auto_editor" disabled={!ae?.available}>
                  Auto-Editor{ae?.available ? "" : (lang === "ru" ? " (не установлен)" : " (not installed)")}
                </option>
              </select>
            </label>
          </div>

          <label className="check">
            <input type="checkbox" checked={scenes} onChange={(e) => setScenes(e.target.checked)} />
            {lang === "ru" ? "Определять смену сцен (помогает при видеомонтаже)" : "Detect scene boundaries"}
          </label>

          <label className="check">
            <input type="checkbox" checked={denoise} onChange={(e) => setDenoise(e.target.checked)} />
            <span><b>{t("audio.denoise")}</b></span>
          </label>
          <p className="muted small" style={{ margin: "-6px 0 0 24px" }}>{t("audio.denoise_hint")}</p>
        </section>

        {cmp && (
          <section className="card">
            <div className="card-title">
              <h2>{lang === "ru" ? "Сравнение движков" : "Engine Comparison"}</h2>
            </div>
            <p className="muted small">
              {lang === "ru"
                ? `Совпадение сокращений: ${(cmp.agreement * 100).toFixed(0)}%. Встроенный сократил ${fmtTime(cmp.builtin.cut_ms, false)}, Auto-Editor: ${fmtTime(cmp.auto_editor.cut_ms, false)}.`
                : `Agreement: ${(cmp.agreement * 100).toFixed(0)}%. Builtin cut ${fmtTime(cmp.builtin.cut_ms, false)}, Auto-Editor: ${fmtTime(cmp.auto_editor.cut_ms, false)}.`}
            </p>
          </section>
        )}
      </div>

      <div className="stack">
        <section className="card">
          <div className="card-title">
            <h2>{t("setup.profile")}</h2>
          </div>
          <div className="profiles">
            {Object.entries(profiles).map(([k, p]) => (
              <label key={k} className={`profile ${profile === k ? "on" : ""}`} onClick={() => { setProfile(k); setOverrides({}); }}>
                <input type="radio" name="profile" checked={profile === k} onChange={() => undefined} />
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <b>{p.label}</b>
                  {k === "standard" && (
                    <span className="badge ok" style={{ fontSize: 10 }}>{lang === "ru" ? "Рекомендуется" : "Recommended"}</span>
                  )}
                </div>
                <span className="muted small" style={{ lineHeight: 1.45 }}>{profText[k]}</span>
                <span className="tags">
                  <span className="badge">≥ {sec(p.min_pause_s)} {lang === "ru" ? "с" : "s"}</span>
                  <span className="badge">{p.noise_db} dBFS</span>
                </span>
              </label>
            ))}
          </div>

          <details className="more">
            <summary>{lang === "ru" ? "Экспертная настройка порогов (dB, секунды)" : "Expert Threshold Controls"}</summary>
            {project.has_plan && (
              <div className="row wrap">
                <button onClick={suggest}>{lang === "ru" ? "Подобрать порог по звуку" : "Auto-detect Threshold"}</button>
                {hint && <span className="muted small">{hint}</span>}
              </div>
            )}
            <div className="fields">
              {FIELDS.map((f) => (
                <label key={f.key} title={lang === "ru" ? f.hintRu : f.hintEn}>
                  {lang === "ru" ? f.labelRu : f.labelEn}
                  <input
                    type="number"
                    step={f.step}
                    value={value(f.key)}
                    onChange={(e) => setOverrides({ ...overrides, [f.key]: e.target.value === "" ? (profiles[profile]?.[f.key] as number) : Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
          </details>

          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="primary big" onClick={analyze} disabled={busy || !project.source}>
              <Icon name="scissors" /> {project.has_plan ? (lang === "ru" ? "Пересчитать монтаж" : "Re-analyze") : (lang === "ru" ? "Найти паузы и начать монтаж" : "Detect Pauses & Edit")}
            </button>
            {ae?.available && (
              <button onClick={compare} disabled={busy || !project.has_plan} title={lang === "ru" ? "Сравнить с Auto-Editor" : "Compare with Auto-Editor"}>
                {t("setup.btn.compare")}
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      </div>
    </div>
  );
}
