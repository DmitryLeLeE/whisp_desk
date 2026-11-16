import { useCallback, useEffect, useState } from "react";
import { api, fmtTime } from "../api";
import type { ProjectRow, ProjectSummary } from "../types";
import { hasNativePicker, nativePickFile } from "../native";
import FileBrowser from "./FileBrowser";
import Icon from "./Icon";

const TYPES: Record<string, string> = { lecture: "Лекция", interview: "Интервью", webinar: "Вебинар", custom: "Другое видео" };
const stem = (path: string) => (path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");

export default function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<ProjectSummary[] | null>(null);
  const [type, setType] = useState("lecture");
  const [browse, setBrowse] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => api.get<ProjectSummary[]>("/api/projects/summary").then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const start = async (path: string) => {
    setError(""); setBusy(true); setBrowse(false);
    let created: ProjectRow | null = null;
    try {
      created = await api.post<ProjectRow>("/api/projects", { name: stem(path) || "Новый проект", type });
      await api.put(`/api/projects/${created.id}/source`, { path });
      onOpen(created.id);
    } catch (e) {
      setError((e as Error).message);
      if (created) await api.del(`/api/projects/${created.id}`).catch(() => undefined);   // не оставляем пустой проект после неудачи
      setBusy(false);
    }
  };

  const pick = async () => {
    if (hasNativePicker()) { const p = await nativePickFile(); if (p) start(p); } else setBrowse(true);
  };

  // В окне приложения у перетащенного файла есть настоящий путь (pywebviewFullPath); в обычном браузере его нет.
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0] as (File & { pywebviewFullPath?: string }) | undefined;
    if (f?.pywebviewFullPath) start(f.pywebviewFullPath);
    else setError("Браузер не сообщает путь к перетащенному файлу. Нажмите «Выбрать видео».");
  };

  const remove = async (r: ProjectSummary, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm(`Удалить проект «${r.name}»?\nБудут удалены монтажный план, анализ и результаты проекта. Исходное видео не затрагивается.`)) return;
    try { await api.del(`/api/projects/${r.id}`); load(); } catch (err) { setError((err as Error).message); }
  };

  return (
    <main className="page">
      <div className={`hero ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <Icon name="film" className="icon-big" />
        <div className="grow">
          <h2>Новый проект из видео</h2>
          <p className="muted">Выберите запись лекции, интервью или вебинара. Программа найдёт паузы, соберёт черновой монтаж, расшифрует речь и подготовит готовый файл.
            Исходный файл не копируется и не изменяется.</p>
        </div>
        <div className="col" style={{ alignItems: "stretch", minWidth: 220 }}>
          <button className="primary big" onClick={pick} disabled={busy}><Icon name="plus" /> {busy ? "Создаю проект…" : "Выбрать видео…"}</button>
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Тип записи">
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {browse && <FileBrowser onPick={start} onClose={() => setBrowse(false)} />}

      <div className="page-head"><div><h1>Проекты</h1><p className="muted">Откройте проект, чтобы продолжить работу с того же места.</p></div></div>
      {rows === null ? <p className="muted">Загрузка…</p> : rows.length === 0 ? (
        <div className="empty card"><Icon name="folder" /><b>Проектов пока нет</b><span>Нажмите «Выбрать видео» выше — первый проект создастся сам.</span></div>
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
                <span className="muted small">{TYPES[r.type] ?? r.type}{r.filename ? ` · ${r.filename}` : ""}</span>
                {r.broken ? <span className="badge bad">Проект повреждён</span> : (
                  <div className="steps-mini">
                    <span className={`badge ${r.has_plan ? "ok" : ""}`}>{r.has_plan ? "Анализ ✓" : r.has_source ? "Ждёт анализа" : "Нет видео"}</span>
                    {r.has_plan && <span className={`badge ${r.unreviewed ? "accent" : "ok"}`}>{r.unreviewed ? `Проверить: ${r.unreviewed}` : "Монтаж проверен ✓"}</span>}
                    {r.has_subtitles && <span className="badge ok">Субтитры ✓</span>}
                    {r.rendered && <span className="badge ok">Видео готово ✓</span>}
                  </div>
                )}
                {r.removed_ms ? <span className="muted small">Убрано пауз: {fmtTime(r.removed_ms, false)}</span> : null}
                <div className="row"><span className="muted small grow">Изменён {new Date(r.updated).toLocaleDateString("ru-RU")}</span>
                  <button className="ghost danger" onClick={(e) => remove(r, e)} aria-label="Удалить проект" title="Удалить проект"><Icon name="trash" /></button></div>
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
