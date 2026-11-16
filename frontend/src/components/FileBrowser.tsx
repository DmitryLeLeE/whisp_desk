import { useEffect, useState } from "react";
import { api, fmtSize } from "../api";
import type { FsListing } from "../types";
import Icon from "./Icon";

interface Place { name: string; path: string }

/** Встроенный выбор файла или папки (когда нет окна приложения с системным диалогом). */
export default function FileBrowser({ onPick, onClose, mode = "file" }: { onPick: (path: string) => void; onClose: () => void; mode?: "file" | "dir" }) {
  const [listing, setListing] = useState<FsListing | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
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
        <div className="row"><h2 className="grow">{mode === "dir" ? "Выберите папку" : "Выберите видео или аудио"}</h2><button className="ghost" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button></div>
        <div className="places">{places.map((p) => <button key={p.path} onClick={() => go(p.path)}>{p.name}</button>)}</div>
        <div className="crumbs">
          <button className="ghost" onClick={() => go("")}>Диски</button>
          {crumbs.map((c, i) => <span key={i} className="row" style={{ gap: 4 }}>/<button className="ghost" onClick={() => go(pathAt(i))}>{c}</button></span>)}
        </div>
        {error && <p className="error">{error}</p>}
        <ul className="list files">
          {listing?.parent != null && <li><button onClick={() => go(listing.parent!)}><Icon name="folder" /> ..</button></li>}
          {listing?.entries.filter((e) => mode === "file" || e.dir).map((e) => (
            <li key={e.path}>
              <button onClick={() => (e.dir ? go(e.path) : onPick(e.path))}><Icon name={e.dir ? "folder" : "film"} /> {e.name}</button>
            </li>
          ))}
          {listing && listing.entries.length === 0 && <li className="muted" style={{ padding: 14 }}>Здесь нет папок и медиафайлов.</li>}
        </ul>
        <div className="row">
          <p className="muted grow">{mode === "dir" ? "Откройте нужную папку и нажмите «Выбрать эту папку»." : "Показаны папки и медиафайлы: MP4, MOV, MKV, AVI, MTS, MP3, WAV и другие."}</p>
          {mode === "dir" && <button className="primary" disabled={!listing?.path} onClick={() => listing && onPick(listing.path)}>Выбрать эту папку</button>}
        </div>
      </div>
    </div>
  );
}
export { fmtSize };
