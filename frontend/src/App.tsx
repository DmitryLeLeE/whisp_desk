import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import Home from "./components/Home";
import Icon from "./components/Icon";
import ProjectView from "./components/ProjectView";
import Settings from "./components/Settings";
import type { SettingsData } from "./types";

type Route = { name: "home" } | { name: "settings" } | { name: "project"; pid: string };
const readRoute = (): Route => {
  const h = location.hash;
  if (h === "#/settings") return { name: "settings" };
  const m = h.match(/^#\/p\/([a-z]+_\d+)$/);
  return m ? { name: "project", pid: m[1] } : { name: "home" };
};

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute());
  const [sys, setSys] = useState<SettingsData | null>(null);
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem("theme") ?? "dark"; } catch { return "dark"; } });

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => { api.get<SettingsData>("/api/settings").then(setSys).catch(() => setSys(null)); }, [route.name]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch { /* хранилище недоступно */ }
  }, [theme]);

  const open = useCallback((id: string | null) => { location.hash = id ? `#/p/${id}` : "#/"; }, []);
  const t = sys?.tools;

  return (
    <div className="shell">
      <nav className="side-nav">
        <a className="brand" href="#/"><img src="/favicon.png" alt="" /><span>WHISP<small>MEDIA DESK</small></span></a>
        <a className={`nav-item ${route.name !== "settings" ? "active" : ""}`} href="#/"><Icon name="film" /> Проекты</a>
        <a className={`nav-item ${route.name === "settings" ? "active" : ""}`} href="#/settings"><Icon name="settings" /> Настройки и модели</a>
        <div className="nav-bottom">
          {t && <>
            <span className="sysline"><span className={`dot ${t.ffmpeg.available ? "on" : "off"}`} /> FFmpeg</span>
            <span className="sysline"><span className={`dot ${t.whisp.available ? "on" : "off"}`} /> Whisp</span>
            <span className="sysline"><span className={`dot ${t.auto_editor.available ? "on" : ""}`} /> Auto-Editor</span>
          </>}
          <button className="ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}><Icon name={theme === "dark" ? "sun" : "moon"} /> {theme === "dark" ? "Светлая тема" : "Тёмная тема"}</button>
        </div>
      </nav>
      <div className="content">
        {t && !t.ffmpeg.available && (
          <div className="notice bad" style={{ margin: "16px 32px 0" }}><Icon name="alert" /> FFmpeg не найден. Положите ffmpeg.exe и ffprobe.exe в папку tools рядом с программой или добавьте их в PATH.</div>
        )}
        {route.name === "project" ? <ProjectView key={route.pid} pid={route.pid} onClose={() => open(null)} />
          : route.name === "settings" ? <Settings /> : <Home onOpen={open} />}
      </div>
    </div>
  );
}
