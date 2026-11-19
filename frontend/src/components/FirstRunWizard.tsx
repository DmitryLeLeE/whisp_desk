import { useCallback, useEffect, useState } from "react";
import { api, fmtSize } from "../api";
import { useTranslation } from "../i18n";
import type { ToolInfo, WhispModels } from "../types";
import Icon from "./Icon";

interface Sys { ffmpeg: ToolInfo & { libx264?: boolean }; auto_editor: ToolInfo; whisp: ToolInfo }

export const WIZARD_KEY = "whisp_wizard_done";

export default function FirstRunWizard({ onClose }: { onClose: () => void }) {
  const { lang } = useTranslation();
  const ru = lang === "ru";
  const [sys, setSys] = useState<Sys | null>(null);
  const [wm, setWm] = useState<WhispModels | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.get<Sys>("/api/system").then(setSys).catch(() => setSys(null));
    api.get<WhispModels>("/api/whisp/models").then(setWm).catch(() => setWm(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const turbo = wm?.models.find((m) => m.name === "turbo");
  const dl = turbo?.download;
  const downloading = dl?.state === "running";
  useEffect(() => {
    if (!downloading) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [downloading, load]);

  const startDownload = async () => {
    setError("");
    try { await api.post("/api/whisp/models/turbo/download"); load(); }
    catch (e) { setError((e as Error).message); }
  };
  const finish = () => { try { localStorage.setItem(WIZARD_KEY, "1"); } catch { /* ignore */ } onClose(); };

  const pct = dl && dl.total ? Math.round((dl.done / dl.total) * 100) : 0;
  const Row = ({ ok, title, hint, children }: { ok: boolean | null; title: string; hint?: string; children?: React.ReactNode }) => (
    <div className="wiz-row">
      <span className={`wiz-dot ${ok === null ? "wait" : ok ? "ok" : "bad"}`}>{ok ? <Icon name="check" /> : ok === false ? "!" : ""}</span>
      <div className="grow">
        <b>{title}</b>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      {children}
    </div>
  );

  return (
    <div className="modal-backdrop">
      <div className="dialog wiz-dialog" role="dialog" aria-label={ru ? "Первый запуск" : "First run"}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>{ru ? "Добро пожаловать" : "Welcome"}</h2>
            <p className="muted small" style={{ margin: "2px 0 0" }}>{ru ? "Проверим, что всё готово к работе." : "Let us check that everything is ready."}</p>
          </div>
        </div>
        <div className="modal-body">
          <Row ok={sys ? sys.ffmpeg.available : null} title={ru ? "Работа с видео (FFmpeg)" : "Video processing (FFmpeg)"}
            hint={sys && !sys.ffmpeg.available ? (ru ? "Не найден. Положите FFmpeg в папку tools/ffmpeg рядом с программой или установите его в систему." : "Not found. Put FFmpeg into tools/ffmpeg next to the app or install it system-wide.") : undefined} />
          <Row ok={sys ? sys.whisp.available : null} title={ru ? "Распознавание речи (Whisp)" : "Speech recognition (Whisp)"}
            hint={sys && !sys.whisp.available ? (ru ? "Недоступно в этой копии. Субтитры можно импортировать из файла." : "Not available in this copy. You can import subtitles from a file.") : undefined} />
          {sys?.whisp.available && turbo && (
            <Row ok={turbo.downloaded === true ? true : null}
              title={ru ? "Модель распознавания turbo" : "Speech model turbo"}
              hint={turbo.downloaded === true ? (ru ? "Скачана, расшифровка запустится сразу." : "Downloaded, transcription starts right away.")
                : downloading ? `${ru ? "Скачивание" : "Downloading"}: ${dl?.total ? `${fmtSize(dl.done)} / ${fmtSize(dl.total)} (${pct}%)` : (ru ? "подключение…" : "connecting…")}`
                : (ru ? "Нужна один раз (около 1,6 ГБ, нужен интернет). Без неё первая расшифровка начнётся с загрузки." : "Needed once (about 1.6 GB, internet required). Without it the first transcription starts with a download.")}>
              {turbo.downloaded !== true && !downloading && (
                <button className="primary" onClick={startDownload}><Icon name="download" /> {ru ? "Скачать сейчас" : "Download now"}</button>
              )}
              {downloading && <div className="bar wiz-bar"><i style={{ width: `${Math.max(3, pct)}%` }} /></div>}
            </Row>
          )}
          <Row ok={sys ? sys.auto_editor.available : null} title={ru ? "Auto-Editor (необязательно)" : "Auto-Editor (optional)"}
            hint={sys && !sys.auto_editor.available ? (ru ? "Не нужен: пауза ищется встроенным движком." : "Not required: pauses are found by the built-in engine.") : undefined} />
          {dl?.state === "error" && <p className="error small">{dl.error}</p>}
          {error && <p className="error small">{error}</p>}
          {downloading && <p className="muted small">{ru ? "Можно закрыть это окно: загрузка продолжится в фоне." : "You can close this window: the download continues in the background."}</p>}
        </div>
        <div className="modal-footer">
          <button className="primary" onClick={finish}>{downloading ? (ru ? "Продолжить в фоне" : "Continue in background") : (ru ? "Начать работу" : "Get started")}</button>
        </div>
      </div>
    </div>
  );
}
