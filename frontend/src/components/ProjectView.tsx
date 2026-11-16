import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtTime } from "../api";
import type { Cue, Job, PlanPayload, Project, Scenes, Waveform } from "../types";
import Editor from "./Editor";
import ExportPanel from "./ExportPanel";
import Icon from "./Icon";
import JobDock from "./JobDock";
import SetupPanel from "./SetupPanel";
import SubtitlesPanel from "./SubtitlesPanel";

type Tab = "setup" | "edit" | "subs" | "export";
const STEPS: [Tab, string][] = [["setup", "Видео и анализ"], ["edit", "Монтаж"], ["subs", "Субтитры"], ["export", "Экспорт"]];

function NeedsPlan({ onGo }: { onGo: () => void }) {
  return (
    <div className="empty card"><Icon name="scissors" /><b>Сначала нужен черновой монтаж</b>
      <span>Выберите видео и запустите анализ: программа найдёт паузы и предложит, что убрать.</span>
      <button className="primary" onClick={onGo}>К анализу</button></div>
  );
}

export default function ProjectView({ pid, onClose }: { pid: string; onClose: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [payload, setPayload] = useState<PlanPayload | null>(null);
  const [scenes, setScenes] = useState<Scenes | null>(null);
  const [wave, setWave] = useState<Waveform | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [tab, setTab] = useState<Tab>("setup");
  const [error, setError] = useState("");
  const [seekTo, setSeekTo] = useState<{ ms: number; n: number } | null>(null);
  const firstLoad = useRef(true);

  const loadAll = useCallback(async () => {
    try {
      const p = await api.get<Project>(`/api/projects/${pid}`);
      setProject(p);
      if (p.active_job) setJob(p.active_job);
      if (p.has_plan) {
        setPayload(await api.get<PlanPayload>(`/api/projects/${pid}/timeline`));
        api.get<Scenes>(`/api/projects/${pid}/analysis/scenes`).then(setScenes).catch(() => setScenes(null));
        api.get<Waveform>(`/api/projects/${pid}/analysis/waveform`).then(setWave).catch(() => setWave(null));
      } else setPayload(null);
      if (p.has_subtitles) api.get<{ cues: Cue[] }>(`/api/projects/${pid}/subtitles`).then((r) => setCues(r.cues));
      else setCues([]);
      if (firstLoad.current) { firstLoad.current = false; setTab(p.has_plan ? "edit" : "setup"); }
    } catch (e) { setError((e as Error).message); }
  }, [pid]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Опрос состояния текущей задачи.
  useEffect(() => {
    if (!job || (job.status !== "QUEUED" && job.status !== "RUNNING")) return;
    const t = setInterval(async () => {
      try {
        const j = await api.get<Job>(`/api/jobs/${job.id}`);
        setJob(j);
        if (j.status !== "QUEUED" && j.status !== "RUNNING") { clearInterval(t); loadAll(); }
      } catch { /* повторим на следующем тике */ }
    }, 800);
    return () => clearInterval(t);
  }, [job, loadAll]);

  const running = !!job && (job.status === "QUEUED" || job.status === "RUNNING");

  if (error && !project) return <main className="page"><p className="error">{error}</p><button onClick={onClose}>К проектам</button></main>;
  if (!project) return <main className="page"><p className="muted">Загрузка…</p></main>;

  const unreviewed = payload?.stats.unreviewed ?? 0;
  const done: Record<Tab, boolean> = { setup: project.has_plan, edit: project.has_plan && unreviewed === 0, subs: project.has_subtitles, export: false };
  const next = (t: Tab) => { setTab(t); window.scrollTo({ top: 0 }); };

  return (
    <div className="project">
      <header className="proj-head">
        <button className="ghost" onClick={onClose}>← Проекты</button>
        <span className="pname">{project.name}</span>
        <nav className="stepper" aria-label="Шаги проекта">
          {STEPS.map(([k, label], i) => (
            <button key={k} className={`step ${tab === k ? "active" : ""} ${done[k] ? "done" : ""}`} onClick={() => setTab(k)} aria-current={tab === k ? "step" : undefined}>
              <span className="n">{done[k] ? <Icon name="check" /> : i + 1}</span>{label}
            </button>
          ))}
        </nav>
      </header>
      <main className="page">
        {tab === "setup" && <SetupPanel project={project} payload={payload} busy={running} onJob={setJob} onChanged={loadAll} />}
        {tab === "edit" && (payload ? (
          <Editor pid={pid} project={project} payload={payload} onPayload={setPayload} scenes={scenes} wave={wave} cues={cues} busy={running} seekTo={seekTo} />
        ) : <NeedsPlan onGo={() => setTab("setup")} />)}
        {tab === "subs" && <SubtitlesPanel pid={pid} project={project} cues={cues} busy={running} onJob={setJob} onChanged={loadAll}
          onJump={(ms) => { setSeekTo({ ms, n: Date.now() }); setTab("edit"); }} />}
        {tab === "export" && (payload ? <ExportPanel pid={pid} project={project} payload={payload} busy={running} onJob={setJob} onPayload={setPayload} />
          : <NeedsPlan onGo={() => setTab("setup")} />)}

        {tab === "setup" && project.has_plan && payload && (
          <div className="next-bar">
            <span className="grow">Черновой монтаж готов: убрано <b>{fmtTime(payload.stats.removed_ms, false)}</b> из {fmtTime(payload.stats.source_ms, false)}.</span>
            <button className="primary" onClick={() => next("edit")}>Проверить монтаж <Icon name="arrow" /></button>
          </div>
        )}
        {tab === "edit" && payload && (
          <div className="next-bar">
            <span className="grow">{unreviewed > 0 ? <>Непроверенных решений: <b>{unreviewed}</b>. Можно перейти дальше и вернуться позже.</> : "Все решения проверены."}</span>
            <button className="primary" onClick={() => next("subs")}>Дальше: субтитры <Icon name="arrow" /></button>
          </div>
        )}
        {tab === "subs" && payload && (
          <div className="next-bar">
            <span className="grow">{project.has_subtitles ? "Субтитры готовы." : "Субтитры можно пропустить: рендер работает и без них."}</span>
            <button className="primary" onClick={() => next("export")}>Дальше: экспорт <Icon name="arrow" /></button>
          </div>
        )}
      </main>
      <JobDock job={job} onJob={setJob} onDone={loadAll} />
    </div>
  );
}
