import { useEffect, useState } from "react";
import { api, fmtSize } from "../api";
import type { FsListing } from "../types";
import { useTranslation } from "../i18n";
import Icon from "./Icon";

interface Place { name: string; path: string }

interface Props {
  onPick: (path: string) => void;
  onPickMultiple?: (paths: string[]) => void;
  onClose: () => void;
  mode?: "file" | "dir";
}

/** Встроенный выбор файла или папки (когда нет окна приложения с системным диалогом). */
export default function FileBrowser({ onPick, onPickMultiple, onClose, mode = "file" }: Props) {
  const { lang } = useTranslation();
  const ru = lang === "ru";
  const [listing, setListing] = useState<FsListing | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const go = (path: string) => api.get<FsListing>(`/api/fs?path=${encodeURIComponent(path)}`)
    .then((l) => { setListing(l); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => {
    api.get<Place[]>("/api/fs/places").then((p) => { setPlaces(p); go(p.find((x) => x.name === "Видео")?.path ?? ""); }).catch(() => go(""));
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const crumbs = (listing?.path ?? "").split(/[\\/]/).filter(Boolean);
  const sep = (listing?.path ?? "").includes("\\") ? "\\" : "/";
  const base = (listing?.path ?? "").startsWith("/") ? "/" : "";
  const pathAt = (i: number) => base + crumbs.slice(0, i + 1).join(sep) + (i === 0 && sep === "\\" ? "\\" : "");

  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="row"><h2 className="grow">{mode === "dir" ? (ru ? "Выберите папку" : "Choose a folder") : (ru ? "Выберите видео или аудио" : "Choose a video or audio file")}</h2><button className="ghost" onClick={onClose} aria-label={ru ? "Закрыть" : "Close"}><Icon name="x" /></button></div>
        <div className="places">{places.map((p) => <button key={p.path} onClick={() => go(p.path)}>{p.name}</button>)}</div>
        <div className="crumbs">
          <button className="ghost" onClick={() => go("")}>{ru ? "Диски" : "Drives"}</button>
          {crumbs.map((c, i) => <span key={i} className="row" style={{ gap: 4 }}>/<button className="ghost" onClick={() => go(pathAt(i))}>{c}</button></span>)}
        </div>
        {error && <p className="error">{error}</p>}
        <ul className="list files">
          {listing?.parent != null && <li><button onClick={() => go(listing.parent!)}><Icon name="folder" /> ..</button></li>}
          {listing?.entries.filter((e) => mode === "file" || e.dir).map((e) => (
            <li key={e.path} style={{ display: "flex", alignItems: "center" }}>
              {mode === "file" && !e.dir && (
                <input
                  type="checkbox"
                  checked={selected.includes(e.path)}
                  onChange={() => setSelected((prev) => prev.includes(e.path) ? prev.filter((p) => p !== e.path) : [...prev, e.path])}
                  style={{ margin: "0 8px 0 12px" }}
                />
              )}
              <button
                className="grow"
                onClick={() => (e.dir ? go(e.path) : onPick(e.path))}
              >
                <Icon name={e.dir ? "folder" : "film"} /> {e.name}
              </button>
            </li>
          ))}
          {listing && listing.entries.length === 0 && <li className="muted" style={{ padding: 14 }}>{ru ? "Здесь нет папок и медиафайлов." : "No folders or media files here."}</li>}
        </ul>
        <div className="row">
          <p className="muted grow">{mode === "dir" ? (ru ? "Откройте нужную папку и нажмите «Выбрать эту папку»." : "Open the folder and click \"Choose this folder\".") : (ru ? "Показаны папки и медиафайлы: MP4, MOV, MKV, AVI, MTS, MP3, WAV и другие." : "Folders and media files are shown: MP4, MOV, MKV, AVI, MTS, MP3, WAV and others.")}</p>
          {selected.length > 0 && mode === "file" && (
            <button
              className="primary"
              onClick={() => onPickMultiple ? onPickMultiple(selected) : onPick(selected[0])}
            >
              {ru ? "Выбрать файлы" : "Choose files"} ({selected.length})
            </button>
          )}
          {mode === "dir" && <button className="primary" disabled={!listing?.path} onClick={() => listing && onPick(listing.path)}>{ru ? "Выбрать эту папку" : "Choose this folder"}</button>}
        </div>
      </div>
    </div>
  );
}
export { fmtSize };
