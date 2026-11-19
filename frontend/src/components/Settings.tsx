import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useTranslation } from "../i18n";
import { hasNativePicker, nativePickFolder } from "../native";
import type { SettingsData, ToolInfo, WhispModels } from "../types";
import FileBrowser from "./FileBrowser";
import Icon from "./Icon";
import ModelCards from "./ModelCards";

interface UpdateCheck {
  status: "idle" | "checking" | "ok" | "offline";
  current_version: string;
  latest_version: string;
  has_update: boolean;
  release_name?: string;
  release_url?: string;
}

function ToolRow({ name, info, hint }: { name: string; info: ToolInfo; hint: string }) {
  return (
    <tr>
      <td style={{ paddingRight: 20 }}>
        <span className={`dot ${info.available ? "on" : "off"}`} /> <b>{name}</b>
      </td>
      <td>
        {info.available ? (
          <span className="muted">{info.version ?? (info.mode === "embedded" ? "встроен" : info.path)}</span>
        ) : (
          <span className="error">{hint}</span>
        )}
      </td>
    </tr>
  );
}

export default function Settings() {
  const { t, lang } = useTranslation();
  const [s, setS] = useState<SettingsData | null>(null);
  const [wm, setWm] = useState<WhispModels | null>(null);
  const [dir, setDir] = useState("");
  const [browse, setBrowse] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const res = await api.get<UpdateCheck>("/api/system/check-update");
      setUpdate(res);
    } catch {
      setUpdate({
        status: "offline",
        current_version: s?.version || "1.0.0",
        latest_version: s?.version || "1.0.0",
        has_update: false,
        release_url: "https://github.com/DmitryLeLeE/whisp_desk/releases",
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const loadModels = useCallback(() => api.get<WhispModels>("/api/whisp/models").then(setWm).catch((e) => setError(e.message)), []);
  useEffect(() => {
    api.get<SettingsData>("/api/settings").then((d) => { setS(d); setDir(d.whisp_model_dir); });
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (!wm?.models.some((m) => m.download?.state === "running")) return;
    const timer = setInterval(loadModels, 1000);
    return () => clearInterval(timer);
  }, [wm, loadModels]);

  const saveDir = async (value: string) => {
    setError(""); setMsg("");
    try {
      const d = await api.put<SettingsData>("/api/settings", { whisp_model_dir: value });
      setS(d); setDir(d.whisp_model_dir);
      setMsg(lang === "ru" ? "Папка для моделей сохранена" : "Model folder saved");
      loadModels();
    } catch (e) { setError((e as Error).message); }
  };

  const pickDir = async () => {
    if (hasNativePicker()) { const p = await nativePickFolder(); if (p) saveDir(p); }
    else setBrowse(true);
  };

  return (
    <main className="page narrow">
      <div className="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
          <p className="muted">
            {lang === "ru"
              ? "Состояние встроенных инструментов и локальные модели распознавания речи."
              : "Status of installed tools and local speech recognition models."}
          </p>
        </div>
      </div>

      <div className="stack">
        <section className="card">
          <div className="card-title">
            <span className="num"><Icon name="cpu" /></span>
            <h2>{t("settings.tools")}</h2>
          </div>
          {s && (
            <table className="kv">
              <tbody>
                <ToolRow
                  name="FFmpeg"
                  info={s.tools.ffmpeg}
                  hint={lang === "ru" ? "не найден: нужен для анализа и рендера" : "not found: required for analysis and render"}
                />
                <ToolRow
                  name="Auto-Editor"
                  info={s.tools.auto_editor}
                  hint={lang === "ru" ? "не найден (необязателен): альтернативный движок" : "optional: alternative cut engine"}
                />
                <ToolRow
                  name="Whisp"
                  info={s.tools.whisp}
                  hint={lang === "ru" ? "не найден: субтитры можно импортировать файлом" : "not found: subtitles can be imported from file"}
                />
              </tbody>
            </table>
          )}
          {s && <p className="muted small">v{s.version} · {s.root}</p>}
        </section>

        <section className="card">
          <div className="card-title">
            <span className="num"><Icon name="refresh" /></span>
            <h2>{lang === "ru" ? "Обновления программы" : "Software Updates"}</h2>
          </div>
          <div className="row wrap" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 600 }}>
                WHISP MEDIA DESK <span className="badge small" style={{ marginLeft: 6, background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8" }}>v{s?.version ?? "1.0.0"}</span>
              </p>
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                {lang === "ru" ? "Проверка релизов и новых версий на GitHub" : "Check for new releases on GitHub"}
              </p>
            </div>
            <button className="ghost small" disabled={checkingUpdate} onClick={checkUpdate}>
              <Icon name="refresh" /> {checkingUpdate ? (lang === "ru" ? "Проверка..." : "Checking...") : (lang === "ru" ? "Проверить обновления" : "Check for Updates")}
            </button>
          </div>
          {update && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--panel2)", borderRadius: 8, border: "1px solid var(--line)" }}>
              {update.has_update ? (
                <div className="row wrap" style={{ alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <span className="badge small" style={{ background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", fontWeight: 700 }}>
                      {lang === "ru" ? "Доступна новая версия!" : "New version available!"}
                    </span>
                    <b style={{ marginLeft: 8 }}>v{update.latest_version}</b>
                    {update.release_name && <span className="muted small" style={{ marginLeft: 8 }}>({update.release_name})</span>}
                  </div>
                  <a
                    href={update.release_url}
                    target="_blank"
                    rel="noreferrer"
                    className="primary"
                    style={{ padding: "4px 10px", fontSize: 12, textDecoration: "none", borderRadius: 6, display: "inline-block" }}
                  >
                    {lang === "ru" ? "Перейти к релизу" : "View Release"}
                  </a>
                </div>
              ) : update.status === "ok" ? (
                <p className="ok small" style={{ margin: 0 }}>
                  ✓ {lang === "ru" ? `У вас установлена самая актуальная версия (v${update.current_version}).` : `You are using the latest version (v${update.current_version}).`}
                </p>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  {lang === "ru" ? "Проверка через интернет недоступна (автономный режим)." : "Update check unavailable (offline mode)."}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-title">
            <span className="num"><Icon name="mic" /></span>
            <h2>{t("settings.models")}</h2>
          </div>
          <p className="muted">
            {lang === "ru"
              ? "Модель скачивается один раз и сохраняется на диск. Для большинства задач рекомендуется turbo."
              : "Models are downloaded once and cached locally. Turbo is recommended for high accuracy and speed."}
          </p>
          {wm && <ModelCards models={wm.models} onChanged={loadModels} onError={setError} />}
          <div className="row wrap" style={{ marginTop: 8 }}>
            <input
              className="grow"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder={lang === "ru" ? "Папка для моделей по умолчанию" : "Default model directory"}
            />
            <button onClick={pickDir}><Icon name="folder" /> {lang === "ru" ? "Обзор…" : "Browse…"}</button>
            <button className="primary" onClick={() => saveDir(dir)}>{t("common.save")}</button>
          </div>
          {msg && <p className="ok">{msg}</p>}
          {error && <p className="error">{error}</p>}
          {browse && <FileBrowser onPick={saveDir} onClose={() => setBrowse(false)} />}
        </section>
      </div>
    </main>
  );
}
