import { useEffect, useState } from "react";
import { api, fmtSize, fmtTime } from "../api";
import type { Compare, Job, PlanPayload, Profile, Project } from "../types";
import { hasNativePicker, nativePickFile } from "../native";
import FileBrowser from "./FileBrowser";
import Icon from "./Icon";

const FIELDS: { key: keyof Profile; label: string; step: number; hint: string }[] = [
  { key: "noise_db", label: "Порог громкости, dBFS", step: 1, hint: "Всё тише считается паузой. Чем меньше число (ближе к −50), тем строже." },
  { key: "min_pause_s", label: "Минимальная пауза, с", step: 0.1, hint: "Более короткие паузы не трогаем." },
  { key: "pad_before_s", label: "Запас перед речью, с", step: 0.05, hint: "Сколько паузы оставить перед началом фразы." },
  { key: "pad_after_s", label: "Запас после речи, с", step: 0.05, hint: "Сколько паузы оставить после конца фразы." },
  { key: "min_keep_s", label: "Минимальный фрагмент, с", step: 0.1, hint: "Более короткие куски между сокращениями помечаются на проверку." },
];
const PROFILE_TEXT: Record<string, string> = {
  careful: "Убирает только долгие паузы. Размышления и вдохи остаются. Для спокойных лекций.",
  standard: "Убирает заметные паузы, оставляя запас до и после речи. Подходит для большинства записей.",
  aggressive: "Убирает даже короткие паузы и тихие места. Динамичнее, но результат стоит проверить внимательнее.",
};
const sec = (n: number) => String(n).replace(".", ",");

