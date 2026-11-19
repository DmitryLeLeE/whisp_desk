import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import { hasNativePicker, nativePickFile } from "../native";
import type { ProjectRow, ProjectSummary } from "../types";
import FileBrowser from "./FileBrowser";
import Icon from "./Icon";
import TourGuide, { TourStep } from "./TourGuide";
import BatchModal from "./BatchModal";

const stem = (path: string) => (path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");

export default function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, lang } = useTranslation();
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const type = "lecture";
  const [browse, setBrowse] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showTour, setShowTour] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem("home.view") === "list" ? "list" : "grid"));
  const setViewMode = (v: "grid" | "list") => { setView(v); try { localStorage.setItem("home.view", v); } catch { /* ignore */ } };
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

  const handleImportBundle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(""); setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/projects/import-bundle", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errJson.detail || "Ошибка импорта архива .whisp");
      }
      const data = await res.json();
      await load();
      if (data.id) onOpen(data.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

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

  const uploadAndStart = async (file: File) => {
    setError(""); setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/projects/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await res.text());
      const p = await res.json();
      onOpen(p.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const rawFiles = Array.from(e.dataTransfer.files) as (File & { pywebviewFullPath?: string; path?: string })[];
    if (!rawFiles.length) return;

    const valid = rawFiles.map((f) => f.pywebviewFullPath || (f as any).path).filter(Boolean) as string[];
    if (valid.length > 1) {
      startBatch(valid);
    } else if (valid.length === 1) {
      start(valid[0]);
    } else {
      uploadAndStart(rawFiles[0]);
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

  return (
    <main
      className="nle-manager-page"
      onDragOver={(e) => {
        e.preventDefault();
        if (!drag) setDrag(true);
      }}
    >
      {drag && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDrag(false);
          }}
          onDrop={onDrop}
          className="nle-drag-overlay"
        >
          <Icon name="upload" style={{ width: 48, height: 48, color: "var(--accent)", marginBottom: 12 }} />
          <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700 }}>
            {lang === "ru" ? "Отпустите видеофайл для создания проекта" : "Drop video file to create project"}
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            MP4, MOV, MKV, WebM
          </p>
        </div>
      )}

      {/* Верхняя панель управления Project Manager */}
      <div className="nle-manager-toolbar">
        <div className="nle-manager-title-wrap">
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <h1 className="nle-page-title">{t("home.title")}</h1>
            {rows && rows.length > 0 && (
              <span className="nle-counter-badge">{rows.length}</span>
            )}
          </div>
          <p className="muted small" style={{ marginTop: 2 }}>{t("home.subtitle")}</p>
        </div>

        <div className="nle-manager-actions">
          {rows && rows.length > 0 && (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === "ru" ? "Поиск проектов…" : "Search projects…"}
                className="nle-search-input"
              />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as any)}
                className="nle-select"
              >
                <option value="updated_desc">{lang === "ru" ? "Сначала новые" : "Recently updated"}</option>
                <option value="updated_asc">{lang === "ru" ? "Сначала старые" : "Oldest first"}</option>
                <option value="name_asc">{lang === "ru" ? "По названию (А–Я)" : "Name (A–Z)"}</option>
                <option value="name_desc">{lang === "ru" ? "По названию (Я–А)" : "Name (Z–A)"}</option>
                <option value="duration_desc">{lang === "ru" ? "По длительности" : "Duration"}</option>
              </select>
            </>
          )}

          <div className="seg" role="group" aria-label="Вид">
            <button className={view === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} title={lang === "ru" ? "Карточки" : "Grid"}>▦</button>
            <button className={view === "list" ? "active" : ""} onClick={() => setViewMode("list")} title={lang === "ru" ? "Список" : "List"}>☰</button>
          </div>

          <button
            className="nle-btn-ghost"
            onClick={() => setBatchOpen(true)}
            title={lang === "ru" ? "Пакетная обработка нескольких видео" : "Batch process multiple videos"}
          >
            <Icon name="folder" /> <span>{lang === "ru" ? "Пакетная очередь" : "Batch Queue"}</span>
          </button>

          <label
            className="nle-btn-ghost"
            style={{ cursor: "pointer", margin: 0 }}
            title={lang === "ru" ? "Импортировать проект из архива .whisp" : "Import project from .whisp bundle"}
          >
            <Icon name="download" /> <span>{lang === "ru" ? "Импорт .whisp" : "Import .whisp"}</span>
            <input type="file" accept=".whisp,.zip" style={{ display: "none" }} onChange={handleImportBundle} />
          </label>

          <button className="primary" onClick={pick} disabled={busy} data-tour="hero-upload">
            <Icon name="plus" /> {busy ? t("common.loading") : (lang === "ru" ? "Добавить видео" : "Add Video")}
          </button>

          <button className="nle-btn-ghost small" onClick={() => setShowTour(true)} title="Краткий обзор программы">
            <Icon name="help" />
          </button>
        </div>
      </div>

      {error && <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div>}
      {browse && <FileBrowser onPick={start} onPickMultiple={(paths) => startBatch(paths)} onClose={() => setBrowse(false)} />}
      {batchOpen && <BatchModal onClose={() => setBatchOpen(false)} onCreated={load} />}

      {/* Зона перетаскивания файлов */}
      <div
        className={`nle-drop-banner ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={pick}
      >
        <div className="nle-drop-icon-box">
          <Icon name="upload" style={{ width: 28, height: 28, color: "var(--accent)" }} />
        </div>
        <div className="grow">
          <b style={{ fontSize: 14 }}>{lang === "ru" ? "Перетащите видеофайл сюда или кликните для выбора" : "Drag and drop video here or click to browse"}</b>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {lang === "ru"
              ? "MP4, MOV, MKV, WebM • Автоматическое распознавание пауз, речи Whisper и смены сцен"
              : "MP4, MOV, MKV, WebM • Audio silence analysis & subtitle sync"}
          </p>
        </div>
        <button className="nle-btn-ghost small" onClick={(e) => { e.stopPropagation(); pick(); }} style={{ pointerEvents: "auto" }}>
          <Icon name="folder" /> {lang === "ru" ? "Выбрать на диске" : "Browse"}
        </button>
      </div>

      {/* Сетка проектов */}
      {filteredRows === null ? (
        <div className="empty" style={{ padding: 60 }}><p className="muted">{t("common.loading")}</p></div>
      ) : filteredRows.length === 0 ? (
        <div className="empty card nle-panel-card" style={{ padding: "60px 20px", maxWidth: 520, margin: "40px auto" }}>
          <Icon name="film" style={{ width: 44, height: 44, opacity: 0.3 }} />
          <b>{search ? (lang === "ru" ? "Ничего не найдено по запросу" : "No projects match your search") : (lang === "ru" ? "У вас пока нет проектов" : "No projects yet")}</b>
          <p className="muted small" style={{ maxWidth: 400, textAlign: "center" }}>
            {lang === "ru"
              ? "Выберите файл видеозаписи выше, чтобы создать свой первый проект чернового монтажа."
              : "Select a video file above to create your first rough-cut project."}
          </p>
          <button className="primary big" onClick={pick} disabled={busy}>
            <Icon name="plus" /> {lang === "ru" ? "Создать первый проект" : "Create First Project"}
          </button>
        </div>
      ) : view === "list" ? (
        <table className="proj-table">
          <thead>
            <tr>
              <th></th>
              <th>{lang === "ru" ? "Название" : "Name"}</th>
              <th>{lang === "ru" ? "Длительность" : "Duration"}</th>
              <th>{lang === "ru" ? "Убрано" : "Removed"}</th>
              <th>{lang === "ru" ? "Состояние" : "Status"}</th>
              <th>{lang === "ru" ? "Изменён" : "Modified"}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.id} onClick={() => { location.hash = `#/p/${r.id}`; }}>
                <td className="pt-thumb">{r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <Icon name="film" />}</td>
                <td><b>{r.name}</b><div className="muted small">{r.filename || (typesMap[r.type] ?? r.type)}</div></td>
                <td className="mono">{r.duration_ms ? fmtTime(r.duration_ms, false) : "—"}</td>
                <td className="mono">{r.removed_ms ? `-${fmtTime(r.removed_ms, false)}` : "—"}</td>
                <td>
                  {r.broken ? <span className="badge bad">Проект повреждён</span> : (
                    <span className="steps-mini">
                      <span className={`badge ${r.has_plan ? "ok" : ""}`}>{r.has_plan ? "Монтаж готов" : "Ждёт анализа"}</span>
                      {r.has_subtitles && <span className="badge ok">Субтитры</span>}
                      {r.rendered && <span className="badge ok">Видео</span>}
                    </span>
                  )}
                </td>
                <td className="muted small">{new Date(r.updated).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "short", year: "numeric" })}</td>
                <td className="pt-actions">
                  <button className="nle-btn-micro" onClick={(e) => duplicate(r, e)} aria-label="Дублировать проект" title={lang === "ru" ? "Создать копию проекта" : "Duplicate Project"}><Icon name="copy" /></button>
                  <button className="nle-btn-micro danger" onClick={(e) => remove(r, e)} aria-label="Удалить проект" title={t("common.delete")}><Icon name="trash" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="nle-proj-grid">
          {filteredRows.map((r) => (
            <a key={r.id} className="nle-proj-card" href={`#/p/${r.id}`}>
              <div className="thumb">
                {r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <Icon name="film" style={{ width: 36, height: 36, opacity: 0.4 }} />}
                {r.duration_ms ? <span className="dur">{fmtTime(r.duration_ms, false)}</span> : null}
                {r.removed_ms ? <span className="saved-badge">-{fmtTime(r.removed_ms, false)}</span> : null}
              </div>
              <div className="body">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <b className="pname-text">{r.name}</b>
                </div>
                <span className="muted small file-sub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.filename || (typesMap[r.type] ?? r.type)}
                </span>
                {r.broken ? <span className="badge bad">Проект повреждён</span> : (
                  <div className="steps-mini">
                    <span className={`badge ${r.has_plan ? "ok" : ""}`}>{r.has_plan ? "Монтаж готов" : "Ждёт анализа"}</span>
                    {r.has_subtitles && <span className="badge ok">Есть субтитры</span>}
                    {r.rendered && <span className="badge ok">Видео собрано</span>}
                  </div>
                )}
                <div className="row" style={{ alignItems: "center", gap: 6, marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                  <span className="muted small grow">
                    {new Date(r.updated).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", { month: "short", day: "numeric" })}
                  </span>
                  <button className="nle-btn-micro" onClick={(e) => duplicate(r, e)} aria-label="Дублировать проект" title={lang === "ru" ? "Создать копию проекта" : "Duplicate Project"}>
                    <Icon name="copy" />
                  </button>
                  <button className="nle-btn-micro danger" onClick={(e) => remove(r, e)} aria-label="Удалить проект" title={t("common.delete")}>
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
