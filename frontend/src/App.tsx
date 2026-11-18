import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import Home from "./components/Home";
import Icon from "./components/Icon";
import ProjectView from "./components/ProjectView";
import Settings from "./components/Settings";
import ShortcutsModal from "./components/ShortcutsModal";
import { useTranslation } from "./i18n";
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
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { lang, setLanguage, t } = useTranslation();

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        setShowShortcuts((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => { api.get<SettingsData>("/api/settings").then(setSys).catch(() => setSys(null)); }, [route.name]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch { /* хранилище недоступно */ }
  }, [theme]);

  const open = useCallback((id: string | null) => { location.hash = id ? `#/p/${id}` : "#/"; }, []);
  const tTools = sys?.tools;

  return (
    <div className="shell">
      <nav className="side-nav">
        <a className="brand" href="#/">
          <img src="/favicon.png" alt="" />
          <span>{t("brand.title")}<small>{t("brand.sub")}</small></span>
        </a>
        <a className={`nav-item ${route.name === "home" || route.name === "project" ? "active" : ""}`} href="#/">
          <Icon name="film" /> {t("nav.projects")}
        </a>
        <a className={`nav-item ${route.name === "settings" ? "active" : ""}`} href="#/settings">
          <Icon name="settings" /> {t("nav.settings")}
        </a>

        <div className="nav-bottom">
          {tTools && (
            <div data-tour="nav-status">
              <span className="sysline"><span className={`dot ${tTools.ffmpeg.available ? "on" : "off"}`} /> FFmpeg</span>
              <span className="sysline"><span className={`dot ${tTools.whisp.available ? "on" : "off"}`} /> Whisp</span>
              <span className="sysline"><span className={`dot ${tTools.auto_editor.available ? "on" : ""}`} /> Auto-Editor</span>
            </div>
          )}
          <div className="row" style={{ marginTop: 4 }}>
            <button className="ghost grow" onClick={() => setLanguage(lang === "ru" ? "en" : "ru")} title="Сменить язык интерфейса / Switch language">
              <Icon name="globe" /> {lang.toUpperCase()}
            </button>
            <button className="ghost" onClick={() => setShowShortcuts(true)} data-tour="shortcuts-btn" title={t("common.help")}>
              <Icon name="help" />
            </button>
          </div>
          <button className="ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            <Icon name={theme === "dark" ? "sun" : "moon"} /> {theme === "dark" ? t("nav.theme.light") : t("nav.theme.dark")}
          </button>
        </div>
      </nav>

      <div className="content">
        {tTools && !tTools.ffmpeg.available && (
          <div className="notice bad" style={{ margin: "16px 36px 0" }}>
            <Icon name="alert" /> FFmpeg не найден. Положите ffmpeg.exe и ffprobe.exe в папку tools рядом с программой или добавьте их в PATH.
          </div>
        )}
        {route.name === "project" ? (
          <ProjectView key={route.pid} pid={route.pid} onClose={() => open(null)} />
        ) : route.name === "settings" ? (
          <Settings />
        ) : (
          <Home onOpen={open} />
        )}
      </div>

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
