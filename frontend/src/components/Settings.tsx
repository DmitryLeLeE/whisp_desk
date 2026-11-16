import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { SettingsData, ToolInfo, WhispModels } from "../types";
import { hasNativePicker, nativePickFolder } from "../native";
import FileBrowser from "./FileBrowser";
import Icon from "./Icon";
import ModelCards from "./ModelCards";

function ToolRow({ name, info, hint }: { name: string; info: ToolInfo; hint: string }) {
  return (
    <tr>
      <td><span className={`dot ${info.available ? "on" : "off"}`} /> <b>{name}</b></td>
      <td>{info.available ? <span className="muted">{info.version ?? (info.mode === "embedded" ? "встроен в программу" : info.path)}</span> : <span className="error">{hint}</span>}</td>
    </tr>
  );
}

export default function Settings() {
  const [s, setS] = useState<SettingsData | null>(null);
  const [wm, setWm] = useState<WhispModels | null>(null);
  const [dir, setDir] = useState("");
  const [browse, setBrowse] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const loadModels = useCallback(() => api.get<WhispModels>("/api/whisp/models").then(setWm).catch((e) => setError(e.message)), []);
  useEffect(() => { api.get<SettingsData>("/api/settings").then((d) => { setS(d); setDir(d.whisp_model_dir); }); loadModels(); }, [loadModels]);
  // Пока что-то скачивается — обновляем состояние.
  useEffect(() => {
    if (!wm?.models.some((m) => m.download?.state === "running")) return;
    const t = setInterval(loadModels, 1000);
    return () => clearInterval(t);
  }, [wm, loadModels]);

  const saveDir = async (value: string) => {
    setError(""); setMsg("");
    try { const d = await api.put<SettingsData>("/api/settings", { whisp_model_dir: value }); setS(d); setDir(d.whisp_model_dir); setMsg("Папка для моделей сохранена"); loadModels(); }
    catch (e) { setError((e as Error).message); }
  };
  const pickDir = async () => { if (hasNativePicker()) { const p = await nativePickFolder(); if (p) saveDir(p); } else setBrowse(true); };

  return (
    <main className="page narrow">
      <div className="page-head"><div><h1>Настройки и модели</h1><p className="muted">Состояние встроенных программ и модели распознавания речи.</p></div></div>
      <div className="stack">
        <section className="card">
          <div className="card-title"><h2>Встроенные программы</h2></div>
          {s && (
            <table className="kv"><tbody>
              <ToolRow name="FFmpeg" info={s.tools.ffmpeg} hint="не найден: без него нельзя анализировать и рендерить" />
              <ToolRow name="Auto-Editor" info={s.tools.auto_editor} hint="не найден (необязателен): второй движок поиска пауз" />
              <ToolRow name="Whisp" info={s.tools.whisp} hint="не найден: расшифровку можно импортировать файлом" />
            </tbody></table>
          )}
          {s && <p className="muted small">Версия {s.version}. Данные программы: {s.root}</p>}
        </section>

        <section className="card">
          <div className="card-title"><h2>Модели распознавания речи (Whisp)</h2></div>
          <p className="muted">Модель скачивается один раз и дальше работает без интернета. Если не уверены — берите <b>turbo</b>: почти как самая точная, но заметно быстрее.
            Для слабого компьютера подойдёт <b>small</b>.</p>
          {wm && <ModelCards models={wm.models} onChanged={loadModels} onError={setError} />}
          <hr />
          <label>Папка для моделей
            <div className="row">
              <input className="grow" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="По умолчанию: %USERPROFILE%\.cache\huggingface\hub" />
              <button onClick={pickDir}><Icon name="folder" /> Выбрать…</button>
              <button className="primary" onClick={() => saveDir(dir)}>Сохранить</button>
            </div>
          </label>
          <p className="muted small">Если поменять папку, скачанные ранее модели в новой папке не найдутся и скачаются заново.</p>
          {error && <p className="error">{error}</p>}
          {msg && <p className="ok">{msg}</p>}
          {browse && <FileBrowser mode="dir" onPick={(p) => { setBrowse(false); saveDir(p); }} onClose={() => setBrowse(false)} />}
        </section>

        <section className="card">
          <div className="card-title"><h2>О программе</h2></div>
          <p className="muted">WHISP MEDIA DESK — локальная студия подготовки видео. Всё работает на вашем компьютере: без облака и без передачи файлов.
            Распознавание речи выполняет Whisp (faster-whisper), поиск пауз — встроенный детектор или Auto-Editor, рендер — FFmpeg.
            Машинный перевод субтитров использует модель NLLB-200 (лицензия CC-BY-NC-4.0, только некоммерческое использование).</p>
        </section>
      </div>
    </main>
  );
}
