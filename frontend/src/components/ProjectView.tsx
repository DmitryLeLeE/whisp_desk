import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import type { Cue, Job, PlanPayload, Project, Scenes, Waveform } from "../types";
import Editor from "./Editor";
import ExportPanel from "./ExportPanel";
import Icon from "./Icon";
import JobDock from "./JobDock";
import SetupPanel from "./SetupPanel";
import SubtitlesPanel from "./SubtitlesPanel";
import TourGuide, { TourStep } from "./TourGuide";

type Tab = "setup" | "edit" | "subs" | "export";

function NeedsPlan({ onGo }: { onGo: () => void }) {
  const { lang } = useTranslation();
  return (
    <div className="empty card">
      <Icon name="scissors" />
      <b>{lang === "ru" ? "Сначала нужен черновой монтаж" : "Analysis required first"}</b>
      <span>
        {lang === "ru"
          ? "Выберите видео и запустите анализ: программа найдёт паузы и создаст монтажный план."
          : "Select a video and run analysis to detect silences and create an edit plan."}
      </span>
      <button className="primary" onClick={onGo}>
        {lang === "ru" ? "К анализу" : "Go to Analysis"}
      </button>
    </div>
  );
}

export default function ProjectView({ pid, onClose }: { pid: string; onClose: () => void }) {
  const { t, lang } = useTranslation();
  const [project, setProject] = useState<Project | null>(null);
  const [payload, setPayload] = useState<PlanPayload | null>(null);
  const [scenes, setScenes] = useState<Scenes | null>(null);
  const [wave, setWave] = useState<Waveform | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [tab, setTab] = useState<Tab>("setup");
  const [error, setError] = useState("");
  const [seekTo, setSeekTo] = useState<{ ms: number; n: number } | null>(null);
  const [showTour, setShowTour] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const firstLoad = useRef(true);

  const saveName = async () => {
    const trimmed = nameVal.trim();
    if (!trimmed || trimmed === project?.name) {
      setEditingName(false);
      return;
    }
    try {
      await api.patch(`/api/projects/${pid}`, { name: trimmed });
      setProject((p) => p ? { ...p, name: trimmed } : p);
      setEditingName(false);
    } catch {
      setEditingName(false);
    }
  };

  const steps: [Tab, string][] = [
    ["setup", t("step.setup")],
    ["edit", t("step.editor")],
    ["subs", t("step.subtitles")],
    ["export", t("step.export")],
  ];

  const projectSteps: TourStep[] = [
    {
      id: "step-pipeline",
      targetSelector: '[data-tour="proj-stepper"]',
      title: t("tour.project.step1.title"),
      content: t("tour.project.step1.desc"),
      placement: "bottom",
    },
    {
      id: "step-edit-tab",
      targetSelector: '[data-tour="step-edit"]',
      title: t("tour.project.step2.title"),
      content: t("tour.project.step2.desc"),
      placement: "bottom",
    },
    {
      id: "step-subs-tab",
      targetSelector: '[data-tour="step-subs"]',
      title: t("tour.project.step3.title"),
      content: t("tour.project.step3.desc"),
      placement: "bottom",
    },
    {
      id: "step-export-tab",
      targetSelector: '[data-tour="step-export"]',
      title: t("tour.project.step4.title"),
      content: t("tour.project.step4.desc"),
      placement: "bottom",
    },
  ];

  const finishTour = () => {
    setShowTour(false);
    try { localStorage.setItem("whisp_seen_project_tour", "true"); } catch { /* ignore */ }
  };

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

  // Опрос состояния текущей задачи
  useEffect(() => {
    if (!job || (job.status !== "QUEUED" && job.status !== "RUNNING")) return;
    const interval = setInterval(async () => {
      try {
        const j = await api.get<Job>(`/api/jobs/${job.id}`);
        setJob(j);
        if (j.status !== "QUEUED" && j.status !== "RUNNING") {
          clearInterval(interval);
          loadAll();
        }
      } catch { /* retry next tick */ }
    }, 800);
    return () => clearInterval(interval);
  }, [job, loadAll]);

  // Защита от случайного закрытия окна при активной задаче (рендеринг, анализ, транскрипция)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (job && (job.status === "QUEUED" || job.status === "RUNNING")) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [job]);

  const running = !!job && (job.status === "QUEUED" || job.status === "RUNNING");

  if (error && !project) {
    return (
      <main className="page">
        <p className="error">{error}</p>
        <button onClick={onClose}>{t("common.back")}</button>
      </main>
    );
  }

  if (!project) return <main className="page"><p className="muted">{t("common.loading")}</p></main>;

  const unreviewed = payload?.stats.unreviewed ?? 0;
  const done: Record<Tab, boolean> = {
    setup: project.has_plan,
    edit: project.has_plan && unreviewed === 0,
    subs: project.has_subtitles,
    export: false,
  };
  const next = (targetTab: Tab) => { setTab(targetTab); window.scrollTo({ top: 0 }); };

  return (
    <div className="project">
      <header className="proj-head">
        <button className="ghost" onClick={onClose}>
          ← {t("nav.projects")}
        </button>
        {editingName ? (
          <input
            autoFocus
            style={{ fontWeight: 700, fontSize: 16, padding: "4px 8px", width: 220 }}
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") setEditingName(false);
            }}
          />
        ) : (
          <span
            className="pname"
            onClick={() => { setNameVal(project.name); setEditingName(true); }}
            title={lang === "ru" ? "Кликните, чтобы переименовать проект" : "Click to rename project"}
            style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {project.name}
            <Icon name="edit" style={{ opacity: 0.5, fontSize: "0.85em" }} />
          </span>
        )}
        {payload && (
          <span className="badge" style={{ marginLeft: 8 }}>
            {fmtTime(payload.stats.output_ms, false)} / {fmtTime(payload.stats.source_ms, false)}
          </span>
        )}
        <nav className="stepper" aria-label="Steps" data-tour="proj-stepper">
          {steps.map(([k, label], i) => (
            <button
              key={k}
              data-tour={`step-${k}`}
              className={`step ${tab === k ? "active" : ""} ${done[k] ? "done" : ""}`}
              onClick={() => setTab(k)}
              aria-current={tab === k ? "step" : undefined}
            >
              <span className="n">{done[k] ? <Icon name="check" /> : i + 1}</span>
              {label}
            </button>
          ))}
        </nav>
        <button className="ghost small" onClick={() => setShowTour(true)} title="Гайд по функциям проекта">
          <Icon name="compass" /> {t("tour.btn")}
        </button>
      </header>

      <main className="page">
        {tab === "setup" && (
          <SetupPanel project={project} payload={payload} busy={running} onJob={setJob} onChanged={loadAll} />
        )}
        {tab === "edit" && (
          payload ? (
            <Editor
              pid={pid}
              project={project}
              payload={payload}
              onPayload={setPayload}
              scenes={scenes}
              wave={wave}
              cues={cues}
              busy={running}
              seekTo={seekTo}
            />
          ) : <NeedsPlan onGo={() => setTab("setup")} />
        )}
        {tab === "subs" && (
          <SubtitlesPanel
            pid={pid}
            project={project}
            cues={cues}
            busy={running}
            onJob={setJob}
            onChanged={loadAll}
            onJump={(ms) => { setSeekTo({ ms, n: Date.now() }); setTab("edit"); }}
            payload={payload}
            onPayload={setPayload}
          />
        )}
        {tab === "export" && (
          payload ? (
            <ExportPanel
              pid={pid}
              project={project}
              payload={payload}
              busy={running}
              onJob={setJob}
              onPayload={setPayload}
            />
          ) : <NeedsPlan onGo={() => setTab("setup")} />
        )}

        {tab === "setup" && project.has_plan && payload && (
          <div className="next-bar">
            <span className="grow">
              {lang === "ru"
                ? `Черновой монтаж готов: убрано ${fmtTime(payload.stats.removed_ms, false)} из ${fmtTime(payload.stats.source_ms, false)}.`
                : `Edit plan ready: removed ${fmtTime(payload.stats.removed_ms, false)} of ${fmtTime(payload.stats.source_ms, false)}.`}
            </span>
            <button className="primary" onClick={() => next("edit")}>
              {lang === "ru" ? "Проверить монтаж" : "Review Cuts"} <Icon name="arrow" />
            </button>
          </div>
        )}
      </main>

      {running && job && <JobDock job={job} onJob={setJob} onDone={loadAll} />}

      {showTour && (
        <TourGuide
          steps={projectSteps}
          isOpen={showTour}
          onClose={() => setShowTour(false)}
          onComplete={finishTour}
          lang={lang}
        />
      )}
    </div>
  );
}
