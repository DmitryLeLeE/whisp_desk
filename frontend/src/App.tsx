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
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem("theme") ?? "dark";
    } catch {
      return "dark";
    }
  });
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

  useEffect(() => {
    api.get<SettingsData>("/api/settings").then(setSys).catch(() => setSys(null));
  }, [route.name]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const open = useCallback((id: string | null) => {
    location.hash = id ? `#/p/${id}` : "#/";
  }, []);

  const tTools = sys?.tools;

  return (
    <div className={`nle-app ${route.name === "project" ? "in-project" : "in-manager"}`}>
      {route.name !== "project" && (
        <header className="nle-manager-header">
          <div className="nle-header-brand">
            <a className="brand-logo" href="#/">
              <img src="/favicon.png" alt="" />
              <div className="brand-text">
                <span className="brand-title">{t("brand.title")} {t("brand.sub")}</span>
                {/* версия показана в настройках */}
              </div>
            </a>
          </div>

          <nav className="nle-manager-tabs">
            <a className={`nle-tab ${route.name === "home" ? "active" : ""}`} href="#/">
              <Icon name="film" /> <span>{t("nav.projects")}</span>
            </a>
            <a className={`nle-tab ${route.name === "settings" ? "active" : ""}`} href="#/settings">
              <Icon name="settings" /> <span>{t("nav.settings")}</span>
            </a>
          </nav>

          <div className="nle-header-tools">
            {tTools && (
              <div className="nle-engine-status" data-tour="nav-status">
                <span className="engine-pill" title={`FFmpeg: ${tTools.ffmpeg.available ? "OK" : "Missing"}`}>
                  <span className={`dot ${tTools.ffmpeg.available ? "on" : "off"}`} /> FFmpeg
                </span>
                <span className="engine-pill" title={`Whisp: ${tTools.whisp.available ? "OK" : "Missing"}`}>
                  <span className={`dot ${tTools.whisp.available ? "on" : "off"}`} /> Whisp
                </span>
                <span className="engine-pill" title={`Auto-Editor: ${tTools.auto_editor.available ? "OK" : "Optional"}`}>
                  <span className={`dot ${tTools.auto_editor.available ? "on" : ""}`} /> Auto-Editor
                </span>
              </div>
            )}
            <button
              className="nle-btn-ghost small"
              onClick={() => setLanguage(lang === "ru" ? "en" : "ru")}
              title="Язык / Language"
            >
              <Icon name="globe" /> <span>{lang.toUpperCase()}</span>
            </button>
            <button
              className="nle-btn-ghost small"
              onClick={() => setShowShortcuts(true)}
              data-tour="shortcuts-btn"
              title={t("common.help")}
            >
              <Icon name="help" />
            </button>
            <button
              className="nle-btn-ghost small"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? t("nav.theme.light") : t("nav.theme.dark")}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </button>
          </div>
        </header>
      )}

      <div className="nle-content-viewport">
        {tTools && !tTools.ffmpeg.available && (
          <div className="notice bad" style={{ margin: "12px 24px 0" }}>
            <Icon name="alert" /> FFmpeg не найден. Положите ffmpeg.exe и ffprobe.exe в папку tools рядом с программой или добавьте их в PATH.
          </div>
        )}
        {route.name === "project" ? (
          <ProjectView
            key={route.pid}
            pid={route.pid}
            onClose={() => open(null)}
            sys={sys}
            theme={theme}
            onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
            onOpenShortcuts={() => setShowShortcuts(true)}
          />
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
