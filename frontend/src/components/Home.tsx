import { useCallback, useEffect, useState } from "react";
import { api, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import { hasNativePicker, nativePickFile } from "../native";
import type { ProjectRow, ProjectSummary } from "../types";
import FileBrowser from "./FileBrowser";
import Icon from "./Icon";
import TourGuide, { TourStep } from "./TourGuide";

const stem = (path: string) => (path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");

export default function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, lang } = useTranslation();
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const [type, setType] = useState("lecture");
  const [browse, setBrowse] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showTour, setShowTour] = useState(false);
  const [showQuickStart, setShowQuickStart] = useState(() => {
    try { return localStorage.getItem("whisp_hide_quickstart") !== "true"; } catch { return true; }
  });

  const homeSteps: TourStep[] = [
    {
      id: "step-upload",
      targetSelector: '[data-tour="hero-upload"]',
      title: t("tour.home.step1.title"),
      content: t("tour.home.step1.desc"),
      placement: "bottom",
    },
    {
      id: "step-type",
      targetSelector: '[data-tour="content-type"]',
      title: t("tour.home.step2.title"),
      content: t("tour.home.step2.desc"),
      placement: "bottom",
    },
    {
      id: "step-status",
      targetSelector: '[data-tour="nav-status"]',
      title: t("tour.home.step3.title"),
      content: t("tour.home.step3.desc"),
      placement: "right",
    },
    {
      id: "step-shortcuts",
      targetSelector: '[data-tour="shortcuts-btn"]',
      title: t("tour.home.step4.title"),
      content: t("tour.home.step4.desc"),
      placement: "right",
    },
  ];

  const typesMap: Record<string, string> = {
    lecture: t("home.modal.type.lecture"),
    interview: t("home.modal.type.interview"),
    podcast: t("home.modal.type.podcast"),
    custom: t("home.modal.type.generic"),
  };

  const load = useCallback(() => api.get<ProjectSummary[]>("/api/projects/summary").then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const start = async (path: string) => {
    setError(""); setBusy(true); setBrowse(false);
    let created: ProjectRow | null = null;
    try {
      const defaultName = stem(path) || (lang === "ru" ? "Новый проект" : "New Project");
      created = await api.post<ProjectRow>("/api/projects", { name: defaultName, type });
      await api.put(`/api/projects/${created.id}/source`, { path });
      onOpen(created.id);
    } catch (e) {
      setError((e as Error).message);
      if (created) await api.del(`/api/projects/${created.id}`).catch(() => undefined);
      setBusy(false);
    }
  };

  const pick = async () => {
    if (hasNativePicker()) { const p = await nativePickFile(); if (p) start(p); } else setBrowse(true);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0] as (File & { pywebviewFullPath?: string }) | undefined;
    if (f?.pywebviewFullPath) start(f.pywebviewFullPath);
    else setError(lang === "ru" ? "Браузер не сообщает путь к перетащенному файлу. Нажмите «Выбрать видео»." : "Browser does not provide local path. Click 'Choose Video'.");
  };

  const remove = async (r: ProjectSummary, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm(lang === "ru"
      ? `Удалить проект «${r.name}»?\nБудут удалены монтажный план, анализ и результаты проекта. Исходное видео не затрагивается.`
      : `Delete project "${r.name}"?\nEdit plan, analysis and export files will be deleted. Source video is untouched.`)) return;
    try { await api.del(`/api/projects/${r.id}`); load(); } catch (err) { setError((err as Error).message); }
  };

  useEffect(() => {
    try {
      const seen = localStorage.getItem("whisp_seen_home_tour");
      if (!seen) {
        // Запускаем тур при первом знакомстве с программой
        const timer = setTimeout(() => setShowTour(true), 600);
        return () => clearTimeout(timer);
      }
    } catch { /* ignore */ }
  }, []);

  const finishTour = () => {
    setShowTour(false);
    try { localStorage.setItem("whisp_seen_home_tour", "true"); } catch { /* ignore */ }
  };

  const toggleQuickStart = () => {
    setShowQuickStart((prev) => {
      const next = !prev;
      try { localStorage.setItem("whisp_hide_quickstart", next ? "false" : "true"); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <main className="page">
      {/* Карточка быстрого старта и обучения */}
      <div className="quick-start-box">
        <div className="quick-start-head">
          <div className="row" style={{ gap: 10 }}>
            <Icon name="sparkles" style={{ color: "var(--accent)" }} />
            <b style={{ fontSize: 15 }}>{t("quickstart.title")}</b>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary small" onClick={() => setShowTour(true)} title="Запустить тур со стрелочками">
              <Icon name="compass" /> {t("quickstart.btn_tour")}
            </button>
            <button className="ghost small" onClick={toggleQuickStart}>
              {showQuickStart ? (lang === "ru" ? "Свернуть" : "Collapse") : (lang === "ru" ? "Развернуть" : "Expand")}
            </button>
          </div>
        </div>

        {showQuickStart && (
          <div className="quick-start-steps">
            <div className="quick-step-card">
              <span className="num">1</span>
              <b>{t("quickstart.step1.title")}</b>
              <p>{t("quickstart.step1.desc")}</p>
            </div>
            <div className="quick-step-card">
              <span className="num">2</span>
              <b>{t("quickstart.step2.title")}</b>
              <p>{t("quickstart.step2.desc")}</p>
            </div>
            <div className="quick-step-card">
              <span className="num">3</span>
              <b>{t("quickstart.step3.title")}</b>
              <p>{t("quickstart.step3.desc")}</p>
            </div>
            <div className="quick-step-card">
              <span className="num">4</span>
              <b>{t("quickstart.step4.title")}</b>
              <p>{t("quickstart.step4.desc")}</p>
            </div>
          </div>
        )}
      </div>

      <div
        className={`hero ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        data-tour="hero-upload"
      >
        <Icon name="film" className="icon-big" />
        <div className="grow">
          <h2>{lang === "ru" ? "Новый проект из видео" : "New Project from Video"}</h2>
          <p className="muted">
            {lang === "ru"
              ? "Выберите запись лекции, интервью или вебинара. Программа найдёт паузы, соберёт черновой монтаж, перенесёт субтитры и экспортирует проект в Premiere, DaVinci и MP4."
              : "Select a video lecture, interview, or webinar. Automatically detects silences, synchronizes subtitles, and exports to Premiere Pro, DaVinci Resolve, and MP4."}
          </p>
        </div>
        <div className="col" style={{ alignItems: "stretch", minWidth: 220 }} data-tour="content-type">
          <button className="primary big" onClick={pick} disabled={busy}>
            <Icon name="plus" /> {busy ? t("common.loading") : (lang === "ru" ? "Выбрать видео…" : "Choose Video…")}
          </button>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
            {Object.entries(typesMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {browse && <FileBrowser onPick={start} onClose={() => setBrowse(false)} />}

      <div className="page-head">
        <div>
          <h1>{t("home.title")}</h1>
          <p className="muted">{t("home.subtitle")}</p>
        </div>
      </div>

      {rows === null ? (
        <p className="muted">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <div className="empty card">
          <Icon name="folder" />
          <b>{t("home.empty")}</b>
        </div>
      ) : (
        <div className="proj-grid">
          {rows.map((r) => (
            <a key={r.id} className="proj" href={`#/p/${r.id}`}>
              <div className="thumb">
                {r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <Icon name="film" className="icon-big" />}
                {r.duration_ms ? <span className="dur">{fmtTime(r.duration_ms, false)}</span> : null}
              </div>
              <div className="body">
                <b>{r.name}</b>
                <span className="muted small">{typesMap[r.type] ?? r.type}{r.filename ? ` · ${r.filename}` : ""}</span>
                {r.broken ? <span className="badge bad">Проект повреждён</span> : (
                  <div className="steps-mini">
                    <span className={`badge ${r.has_plan ? "ok" : ""}`}>{r.has_plan ? "Анализ ✓" : r.has_source ? "Ждёт анализа" : "Нет видео"}</span>
                    {r.has_plan && <span className={`badge ${r.unreviewed ? "warn" : "ok"}`}>{r.unreviewed ? `Проверить: ${r.unreviewed}` : "Проверен ✓"}</span>}
                    {r.has_subtitles && <span className="badge ok">Субтитры ✓</span>}
                    {r.rendered && <span className="badge ok">MP4 ✓</span>}
                  </div>
                )}
                {r.removed_ms ? <span className="muted small" style={{ color: "var(--keep)" }}>Убрано: {fmtTime(r.removed_ms, false)}</span> : null}
                <div className="row">
                  <span className="muted small grow">
                    {new Date(r.updated).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US")}
                  </span>
                  <button className="ghost danger" onClick={(e) => remove(r, e)} aria-label="Удалить проект" title={t("common.delete")}>
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {showTour && (
        <TourGuide
          steps={homeSteps}
          isOpen={showTour}
          onClose={() => setShowTour(false)}
          onComplete={finishTour}
          lang={lang}
        />
      )}
    </main>
  );
}
