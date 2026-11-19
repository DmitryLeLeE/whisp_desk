import { useState } from "react";
import { api } from "../api";
import { useTranslation } from "../i18n";
import Icon from "./Icon";

interface BatchItem {
  id: string;
  name: string;
  path: string;
  job_id?: number | null;
  status: "queued" | "running" | "completed" | "failed";
}

export default function BatchModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { lang } = useTranslation();
  const [pathsText, setPathsText] = useState("");
  const [profile, setProfile] = useState("standard");
  const [projectType, setProjectType] = useState("lecture");
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<BatchItem[]>([]);

  const handleRunBatch = async () => {
    setError("");
    const lines = pathsText
      .split("\n")
      .map((l) => l.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);

    if (lines.length === 0) {
      setError(lang === "ru" ? "Укажите хотя бы один путь к видеофайлу" : "Please provide at least one file path");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post<{ created: Array<{ id: string; name: string; path: string; job_id?: number | null }> }>(
        "/api/projects/batch",
        {
          paths: lines,
          type: projectType,
          auto_analyze: autoAnalyze,
          profile,
        }
      );

      const items: BatchItem[] = (res.created || []).map((c) => ({
        ...c,
        status: c.job_id ? "queued" : "completed",
      }));

      setResults(items);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 680, width: "95%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="folder" size={18} />
            <span style={{ fontWeight: 600 }}>
              {lang === "ru" ? "Пакетная обработка видео (Batch Queue)" : "Batch Processing Queue"}
            </span>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="modal-body">
          {results.length === 0 ? (
            <div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
                {lang === "ru"
                  ? "Вставьте пути к видеофайлам (по одному на строку). Проекты создадутся автоматически и встанут в очередь анализа."
                  : "Enter video file paths (one per line). Projects will be created and enqueued for automated analysis."}
              </p>

              <div style={{ marginBottom: 14 }}>
                <textarea
                  rows={6}
                  placeholder={
                    lang === "ru"
                      ? "C:\\Videos\\recording_01.mp4\nC:\\Videos\\recording_02.mp4"
                      : "/path/to/video1.mp4\n/path/to/video2.mp4"
                  }
                  value={pathsText}
                  onChange={(e) => setPathsText(e.target.value)}
                  style={{
                    width: "100%",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 12,
                    padding: 10,
                    borderRadius: "var(--radius-sm, 4px)",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--bg)",
                    color: "var(--text)",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--text-muted)" }}>
                    {lang === "ru" ? "Профиль анализа" : "Analysis Profile"}
                  </label>
                  <select
                    className="select"
                    value={profile}
                    onChange={(e) => setProfile(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="standard">{lang === "ru" ? "Стандартный монтаж" : "Standard rough cut"}</option>
                    <option value="aggressive">{lang === "ru" ? "Динамичный (Shorts / Reels)" : "Dynamic (Shorts / Reels)"}</option>
                    <option value="podcast">{lang === "ru" ? "Подкаст и диалог" : "Podcast & dialogue"}</option>
                    <option value="lecture">{lang === "ru" ? "Лекция со слайдами" : "Lecture with slides"}</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--text-muted)" }}>
                    {lang === "ru" ? "Тип проектов" : "Project Type"}
                  </label>
                  <select
                    className="select"
                    value={projectType}
                    onChange={(e) => setProjectType(e.target.value)}
                    style={{ width: "100%" }}
                  >
                    <option value="lecture">{lang === "ru" ? "Лекция / Вебинар" : "Lecture / Webinar"}</option>
                    <option value="podcast">{lang === "ru" ? "Подкаст / Интервью" : "Podcast / Interview"}</option>
                    <option value="shorts">{lang === "ru" ? "Shorts / Reels 9:16" : "Shorts / Reels 9:16"}</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={autoAnalyze}
                    onChange={(e) => setAutoAnalyze(e.target.checked)}
                  />
                  <span>
                    {lang === "ru"
                      ? "Сразу запустить автоматический поиск пауз в фоновой очереди"
                      : "Automatically enqueue silence detection in the background"}
                  </span>
                </label>
              </div>

              {error && <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 500, color: "var(--success, #10b981)" }}>
                {lang === "ru"
                  ? `Успешно создано проектов: ${results.length}. Они добавлены в рабочее пространство.`
                  : `Successfully queued ${results.length} projects.`}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto" }}>
                {results.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      backgroundColor: "var(--panel-alt, rgba(255,255,255,0.03))",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm, 4px)",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.path}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="badge" style={{ fontSize: 11 }}>
                        {item.job_id
                          ? lang === "ru" ? "В очереди" : "Queued"
                          : lang === "ru" ? "Готов к монтажу" : "Ready"}
                      </span>
                      <a
                        href={`#/projects/${item.id}`}
                        className="btn secondary"
                        style={{ padding: "3px 8px", fontSize: 12 }}
                      >
                        {lang === "ru" ? "Открыть" : "Open"}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {results.length === 0 ? (
            <>
              <button className="btn secondary" onClick={onClose} disabled={loading}>
                {lang === "ru" ? "Отмена" : "Cancel"}
              </button>
              <button className="btn primary" onClick={handleRunBatch} disabled={loading}>
                {loading
                  ? (lang === "ru" ? "Создание..." : "Creating...")
                  : (lang === "ru" ? "Запустить пакет" : "Start Batch")}
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={onClose}>
              {lang === "ru" ? "Готово" : "Done"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
