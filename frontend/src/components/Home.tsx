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
  const type = "lecture";
  const [browse, setBrowse] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showTour, setShowTour] = useState(false);
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

  return (
    <main className="page">
      {/* Верхняя панель управления */}
      <div className="page-head" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <h1 style={{ margin: 0 }}>{t("home.title")}</h1>
            {rows && rows.length > 0 && (
              <span className="badge" style={{ fontSize: 12, padding: "2px 8px" }}>{rows.length}</span>
            )}
          </div>
          <p className="muted" style={{ marginTop: 2 }}>{t("home.subtitle")}</p>
        </div>

        <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          {rows && rows.length > 0 && (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === "ru" ? "Поиск проектов…" : "Search projects…"}
                style={{ width: 180, padding: "7px 11px", fontSize: 13 }}
              />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as any)}
                style={{ padding: "7px 10px", fontSize: 13 }}
              >
                <option value="updated_desc">{lang === "ru" ? "Сначала новые" : "Recently updated"}</option>
                <option value="updated_asc">{lang === "ru" ? "Сначала старые" : "Oldest first"}</option>
                <option value="name_asc">{lang === "ru" ? "По названию (А–Я)" : "Name (A–Z)"}</option>
                <option value="name_desc">{lang === "ru" ? "По названию (Я–А)" : "Name (Z–A)"}</option>
                <option value="duration_desc">{lang === "ru" ? "По длительности" : "Duration"}</option>
              </select>
            </>
          )}

          <label className="button ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", margin: 0 }} title={lang === "ru" ? "Импортировать проект из архива .whisp" : "Import project from .whisp bundle"}>
            <Icon name="folder" /> <span>{lang === "ru" ? "Импорт .whisp" : "Import .whisp"}</span>
            <input type="file" accept=".whisp,.zip" style={{ display: "none" }} onChange={handleImportBundle} />
          </label>

          <button className="primary" onClick={pick} disabled={busy} data-tour="hero-upload">
            <Icon name="plus" /> {busy ? t("common.loading") : (lang === "ru" ? "Выбрать видео" : "Add Video")}
          </button>

          <button className="ghost" onClick={() => setShowTour(true)} title="Краткий обзор программы">
            <Icon name="help" />
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {browse && <FileBrowser onPick={start} onPickMultiple={(paths) => startBatch(paths)} onClose={() => setBrowse(false)} />}

      {/* Зона перетаскивания файлов */}
      <div
        className={`hero ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        style={{ padding: "16px 20px", marginBottom: 20, cursor: "pointer" }}
        onClick={pick}
      >
        <Icon name="upload" className="icon-big" style={{ width: 28, height: 28 }} />
        <div className="grow">
          <b style={{ fontSize: 14 }}>{lang === "ru" ? "Перетащите видеофайл сюда или нажмите для выбора" : "Drag and drop video here or click to browse"}</b>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {lang === "ru"
              ? "MP4, MOV, MKV, WebM • Автоматически найдет паузы, тишину и синхронизирует субтитры"
              : "MP4, MOV, MKV, WebM • Automatically detects silences and synchronizes speech"}
          </p>
        </div>
        <span className="badge" style={{ fontSize: 11 }}>100% Offline</span>
      </div>

      {/* Сетка проектов */}
      {filteredRows === null ? (
        <p className="muted">{t("common.loading")}</p>
      ) : filteredRows.length === 0 ? (
        <div className="empty card" style={{ padding: "60px 20px" }}>
          <Icon name="film" style={{ width: 44, height: 44, opacity: 0.3 }} />
          <b>{search ? (lang === "ru" ? "Ничего не найдено по запросу" : "No projects match your search") : (lang === "ru" ? "У вас пока нет проектов" : "No projects yet")}</b>
          <p className="muted small" style={{ maxWidth: 400, textAlign: "center" }}>
            {lang === "ru"
              ? "Выберите файл видеозаписи выше, чтобы создать свой первый проект чернового монтажа."
              : "Select a video file above to create your first rough-cut project."}
          </p>
          <button className="primary" onClick={pick} disabled={busy}>
            <Icon name="plus" /> {lang === "ru" ? "Создать первый проект" : "Create First Project"}
          </button>
        </div>
      ) : (
        <div className="proj-grid">
          {filteredRows.map((r) => (
            <a key={r.id} className="proj" href={`#/p/${r.id}`}>
              <div className="thumb">
                {r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <Icon name="film" style={{ width: 36, height: 36, opacity: 0.4 }} />}
                {r.duration_ms ? <span className="dur">{fmtTime(r.duration_ms, false)}</span> : null}
              </div>
              <div className="body">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <b style={{ lineHeight: 1.3 }}>{r.name}</b>
                </div>
                <span className="muted small" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.filename || (typesMap[r.type] ?? r.type)}
                </span>
                {r.broken ? <span className="badge bad">Проект повреждён</span> : (
                  <div className="steps-mini">
                    {r.removed_ms ? (
                      <span className="badge ok">-{fmtTime(r.removed_ms, false)}</span>
                    ) : null}
                    <span className={`badge ${r.has_plan ? "ok" : ""}`}>{r.has_plan ? "Монтаж ✓" : "Ждёт анализа"}</span>
                    {r.has_subtitles && <span className="badge ok">Субтитры ✓</span>}
                    {r.rendered && <span className="badge ok">MP4 ✓</span>}
                  </div>
                )}
                <div className="row" style={{ alignItems: "center", gap: 6, marginTop: 4 }}>
                  <span className="muted small grow">
                    {new Date(r.updated).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", { month: "short", day: "numeric" })}
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
