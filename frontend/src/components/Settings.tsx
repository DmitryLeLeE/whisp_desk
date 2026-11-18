import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useTranslation } from "../i18n";
import { hasNativePicker, nativePickFolder } from "../native";
import type { SettingsData, ToolInfo, WhispModels } from "../types";
import FileBrowser from "./FileBrowser";
import Icon from "./Icon";
import ModelCards from "./ModelCards";

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
