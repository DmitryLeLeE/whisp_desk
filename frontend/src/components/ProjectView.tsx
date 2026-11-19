import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import type { Cue, Job, PlanPayload, Project, Scenes, SettingsData, Waveform } from "../types";
import Editor from "./Editor";
import ExportPanel from "./ExportPanel";
import Icon from "./Icon";
import JobDock from "./JobDock";
import SetupPanel from "./SetupPanel";
import SubtitlesPanel from "./SubtitlesPanel";
import TourGuide, { TourStep } from "./TourGuide";

type Tab = "setup" | "edit" | "subs" | "export";

interface Props {
  pid: string;
  onClose: () => void;
  sys?: SettingsData | null;
  theme?: string;
  onToggleTheme?: () => void;
  onOpenShortcuts?: () => void;
}

function NeedsPlan({ onGo }: { onGo: () => void }) {
  const { lang } = useTranslation();
  return (
    <div className="empty card nle-panel-card" style={{ maxWidth: 540, margin: "60px auto" }}>
      <Icon name="scissors" style={{ width: 44, height: 44, color: "var(--accent)" }} />
      <b style={{ fontSize: 16 }}>{lang === "ru" ? "Сначала нужен черновой монтаж" : "Analysis required first"}</b>
      <span className="muted" style={{ textAlign: "center" }}>
        {lang === "ru"
          ? "Выберите видео и запустите анализ: программа найдёт паузы и создаст монтажный план."
          : "Select a video and run analysis to detect silences and create an edit plan."}
      </span>
      <button className="primary big" onClick={onGo} style={{ marginTop: 8 }}>
        {lang === "ru" ? "К анализу и исходникам" : "Go to Media Setup"}
      </button>
    </div>
  );
}

