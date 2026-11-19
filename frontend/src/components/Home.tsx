import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"updated_desc" | "updated_asc" | "name_asc" | "name_desc" | "duration_desc">("updated_desc");

  const duplicate = async (r: ProjectSummary, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    try {
      await api.post(`/api/projects/${r.id}/duplicate`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    let list = rows.filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return r.name.toLowerCase().includes(q) || (r.filename && r.filename.toLowerCase().includes(q)) || r.id.toLowerCase().includes(q);
    });

    list = [...list].sort((a, b) => {
      if (sortKey === "updated_desc") return new Date(b.updated).getTime() - new Date(a.updated).getTime();
      if (sortKey === "updated_asc") return new Date(a.updated).getTime() - new Date(b.updated).getTime();
      if (sortKey === "name_asc") return a.name.localeCompare(b.name);
      if (sortKey === "name_desc") return b.name.localeCompare(a.name);
      if (sortKey === "duration_desc") return (b.duration_ms || 0) - (a.duration_ms || 0);
      return 0;
    });
    return list;
  }, [rows, search, sortKey]);

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

  const startBatch = async (paths: string[], autoAnalyze = false) => {
    setError(""); setBusy(true); setBrowse(false);
    try {
      const res = await api.post<{ created: { id: string; name: string }[]; count: number }>("/api/projects/batch", {
        paths,
        type,
        auto_analyze: autoAnalyze,
        profile: "standard",
      });
      load();
      setBusy(false);
      if (res.count === 1 && !autoAnalyze) {
        onOpen(res.created[0].id);
      } else {
        alert(lang === "ru" ? `Успешно создано проектов: ${res.count}` : `Successfully created ${res.count} projects`);
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const pick = async () => {
    if (hasNativePicker()) { const p = await nativePickFile(); if (p) start(p); } else setBrowse(true);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const files = Array.from(e.dataTransfer.files) as (File & { pywebviewFullPath?: string })[];
    const valid = files.map((f) => f.pywebviewFullPath).filter(Boolean) as string[];
    if (valid.length > 1) {
      startBatch(valid);
    } else if (valid.length === 1) {
      start(valid[0]);
    } else {
      setError(lang === "ru" ? "Браузер не сообщает путь к перетащенному файлу. Нажмите «Выбрать видео»." : "Browser does not provide local path. Click 'Choose Video'.");
    }
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
      {browse && <FileBrowser onPick={start} onPickMultiple={(paths) => startBatch(paths)} onClose={() => setBrowse(false)} />}

      <div className="page-head" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>{t("home.title")} {rows && rows.length > 0 && <span className="muted" style={{ fontSize: 18, fontWeight: 500 }}>({rows.length})</span>}</h1>
          <p className="muted">{t("home.subtitle")}</p>
        </div>
        {rows && rows.length > 0 && (
          <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "ru" ? "Поиск проектов…" : "Search projects…"}
              style={{ width: 200, padding: "6px 10px", fontSize: 13 }}
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as any)}
              style={{ padding: "6px 10px", fontSize: 13 }}
            >
              <option value="updated_desc">{lang === "ru" ? "Сначала новые" : "Recently updated"}</option>
              <option value="updated_asc">{lang === "ru" ? "Сначала старые" : "Oldest first"}</option>
              <option value="name_asc">{lang === "ru" ? "По названию (А–Я)" : "Name (A–Z)"}</option>
              <option value="name_desc">{lang === "ru" ? "По названию (Я–А)" : "Name (Z–A)"}</option>
              <option value="duration_desc">{lang === "ru" ? "По длительности" : "Duration"}</option>
            </select>
          </div>
        )}
      </div>

      {filteredRows === null ? (
        <p className="muted">{t("common.loading")}</p>
      ) : filteredRows.length === 0 ? (
        <div className="empty card">
          <Icon name="folder" />
          <b>{search ? (lang === "ru" ? "Ничего не найдено по запросу" : "No projects match your search") : t("home.empty")}</b>
        </div>
      ) : (
        <div className="proj-grid">
          {filteredRows.map((r) => (
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
                <div className="row" style={{ alignItems: "center", gap: 4 }}>
                  <span className="muted small grow">
                    {new Date(r.updated).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US")}
                  </span>
                  <button className="ghost small" onClick={(e) => duplicate(r, e)} aria-label="Дублировать проект" title={lang === "ru" ? "Создать копию проекта" : "Duplicate Project"}>
                    <Icon name="copy" />
                  </button>
                  <button className="ghost danger small" onClick={(e) => remove(r, e)} aria-label="Удалить проект" title={t("common.delete")}>
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
