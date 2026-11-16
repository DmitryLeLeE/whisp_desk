import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import ProjectList from "./components/ProjectList";
import ProjectView from "./components/ProjectView";

const readHash = () => (location.hash.match(/^#\/p\/([a-z]+_\d+)$/) ?? [])[1] ?? null;

export default function App() {
  const [pid, setPid] = useState<string | null>(readHash());
  const [system, setSystem] = useState<{ ffmpeg: { available: boolean }; whisp: { available: boolean } } | null>(null);

  useEffect(() => {
    const onHash = () => setPid(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => { api.get<typeof system>("/api/system").then(setSystem).catch(() => setSystem(null)); }, []);

  const open = useCallback((id: string | null) => { location.hash = id ? `#/p/${id}` : "#/"; }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/" onClick={() => open(null)}>WHISP <b>MEDIA DESK</b></a>
        <span className="sys">
          {system && !system.ffmpeg.available && <span className="badge bad">FFmpeg не найден</span>}
          {system && !system.whisp.available && <span className="badge" title="Расшифровку можно импортировать файлом">Whisp не подключён</span>}
        </span>
      </header>
      {pid ? <ProjectView key={pid} pid={pid} onClose={() => open(null)} /> : <ProjectList onOpen={open} />}
    </div>
  );
}