export default function ProjectView({ pid, onClose, sys, theme, onToggleTheme, onOpenShortcuts }: Props) {
  const { t, lang } = useTranslation();
  const [project, setProject] = useState<Project | null>(null);
  const [payload, setPayload] = useState<PlanPayload | null>(null);
  const [scenes, setScenes] = useState<Scenes | null>(null);
  const [wave, setWave] = useState<Waveform | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  // Системное уведомление, если долгая задача закончилась, пока окно было свёрнуто
  const notified = useRef<number | null>(null);
  useEffect(() => {
    if (!job || (job.status !== "COMPLETED" && job.status !== "FAILED") || notified.current === job.id) return;
    notified.current = job.id;
    if (!document.hidden || typeof Notification === "undefined") return;
    const show = () => new Notification("WHISP MEDIA DESK", {
      body: job.status === "COMPLETED" ? (lang === "ru" ? "Задача завершена" : "Task finished") : (lang === "ru" ? "Задача завершилась с ошибкой" : "Task failed"),
    });
    if (Notification.permission === "granted") show();
    else if (Notification.permission === "default") Notification.requestPermission().then((r) => { if (r === "granted") show(); });
  }, [job, lang]);
  const [tab, setTab] = useState<Tab>("setup");
  useEffect(() => { try { localStorage.setItem(`whisp_tab_${pid}`, tab); } catch { /* ignore */ } }, [tab, pid]);
  const [error, setError] = useState("");
  const [seekTo, setSeekTo] = useState<{ ms: number; n: number } | null>(null);
  const [showTour, setShowTour] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const firstLoad = useRef(true);
  const autoRan = useRef(false);
  const autoAbort = useRef(false);
  const [autoNote, setAutoNote] = useState("");

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

  const steps: [Tab, string, string][] = [
    ["setup", t("step.setup"), "sliders"],
    ["edit", t("step.editor"), "scissors"],
    ["subs", t("step.subtitles"), "captions"],
    ["export", t("step.export"), "download"],
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
      if (firstLoad.current) { firstLoad.current = false; { let saved: string | null = null; try { saved = localStorage.getItem(`whisp_tab_${pid}`); } catch { /* ignore */ } setTab(p.has_plan ? ((saved === "export" || saved === "subs" || saved === "edit") ? (saved as Tab) : "edit") : "setup"); } }
    } catch (e) { setError((e as Error).message); }
  }, [pid]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Быстрый старт: цепочка «поиск пауз → расшифровка», выбранная в диалоге при добавлении видео
  useEffect(() => {
    if (!project || autoRan.current) return;
    autoRan.current = true;
    const key = `whisp_autorun_${pid}`;
    let cfg: { profile: string; transcribe: boolean; language: string } | null = null;
    try { const raw = localStorage.getItem(key); if (raw) cfg = JSON.parse(raw); localStorage.removeItem(key); } catch { /* ignore */ }
    if (!cfg || !project.source) return;
    const plan = cfg;
    const wait = async (j: Job): Promise<Job> => {
      setJob(j);
      let cur = j;
      while (cur.status === "QUEUED" || cur.status === "RUNNING") {
        if (autoAbort.current) { try { await api.post(`/api/jobs/${cur.id}/cancel`); } catch { /* ignore */ } }
        await new Promise((r) => setTimeout(r, 800));
        cur = await api.get<Job>(`/api/jobs/${cur.id}`);
        setJob(cur);
      }
      return cur;
    };
    (async () => {
      try {
        setAutoNote(lang === "ru" ? (plan.transcribe ? "Шаг 1 из 2: ищем паузы…" : "Ищем паузы…") : (plan.transcribe ? "Step 1 of 2: finding pauses…" : "Finding pauses…"));
        const a = await wait(await api.post<Job>(`/api/projects/${pid}/analyze`, {
          profile: plan.profile, overrides: {}, audio_stream: project.settings.audio_stream, detect_scenes: true, engine: "builtin", auto_threshold: true, denoise: false,
        }));
        if (autoAbort.current) { setAutoNote(""); await loadAll(); return; }
        if (a.status !== "COMPLETED") { setError(a.error || (lang === "ru" ? "Не удалось найти паузы" : "Could not detect pauses")); setAutoNote(""); await loadAll(); return; }
        await loadAll();
        setTab("edit");
        if (plan.transcribe && !autoAbort.current) {
          setAutoNote(lang === "ru" ? "Шаг 2 из 2: распознаём речь (при первом запуске скачивается модель)…" : "Step 2 of 2: transcribing speech (a model downloads on first run)…");
          const tr = await wait(await api.post<Job>(`/api/projects/${pid}/subtitles/transcribe`, {
            model: "turbo", language: plan.language, device: "auto", overwrite: false, translate_to: "", task: "transcribe", max_line_chars: 0, vad: true, initial_prompt: "",
          }));
          if (tr.status !== "COMPLETED") setError((tr.error || (lang === "ru" ? "Не удалось распознать речь" : "Transcription failed")) + (lang === "ru" ? ". Паузы уже найдены; расшифровку можно запустить на шаге «Субтитры»." : ". Pauses are already found; you can run transcription on the Subtitles step."));
        }
        setAutoNote("");
        await loadAll();
      } catch (e) { setError((e as Error).message); setAutoNote(""); }
    })();
  }, [project, pid, loadAll]);

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

  // Защита от случайного закрытия окна при активной задаче
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
  const tTools = sys?.tools;

  if (error && !project) {
    return (
      <main className="page">
        <p className="error">{error}</p>
        <button onClick={onClose}>{t("common.back")}</button>
      </main>
    );
  }

  if (!project) return <div className="nle-workstation" style={{ display: "grid", placeItems: "center" }}><p className="muted">{t("common.loading")}</p></div>;

  const unreviewed = payload?.stats.unreviewed ?? 0;
  const done: Record<Tab, boolean> = {
    setup: project.has_plan,
    edit: project.has_plan && unreviewed === 0,
    subs: project.has_subtitles,
    export: false,
  };
  const next = (targetTab: Tab) => { setTab(targetTab); window.scrollTo({ top: 0 }); };

  return (
    <div className="nle-workstation">
      <header className="nle-header">
        <div className="nle-header-left">
          <button className="nle-back-btn" onClick={onClose} title={t("nav.projects")}>
            <Icon name="arrow-left" /> <span>{t("nav.projects")}</span>
          </button>
          <div className="nle-proj-title-wrap">
            {editingName ? (
              <input
                autoFocus
                className="nle-name-input"
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
                className="nle-pname"
                onClick={() => { setNameVal(project.name); setEditingName(true); }}
                title={lang === "ru" ? "Кликните для переименования проекта" : "Click to rename project"}
              >
                {project.name}
                <Icon name="edit" className="edit-ico" />
              </span>
            )}
            {payload && (
              <div className="nle-stats-pill-group">
                <span className="nle-badge-dur" title={lang === "ru" ? "Итоговый хронометраж" : "Output duration"}>
                  {fmtTime(payload.stats.output_ms, false)}
                </span>
                {payload.stats.source_ms > payload.stats.output_ms && (
                  <span className="nle-badge-saved" title={lang === "ru" ? "Сокращение хронометража" : "Time saved"}>
                    -{Math.round(((payload.stats.source_ms - payload.stats.output_ms) / payload.stats.source_ms) * 100)}%
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* DaVinci Resolve Iconic Workspace Switcher */}
        <nav className="nle-workspaces" aria-label="Workspaces" data-tour="proj-stepper">
          {steps.map(([k, label, icon]) => (
            <button
              key={k}
              data-tour={`step-${k}`}
              className={`nle-workspace-tab ${tab === k ? "active" : ""} ${done[k] ? "done" : ""}`}
              onClick={() => setTab(k)}
              aria-current={tab === k ? "step" : undefined}
            >
              <Icon name={done[k] ? "check" : icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="nle-header-right">
          {tTools && (
            <div className="nle-engine-status mini">
              <span className="engine-pill" title={`FFmpeg: ${tTools.ffmpeg.available ? "OK" : "Missing"}`}>
                <span className={`dot ${tTools.ffmpeg.available ? "on" : "off"}`} /> FFmpeg
              </span>
              <span className="engine-pill" title={`Whisp: ${tTools.whisp.available ? "OK" : "Missing"}`}>
                <span className={`dot ${tTools.whisp.available ? "on" : "off"}`} /> Whisp
              </span>
            </div>
          )}
          <a
            href={`/api/projects/${pid}/bundle`}
            download={`${pid}.whisp`}
            className="nle-btn-ghost small"
            title={lang === "ru" ? "Экспорт компактного переносимого архива проекта (.whisp)" : "Export portable project archive (.whisp)"}
          >
            <Icon name="download" /> <span>.whisp</span>
          </a>
          <button className="nle-btn-ghost small" onClick={() => setShowTour(true)} title={lang === "ru" ? "Обзор программы" : "App tour"}>
            <Icon name="compass" />
          </button>
          {onOpenShortcuts && (
            <button className="nle-btn-ghost small" onClick={onOpenShortcuts} title={t("common.help")}>
              <Icon name="help" />
            </button>
          )}
          {onToggleTheme && (
            <button className="nle-btn-ghost small" onClick={onToggleTheme} title={lang === "ru" ? "Тема" : "Theme"}>
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </button>
          )}
        </div>
      </header>

      <main className={`nle-workspace-body ${tab === "edit" ? "editor-full" : "panel-scrollable"}`}>
        {tab === "setup" && (
          <div className="nle-centered-pane">
            <SetupPanel project={project} payload={payload} busy={running} onJob={setJob} onChanged={loadAll} />
          </div>
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
          <div className="nle-centered-pane" style={{ maxWidth: 1600 }}>
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
          </div>
        )}
        {tab === "export" && (
          <div className="nle-centered-pane">
            {payload ? (
              <ExportPanel
                pid={pid}
                project={project}
                payload={payload}
                busy={running}
                onJob={setJob}
                onPayload={setPayload}
                doneJob={job}
              />
            ) : <NeedsPlan onGo={() => setTab("setup")} />}
          </div>
        )}

        {tab === "setup" && project.has_plan && payload && (
          <div className="next-bar nle-next-bar">
            <span className="grow">
              {lang === "ru"
                ? `Черновой монтаж готов: убрано ${fmtTime(payload.stats.removed_ms, false)} из ${fmtTime(payload.stats.source_ms, false)}.`
                : `Edit plan ready: removed ${fmtTime(payload.stats.removed_ms, false)} of ${fmtTime(payload.stats.source_ms, false)}.`}
            </span>
            <button className="primary" onClick={() => next("edit")}>
              {lang === "ru" ? "Перейти к монтажу" : "Proceed to Edit"} <Icon name="arrow" />
            </button>
          </div>
        )}
      </main>

      {autoNote && <div className="auto-banner" role="status"><span className="spinner" /> {autoNote}<button onClick={() => { autoAbort.current = true; setAutoNote(lang === "ru" ? "Останавливаем…" : "Stopping…"); }}>{lang === "ru" ? "Остановить" : "Stop"}</button></div>}
      {error && !autoNote && <div className="auto-banner bad" role="alert"><span>{error}</span><button className="btn-icon" onClick={() => setError("")} aria-label={lang === "ru" ? "Закрыть" : "Close"}>✕</button></div>}
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
