import { useEffect, useState } from "react";
import { api, fmtTime } from "../api";
import { useTranslation } from "../i18n";
import type { EditPattern, PatternApplyResult, PlanPayload } from "../types";
import Icon from "./Icon";

interface Props {
  pid: string;
  onClose: () => void;
  onPayload: (p: PlanPayload) => void;
}

export default function AutoPatternModal({ pid, onClose, onPayload }: Props) {
  const { lang } = useTranslation();
  const [patterns, setPatterns] = useState<EditPattern[]>([]);
  const [selectedId, setSelectedId] = useState<string>("shorts_jumpcut");
  const [customParams, setCustomParams] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PatternApplyResult | null>(null);

  useEffect(() => {
    api.get<{ patterns: EditPattern[] }>(`/api/projects/${pid}/patterns`)
      .then((data) => {
        setPatterns(data.patterns || []);
        if (data.patterns && data.patterns.length > 0) {
          setSelectedId(data.patterns[0].id);
          setCustomParams(data.patterns[0].params || {});
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [pid]);

  const selPattern = patterns.find((p) => p.id === selectedId) || patterns[0];

  const handleSelect = (p: EditPattern) => {
    setSelectedId(p.id);
    setCustomParams({ ...(p.params || {}) });
    setResult(null);
    setError("");
  };

  const handleApply = async () => {
    if (!selPattern) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await api.post<PlanPayload & { pattern_result: PatternApplyResult }>(
        `/api/projects/${pid}/patterns/apply`,
        { pattern_id: selPattern.id, params: customParams }
      );
      onPayload(res);
      setResult(res.pattern_result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog pattern-modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 840 }}>
        {/* Шапка модального окна */}
        <div className="panel-header-bar">
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <span className="panel-tag">RECIPES</span>
            <h3 style={{ margin: 0, fontSize: 16 }}>
              {lang === "ru" ? "Мастер авто-монтажа по паттернам" : "Auto-Pattern Editing Studio"}
            </h3>
          </div>
          <button className="ghost small" onClick={onClose} style={{ marginLeft: "auto" }}>
            ✕
          </button>
        </div>

        <p className="muted small" style={{ margin: "2px 0 12px" }}>
          {lang === "ru"
            ? "Выберите готовый сценарий сборки: алгоритм автоматически перестроит склейки, удалит паразиты или синхронизирует видео."
            : "Select an automated assembly pattern: the engine will recalculate cuts, trim filler words, or synchronize slides."}
        </p>

        {error && <p className="error">{error}</p>}

        {result && (
          <div className="notice ok" style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <b>✓ {result.summary}</b>
              <span className="badge small" style={{ background: "rgba(16, 185, 129, 0.2)", color: "#10b981", fontWeight: 700 }}>
                {lang === "ru" ? "Сэкономлено" : "Trimmed"}: {fmtTime(Math.abs(result.saved_ms || 0), false)}
              </span>
            </div>
            <span className="small muted">
              {lang === "ru"
                ? "Монтажный план обновлён. Вы можете отменить действие комбинацией Ctrl+Z в любое время."
                : "Timeline updated. You can undo this action with Ctrl+Z at any time."}
            </span>
          </div>
        )}

        {/* Сетка выбора паттернов */}
        <div className="patterns-grid">
          {patterns.map((p) => {
            const isSel = p.id === selectedId;
            return (
              <div
                key={p.id}
                className={`pattern-card ${isSel ? "active" : ""}`}
                onClick={() => handleSelect(p)}
              >
                <div className="pattern-head">
                  <b>{p.name}</b>
                  <span className="pattern-badge">{p.badge}</span>
                </div>
                <p className="pattern-desc">{p.description}</p>
              </div>
            );
          })}
        </div>

        {/* Панель настройки параметров выбранного паттерна */}
        {selPattern && (
          <div className="pattern-params-box">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span className="small muted" style={{ textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>
                {lang === "ru" ? "Параметры паттерна" : "Pattern Parameters"}
              </span>
              <button
                className="link small"
                onClick={() => setCustomParams({ ...(selPattern.params || {}) })}
                style={{ fontSize: 11 }}
              >
                {lang === "ru" ? "Сбросить к стандарту" : "Reset to defaults"}
              </button>
            </div>

            <div className="params-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 8 }}>
              {selPattern.id === "shorts_jumpcut" && (
                <>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Порог тишины (мс)" : "Silence threshold (ms)"}</span>
                    <input
                      type="number"
                      value={customParams.min_pause_ms ?? 250}
                      onChange={(e) => setCustomParams({ ...customParams, min_pause_ms: Number(e.target.value) })}
                      min={100}
                      max={1000}
                      step={50}
                    />
                  </label>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Запас дыхания (мс)" : "Padding (ms)"}</span>
                    <input
                      type="number"
                      value={customParams.pad_ms ?? 90}
                      onChange={(e) => setCustomParams({ ...customParams, pad_ms: Number(e.target.value) })}
                      min={30}
                      max={300}
                      step={10}
                    />
                  </label>
                  <label className="check" style={{ alignSelf: "center", marginTop: 14 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(customParams.clean_fillers)}
                      onChange={(e) => setCustomParams({ ...customParams, clean_fillers: e.target.checked })}
                    />
                    <span>{lang === "ru" ? "Вырезать слова-паразиты" : "Cut filler words"}</span>
                  </label>
                </>
              )}

              {selPattern.id === "podcast_flow" && (
                <>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Сохранять паузы до (мс)" : "Keep pauses up to (ms)"}</span>
                    <input
                      type="number"
                      value={customParams.min_pause_ms ?? 1400}
                      onChange={(e) => setCustomParams({ ...customParams, min_pause_ms: Number(e.target.value) })}
                      min={500}
                      max={4000}
                      step={100}
                    />
                  </label>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Запас до речи (мс)" : "Pre-speech pad (ms)"}</span>
                    <input
                      type="number"
                      value={customParams.pad_before_ms ?? 300}
                      onChange={(e) => setCustomParams({ ...customParams, pad_before_ms: Number(e.target.value) })}
                      min={50}
                      max={600}
                      step={50}
                    />
                  </label>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Запас после речи (мс)" : "Post-speech pad (ms)"}</span>
                    <input
                      type="number"
                      value={customParams.pad_after_ms ?? 400}
                      onChange={(e) => setCustomParams({ ...customParams, pad_after_ms: Number(e.target.value) })}
                      min={50}
                      max={800}
                      step={50}
                    />
                  </label>
                </>
              )}

              {selPattern.id === "slides_sync" && (
                <>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Окно притягивания (мс)" : "Snap window (ms)"}</span>
                    <input
                      type="number"
                      value={customParams.snap_window_ms ?? 750}
                      onChange={(e) => setCustomParams({ ...customParams, snap_window_ms: Number(e.target.value) })}
                      min={200}
                      max={2000}
                      step={50}
                    />
                  </label>
                </>
              )}

              {selPattern.id === "retakes_removal" && (
                <>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Порог схожести текста" : "Similarity threshold"}</span>
                    <input
                      type="number"
                      value={customParams.similarity_threshold ?? 0.55}
                      onChange={(e) => setCustomParams({ ...customParams, similarity_threshold: Number(e.target.value) })}
                      min={0.3}
                      max={0.9}
                      step={0.05}
                    />
                  </label>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Макс. интервал между дублями (с)" : "Max gap between takes (s)"}</span>
                    <input
                      type="number"
                      value={customParams.max_gap_s ?? 5.0}
                      onChange={(e) => setCustomParams({ ...customParams, max_gap_s: Number(e.target.value) })}
                      min={1.0}
                      max={20.0}
                      step={0.5}
                    />
                  </label>
                </>
              )}

              {selPattern.id === "pause_compression" && (
                <>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Целевая длина паузы (мс)" : "Target pause length (ms)"}</span>
                    <input
                      type="number"
                      value={customParams.target_pause_ms ?? 350}
                      onChange={(e) => setCustomParams({ ...customParams, target_pause_ms: Number(e.target.value) })}
                      min={100}
                      max={1000}
                      step={50}
                    />
                  </label>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Сжимать паузы длиннее (мс)" : "Compress pauses longer than (ms)"}</span>
                    <input
                      type="number"
                      value={customParams.min_pause_ms ?? 700}
                      onChange={(e) => setCustomParams({ ...customParams, min_pause_ms: Number(e.target.value) })}
                      min={300}
                      max={2500}
                      step={100}
                    />
                  </label>
                </>
              )}

              {selPattern.id === "highlights_teaser" && (
                <>
                  <label className="param-item">
                    <span>{lang === "ru" ? "Целевой хронометраж (секунд)" : "Target duration (seconds)"}</span>
                    <input
                      type="number"
                      value={customParams.target_seconds ?? 60}
                      onChange={(e) => setCustomParams({ ...customParams, target_seconds: Number(e.target.value) })}
                      min={15}
                      max={300}
                      step={15}
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        )}

        {/* Футер с кнопками */}
        <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <button className="ghost" onClick={onClose}>
            {lang === "ru" ? "Закрыть" : "Close"}
          </button>
          <button
            className="primary"
            onClick={handleApply}
            disabled={busy || !selPattern}
            style={{ minWidth: 180, fontWeight: 700 }}
          >
            {busy ? (
              <span className="spinner" />
            ) : (
              <>
                <Icon name="zap" /> {lang === "ru" ? "Применить паттерн" : "Apply Pattern"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
