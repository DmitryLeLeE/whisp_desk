import { useEffect, useState } from "react";
import { api } from "../api";
import type { FsListing } from "../types";

export default function FileBrowser({ onPick, onClose }: { onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<FsListing | null>(null);
  const [error, setError] = useState("");
  const go = (path: string) => api.get<FsListing>(`/api/fs?path=${encodeURIComponent(path)}`)
    .then((l) => { setListing(l); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => { go(""); }, []);
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="row"><b className="grow">{listing?.path || "Диски"}</b><button onClick={onClose}>Закрыть</button></div>
        {error && <p className="error">{error}</p>}
        <ul className="list files">
          {listing?.parent != null && <li><button className="link" onClick={() => go(listing.parent!)}>📁 ..</button></li>}
          {listing?.entries.map((e) => (
            <li key={e.path}>
              {e.dir ? <button className="link" onClick={() => go(e.path)}>📁 {e.name}</button>
                : <button className="link" onClick={() => onPick(e.path)}>🎞 {e.name}</button>}
            </li>
          ))}
        </ul>
        <p className="muted">Показаны папки и медиафайлы (MP4, MOV, MKV, AVI, MTS и аудио).</p>
      </div>
    </div>
  );
}