export default function SetupPanel({ project, payload, busy, onJob, onChanged }: {
  project: Project; payload: PlanPayload | null; busy: boolean; onJob: (j: Job) => void; onChanged: () => void;
}) {
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [profile, setProfile] = useState(project.settings.profile);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [audio, setAudio] = useState(project.settings.audio_stream);
  const [scenes, setScenes] = useState(project.settings.detect_scenes);
  const [auto, setAuto] = useState(!project.has_plan);
  const [hint, setHint] = useState("");
  const [engine, setEngine] = useState(project.settings.engine ?? "builtin");
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
      setHint(`Фон ≈ ${r.floor_db} dB, речь ≈ ${r.speech_db} dB → порог ${r.noise_db} dBFS${r.confident ? "" : " (запись почти ровная по громкости, значение осторожное)"}`);
    } catch (e) { setError((e as Error).message); }
  };
  const runCompare = async () => {
    setError("");
    try { onJob(await api.post<Job>(`/api/projects/${project.id}/analysis/compare`)); } catch (e) { setError((e as Error).message); }
  };
  const analyze = async () => {
    setError("");
    if (project.has_plan && !confirm("Монтажный план уже создан. Создать новый? Прежний сохранится как версия.")) return;
    try {
      onJob(await api.post<Job>(`/api/projects/${project.id}/analyze`, {
        profile, overrides, audio_stream: audio, detect_scenes: scenes, replace_plan: project.has_plan,
        auto_threshold: auto && overrides.noise_db === undefined, engine,
      }));
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <section className="card">
        <div className="card-title"><span className={`num ${project.source ? "done" : ""}`}>{project.source ? <Icon name="check" /> : 1}</span><h2>Видео</h2></div>
        {project.source ? (
          <div className="filecard">
            <Icon name="film" />
            <div className="grow">
              <b>{project.source.filename}</b>
              <div className="muted small">{fmtSize(project.source.size_bytes)}{meta ? ` · ${fmtTime(meta.duration_ms, false)}` : ""}
                {meta?.video ? ` · ${meta.video.width}×${meta.video.height}, ${meta.video.fps_value.toFixed(2)} к/с` : ""}{meta && !meta.has_video ? " · только звук" : ""}</div>
              {meta?.video?.variable_frame_rate && <div className="muted small">Переменная частота кадров: при рендере будет приведена к постоянной.</div>}
            </div>
            <button onClick={pick}>Заменить файл…</button>
          </div>
        ) : (
          <div className="pick">
            <Icon name="film" />
            <div className="grow"><b>Файл не выбран</b><div className="muted">Выберите запись. Копия не создаётся, проект хранит только путь.</div></div>
            <button className="primary" onClick={pick}>Выбрать видео…</button>
          </div>
        )}
        {!hasNativePicker() && (
          <details className="more"><summary>Указать путь вручную</summary>
            <div className="row"><input className="grow" value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\Лекции\lecture.mp4" />
              <button onClick={() => saveSource(path)} disabled={!path.trim()}>Привязать</button></div>
          </details>
        )}
        {browse && <FileBrowser onPick={saveSource} onClose={() => setBrowse(false)} />}
      </section>

      <section className="card">
        <div className="card-title"><span className={`num ${project.has_plan ? "done" : ""}`}>{project.has_plan ? <Icon name="check" /> : 2}</span><h2>Как убирать паузы</h2></div>
        <div className="profiles" role="radiogroup">
          {Object.entries(profiles).map(([k, p]) => (
            <label key={k} className={`profile ${profile === k ? "on" : ""}`}>
              <input type="radio" checked={profile === k} onChange={() => { setProfile(k); setOverrides({}); }} />
              <b>{p.label}</b>
              <span className="muted">{PROFILE_TEXT[k]}</span>
              <span className="tags"><span className="badge">пауза от {sec(p.min_pause_s)} с</span><span className="badge">порог {p.noise_db} dB</span></span>
            </label>
          ))}
        </div>
        <p className="muted">Ничего не удаляется навсегда: программа лишь предложит сокращения, а вы проверите и поправите их на следующем шаге.</p>

        <details className="more"><summary>Дополнительные настройки</summary>
          <div className="fields">
            {FIELDS.map((f) => (
              <label key={f.key} title={f.hint}>{f.label}
                <input type="number" step={f.step} value={value(f.key)} onChange={(e) => setOverrides({ ...overrides, [f.key]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
          <div className="row wrap">
            <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Подобрать порог громкости по записи</label>
            {project.has_plan && <button onClick={suggest}>Показать рекомендацию</button>}
          </div>
          {hint && <p className="ok">{hint}</p>}
          {meta && meta.audio_streams.length > 1 && (
            <label>Аудиодорожка для анализа
              <select value={audio} onChange={(e) => setAudio(Number(e.target.value))}>
                {meta.audio_streams.map((a) => <option key={a.index} value={a.index}>№{a.index + 1}: {a.codec}, {a.channels} кан.{a.title ? `, ${a.title}` : ""}</option>)}
              </select>
            </label>
          )}
          <label className="check"><input type="checkbox" checked={scenes} onChange={(e) => setScenes(e.target.checked)} /> Искать смену сцен (метки на шкале, ничего не удаляет)</label>
          <div className="row wrap">
            <span className="muted">Движок поиска пауз:</span>
            <label className="check"><input type="radio" checked={engine === "builtin"} onChange={() => setEngine("builtin")} /> Встроенный</label>
            <label className="check" title={ae?.available ? "" : "Auto-Editor не найден"}>
              <input type="radio" disabled={!ae?.available} checked={engine === "auto-editor"} onChange={() => setEngine("auto-editor")} /> Auto-Editor{ae?.available && ae.version ? ` ${ae.version}` : ""}
            </label>
            {ae?.available && project.metadata && <button onClick={runCompare} disabled={busy}>Сравнить движки</button>}
          </div>
          {cmp && <p className="muted">Встроенный нашёл {cmp.builtin.cuts} сокращений ({(cmp.builtin.cut_ms / 1000).toFixed(1)} с), Auto-Editor — {cmp.auto_editor.cuts} ({(cmp.auto_editor.cut_ms / 1000).toFixed(1)} с). Совпадение по времени: <b>{Math.round(cmp.agreement * 100)}%</b>.</p>}
        </details>

        {error && <p className="error">{error}</p>}
        {!project.source && <div className="notice"><Icon name="info" /> Сначала выберите видео.</div>}
        <div className="row">
          <button className="primary big" onClick={analyze} disabled={busy || !project.source}>
            <Icon name="scissors" /> {project.has_plan ? "Пересоздать монтажный план" : "Найти паузы и собрать черновик"}
          </button>
          {busy && <span className="muted">Анализ выполняется, ход виден справа внизу.</span>}
        </div>
        {payload && project.has_plan && <p className="muted">Сейчас в плане: {payload.stats.segments} фрагментов, убрано {fmtTime(payload.stats.removed_ms, false)}.</p>}
      </section>
    </div>
  );
}
