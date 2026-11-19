import { useEffect, useState } from "react";
import { api } from "../api";
import { useTranslation } from "../i18n";
import Icon from "./Icon";

interface ShowNotesData {
  title: string;
  summary: string;
  highlights: string[];
  formatted_timecodes: string;
  youtube_description: string;
  telegram_post: string;
  tags: string[];
}

export default function ShowNotesModal({ pid, onClose }: { pid: string; onClose: () => void }) {
  const { lang } = useTranslation();
  const [data, setData] = useState<ShowNotesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"youtube" | "telegram" | "highlights">("youtube");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get<ShowNotesData>(`/api/projects/${pid}/show-notes`)
      .then((res) => {
        setData(res);
      })
      .catch((e) => {
        console.error("Error loading show notes:", e);
      })
      .finally(() => setLoading(false));
  }, [pid]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const getActiveText = (): string => {
    if (!data) return "";
    if (activeTab === "youtube") return data.youtube_description;
    if (activeTab === "telegram") return data.telegram_post.replace(/<[^>]+>/g, ""); // plain text for copy
    return data.highlights.map((h, i) => `${i + 1}. ${h}`).join("\n\n");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 720, width: "95%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="captions" size={18} />
            <span style={{ fontWeight: 600 }}>
              {lang === "ru" ? "Шоу-ноуты и готовые публикации" : "Show Notes & Social Publishing"}
            </span>
          </div>
          <button className="btn-icon" onClick={onClose} title={lang === "ru" ? "Закрыть" : "Close"}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
              {lang === "ru" ? "Формирование описания, тезисов и таймкодов..." : "Generating show notes and timecodes..."}
            </div>
          ) : data ? (
            <div>
              {/* Вкладки форматов */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                <button
                  className={`btn ${activeTab === "youtube" ? "primary" : "secondary"}`}
                  onClick={() => setActiveTab("youtube")}
                  style={{ fontSize: 13, padding: "5px 12px" }}
                >
                  YouTube
                </button>
                <button
                  className={`btn ${activeTab === "telegram" ? "primary" : "secondary"}`}
                  onClick={() => setActiveTab("telegram")}
                  style={{ fontSize: 13, padding: "5px 12px" }}
                >
                  Telegram
                </button>
                <button
                  className={`btn ${activeTab === "highlights" ? "primary" : "secondary"}`}
                  onClick={() => setActiveTab("highlights")}
                  style={{ fontSize: 13, padding: "5px 12px" }}
                >
                  {lang === "ru" ? "Тезисы и цитаты" : "Key Takeaways"}
                </button>
              </div>

              {/* Поле текста для копирования */}
              <div style={{ position: "relative" }}>
                <textarea
                  readOnly
                  rows={14}
                  value={getActiveText()}
                  style={{
                    width: "100%",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 12,
                    lineHeight: 1.6,
                    padding: 12,
                    borderRadius: "var(--radius-sm, 4px)",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--bg)",
                    color: "var(--text)",
                    resize: "vertical",
                  }}
                />
              </div>

              {/* Список тегов */}
              {data.tags && data.tags.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                  {data.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        backgroundColor: "var(--panel-alt, rgba(255,255,255,0.06))",
                        borderRadius: "var(--radius-sm, 3px)",
                        color: "var(--text-muted)",
                      }}
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: 20, color: "var(--danger)" }}>
              {lang === "ru" ? "Не удалось сгенерировать шоу-ноуты" : "Failed to load show notes"}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {copied && (
              <span style={{ fontSize: 12, color: "var(--success, #10b981)", fontWeight: 500 }}>
                {lang === "ru" ? "Скопировано в буфер обмена!" : "Copied to clipboard!"}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn primary"
              disabled={loading || !data}
              onClick={() => copyToClipboard(getActiveText())}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <Icon name="copy" size={14} />
              {lang === "ru" ? "Скопировать текст" : "Copy to Clipboard"}
            </button>
            <button className="btn secondary" onClick={onClose}>
              {lang === "ru" ? "Закрыть" : "Close"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
