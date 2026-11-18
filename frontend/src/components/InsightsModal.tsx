import { useEffect, useState } from "react";
import { api, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import type { InsightsData } from "../types";
import Icon from "./Icon";

export default function InsightsModal({ pid, onClose }: { pid: string; onClose: () => void }) {
  const { lang } = useTranslation();
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<InsightsData>(`/api/projects/${pid}/insights?lang=${lang}`)
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [pid, lang]);

  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 8 }}>
            <Icon name="sliders" />
            <h2>{lang === "ru" ? "Аналитика речи и монтажа" : "Speech & Editing Insights"}</h2>
          </div>
          <button className="ghost" onClick={onClose}><Icon name="x" /></button>
        </div>

        {loading && <p className="muted">{lang === "ru" ? "Сбор метрик проекта…" : "Gathering project metrics…"}</p>}
        {error && <p className="error">{error}</p>}

        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* Скорость речи */}
              <div style={{ padding: "14px", background: "var(--panel2)", borderRadius: 8, border: "1px solid var(--line)" }}>
                <div className="muted small">{lang === "ru" ? "Темп речи" : "Speech Pace"}</div>
                <div style={{ fontSize: 24, fontWeight: 700, margin: "4px 0", color: data.pace === "optimal" ? "var(--accent)" : "inherit" }}>
                  {data.wpm} <span style={{ fontSize: 14, fontWeight: 400 }}>{lang === "ru" ? "слов/мин" : "WPM"}</span>
                </div>
                <div className="small" style={{ color: "var(--accent)" }}>{data.pace_label}</div>
              </div>

              {/* Сэкономленное время */}
              <div style={{ padding: "14px", background: "var(--panel2)", borderRadius: 8, border: "1px solid var(--line)" }}>
                <div className="muted small">{lang === "ru" ? "Сэкономлено времени" : "Time Saved"}</div>
                <div style={{ fontSize: 24, fontWeight: 700, margin: "4px 0", color: "#10b981" }}>
                  -{fmtTime(data.removed_duration_ms, false)}{" "}
                  <span style={{ fontSize: 14, fontWeight: 400 }}>({data.saved_percent}%)</span>
                </div>
                <div className="muted small">
                  {lang === "ru" ? `Вырезано ${data.silence_cuts} пауз` : `Cleaned ${data.silence_cuts} pauses`}
                </div>
              </div>

              {/* Хронометраж */}
              <div style={{ padding: "14px", background: "var(--panel2)", borderRadius: 8, border: "1px solid var(--line)" }}>
                <div className="muted small">{lang === "ru" ? "Хронометраж готового видео" : "Final Video Duration"}</div>
                <div style={{ fontSize: 22, fontWeight: 700, margin: "4px 0" }}>
                  {fmtTime(data.output_duration_ms, false)}
                </div>
                <div className="muted small">
                  {lang === "ru" ? `из ${fmtTime(data.total_duration_ms, false)} исходника` : `from ${fmtTime(data.total_duration_ms, false)} original`}
                </div>
              </div>

              {/* Объём слов */}
              <div style={{ padding: "14px", background: "var(--panel2)", borderRadius: 8, border: "1px solid var(--line)" }}>
                <div className="muted small">{lang === "ru" ? "Объём произнесённого текста" : "Spoken Content"}</div>
                <div style={{ fontSize: 22, fontWeight: 700, margin: "4px 0" }}>
                  {data.total_words} <span style={{ fontSize: 14, fontWeight: 400 }}>{lang === "ru" ? "слов" : "words"}</span>
                </div>
                <div className="muted small">
                  {lang === "ru" ? `${data.total_cues} реплик • ${data.total_cuts} склеек` : `${data.total_cues} cues • ${data.total_cuts} cuts`}
                </div>
              </div>
            </div>

            {/* Рейтинг оптимизации контента */}
            <div style={{ padding: "14px", background: "var(--panel2)", borderRadius: 8, border: "1px solid var(--line)" }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <span className="small muted">{lang === "ru" ? "Индекс оптимизации контента" : "Content Efficiency Score"}</span>
                <span style={{ fontWeight: 700, color: "var(--accent)" }}>{data.efficiency_score} / 100</span>
              </div>
              <div style={{ width: "100%", height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${data.efficiency_score}%`, height: "100%", background: "var(--accent)", borderRadius: 4, transition: "width 0.4s ease" }} />
              </div>
            </div>
          </div>
        )}

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 20 }}>
          <button className="primary" onClick={onClose}>{lang === "ru" ? "Понятно" : "Close"}</button>
        </div>
      </div>
    </div>
  );
}
