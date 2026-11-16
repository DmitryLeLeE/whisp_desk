import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Cue, Job, PlanPayload, Project, Scenes, Waveform } from "../types";
import Editor from "./Editor";
import ExportPanel from "./ExportPanel";
import JobBar from "./JobBar";
import SetupPanel from "./SetupPanel";
import SubtitlesPanel from "./SubtitlesPanel";

type Tab = "setup" | "edit" | "subs" | "export";

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
      } else {
        setPayload(null);
      }
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
    }, 1000);
    return () => clearInterval(t);
  }, [job, loadAll]);

  const running = !!job && (job.status === "QUEUED" || job.status === "RUNNING");

  if (error && !project) return <main className="page"><p className="error">{error}</p><button onClick={onClose}>К проектам</button></main>;
  if (!project) return <main className="page"><p className="muted">Загрузка…</p></main>;

  return (
    <div className="project">
      <div className="subbar">
        <button className="link" onClick={onClose}>← Проекты</button>
        <b className="pname">{project.name}</b>
        <span className="muted">{project.id}</span>
        <nav className="tabs">
          {([["setup", "Источник и анализ"], ["edit", "Монтаж"], ["subs", "Субтитры"], ["export", "Экспорт"]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}
              disabled={k !== "setup" && !project.has_plan}>{label}</button>
          ))}
        </nav>
      </div>
      <JobBar job={job} onJob={setJob} onDone={loadAll} />
      <main className="page">
        {tab === "setup" && <SetupPanel project={project} busy={running} onJob={setJob} onChanged={loadAll} />}
        {tab === "edit" && payload && (
          <Editor pid={pid} project={project} payload={payload} onPayload={setPayload} scenes={scenes} wave={wave} cues={cues} busy={running} seekTo={seekTo} />
        )}
        {tab === "subs" && <SubtitlesPanel pid={pid} project={project} cues={cues} busy={running} onJob={setJob} onChanged={loadAll}
          onJump={(ms) => { setSeekTo({ ms, n: Date.now() }); setTab("edit"); }} />}
        {tab === "export" && payload && <ExportPanel pid={pid} project={project} payload={payload} busy={running} onJob={setJob} onPayload={setPayload} />}
      </main>
    </div>
  );
}
