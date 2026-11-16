import { useEffect, useState } from "react";
import { api, fmtSize, fmtTime } from "../api";
import type { Compare, Job, Profile, Project } from "../types";
import FileBrowser from "./FileBrowser";

const FIELDS: { key: keyof Profile; label: string; step: number; hint: string }[] = [
  { key: "noise_db", label: "Порог громкости, dBFS", step: 1, hint: "Всё тише считается паузой. Подбирается на реальных записях." },
  { key: "min_pause_s", label: "Мин. пауза для сокращения, с", step: 0.1, hint: "Более короткие паузы не трогаем." },
  { key: "pad_before_s", label: "Запас до речи, с", step: 0.05, hint: "Сколько паузы оставить перед началом фразы." },
  { key: "pad_after_s", label: "Запас после речи, с", step: 0.05, hint: "Сколько паузы оставить после конца фразы." },
  { key: "min_keep_s", label: "Мин. сохраняемый фрагмент, с", step: 0.1, hint: "Более короткие куски между сокращениями помечаются на проверку." },
];

export default function SetupPanel({ project, busy, onJob, onChanged }: {
  project: Project; busy: boolean; onJob: (j: Job) => void; onChanged: () => void;
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
    setError("");
    try { await api.put(`/api/projects/${project.id}/source`, { path: p }); setPath(p); onChanged(); }
    catch (e) { setError((e as Error).message); }
  };

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
    <div className="grid2">
      <section className="card">
        <h2>Исходный файл</h2>
        <div className="row">
          <input className="grow" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Полный путь к видео, например D:\Лекции\lecture.mp4" />
          <button onClick={() => setBrowse(true)}>Обзор…</button>
          <button className="primary" onClick={() => saveSource(path)} disabled={!path.trim()}>Привязать</button>
        </div>
        <p className="muted">Файл не копируется и не изменяется — проект хранит только ссылку. Если файл переместили, укажите новый путь.</p>
        {browse && <FileBrowser onPick={(p) => { setBrowse(false); saveSource(p); }} onClose={() => setBrowse(false)} />}
        {meta && (
          <table className="kv">
            <tbody>
              <tr><td>Файл</td><td>{meta.filename} · {fmtSize(meta.size_bytes)}</td></tr>
              <tr><td>Длительность</td><td>{fmtTime(meta.duration_ms, false)}</td></tr>
              {meta.video && <tr><td>Видео</td><td>{meta.video.codec} · {meta.video.width}×{meta.video.height} · {meta.video.fps_value.toFixed(3)} к/с{meta.video.variable_frame_rate ? " (переменная частота)" : ""}</td></tr>}
              {meta.audio_streams.map((a) => (
                <tr key={a.index}><td>Аудио {a.index + 1}</td><td>{a.codec} · {a.sample_rate} Гц · {a.channels} кан.{a.language && a.language !== "und" ? ` · ${a.language}` : ""}{a.title ? ` · ${a.title}` : ""}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Анализ и черновой монтаж</h2>
        <div className="row wrap">
          {Object.entries(profiles).map(([k, p]) => (
            <label key={k} className={`chip ${profile === k ? "on" : ""}`}>
              <input type="radio" checked={profile === k} onChange={() => { setProfile(k); setOverrides({}); }} /> {p.label}
            </label>
          ))}
        </div>
        <div className="fields">
          {FIELDS.map((f) => (
            <label key={f.key} title={f.hint}>{f.label}
              <input type="number" step={f.step} value={value(f.key)} onChange={(e) => setOverrides({ ...overrides, [f.key]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        {meta && meta.audio_streams.length > 1 && (
          <label>Аудиодорожка для анализа
            <select value={audio} onChange={(e) => setAudio(Number(e.target.value))}>
              {meta.audio_streams.map((a) => <option key={a.index} value={a.index}>№{a.index + 1}: {a.codec}, {a.channels} кан.{a.title ? `, ${a.title}` : ""}</option>)}
            </select>
          </label>
        )}
        <div className="row wrap">
          <span className="muted">Движок поиска пауз:</span>
          <label className={`chip ${engine === "builtin" ? "on" : ""}`}><input type="radio" checked={engine === "builtin"} onChange={() => setEngine("builtin")} /> Встроенный (FFmpeg)</label>
          <label className={`chip ${engine === "auto-editor" ? "on" : ""}`} title={ae?.available ? "" : "Auto-Editor не найден: положите auto-editor.exe в tools/auto-editor/"}>
            <input type="radio" disabled={!ae?.available} checked={engine === "auto-editor"} onChange={() => setEngine("auto-editor")} /> Auto-Editor{ae?.available && ae.version ? ` ${ae.version}` : ""}
          </label>
          {ae?.available && project.metadata && <button onClick={runCompare} disabled={busy}>Сравнить движки</button>}
        </div>
        {cmp && (
          <p className="muted">Сравнение на этом файле: встроенный — {cmp.builtin.cuts} сокращений ({(cmp.builtin.cut_ms / 1000).toFixed(1)} с),
            Auto-Editor — {cmp.auto_editor.cuts} ({(cmp.auto_editor.cut_ms / 1000).toFixed(1)} с), совпадение по времени <b>{Math.round(cmp.agreement * 100)}%</b>.</p>
        )}
        <div className="row wrap">
          <label className="check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Подобрать порог громкости по записи автоматически</label>
          {project.has_plan && <button onClick={suggest}>Показать рекомендацию</button>}
        </div>
        {hint && <p className="ok">{hint}</p>}
        <label className="check"><input type="checkbox" checked={scenes} onChange={(e) => setScenes(e.target.checked)} /> Искать смену сцен (маркеры на шкале; ничего не удаляет)</label>
        <p className="muted">Тихая речь, вдохи и окончания фраз при мягких профилях сохраняются; между фразами остаётся запас паузы. Все решения можно проверить и изменить.</p>
        {error && <p className="error">{error}</p>}
        <button className="primary big" onClick={analyze} disabled={busy || !project.source}>
          {project.has_plan ? "Пересоздать монтажный план" : "Запустить анализ"}
        </button>
      </section>
    </div>
  );
}
