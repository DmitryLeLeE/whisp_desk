import { useState } from "react";
import Icon from "./Icon";

export interface StartPreset {
  id: string;
  title: string;
  desc: string;
  tag: string;
  profile: "careful" | "standard" | "aggressive";
  transcribe: boolean;
  manual?: boolean;
}

export const START_PRESETS: StartPreset[] = [
  { id: "auto", title: "Авто: паузы и субтитры", tag: "Рекомендуется", desc: "Лекции, уроки, подкасты. Вырежет явные паузы и сразу распознает речь. Останется проверить результат.", profile: "standard", transcribe: true },
  { id: "dynamic", title: "Динамичный (Shorts, Reels)", tag: "Быстрый темп", desc: "Режет даже короткие паузы (от 0,7 с) и распознаёт речь для субтитров на видео.", profile: "aggressive", transcribe: true },
  { id: "gentle", title: "Бережный (интервью, беседы)", tag: "Мягкий монтаж", desc: "Оставляет паузы на размышления (режет от 2 с). Подходит для разговоров и медленной речи.", profile: "careful", transcribe: true },
  { id: "cuts", title: "Только паузы", tag: "Быстро", desc: "Найдёт паузы, субтитры не делает. Первый результат через минуту, субтитры можно добавить позже.", profile: "standard", transcribe: false },
  { id: "manual", title: "Настрою вручную", tag: "Для опытных", desc: "Открыть шаг «Исходники» и выбрать профиль, порог и движок самому.", profile: "standard", transcribe: false, manual: true },
];

export const LANGS: [string, string][] = [["ru", "Русский"], ["en", "English"], ["auto", "Определить автоматически"]];

export default function StartDialog({ filename, busy, onStart, onClose }: {
  filename: string; busy: boolean; onStart: (preset: StartPreset, language: string) => void; onClose: () => void;
}) {
  const [sel, setSel] = useState("auto");
  const [language, setLanguage] = useState(() => { try { return localStorage.getItem("whisp_start_lang") || "ru"; } catch { return "ru"; } });
  const preset = START_PRESETS.find((p) => p.id === sel)!;
  const go = () => { try { localStorage.setItem("whisp_start_lang", language); } catch { /* ignore */ } onStart(preset, language); };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog start-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Как обработать видео">
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>Как обработать видео?</h2>
            <p className="muted small" style={{ margin: "2px 0 0", wordBreak: "break-all" }}>{filename}</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="modal-body">
          <div className="start-grid" role="radiogroup">
            {START_PRESETS.map((p) => (
              <label key={p.id} className={`start-card ${sel === p.id ? "on" : ""}`}>
                <input type="radio" name="start" checked={sel === p.id} onChange={() => setSel(p.id)} />
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <b>{p.title}</b>
                  <span className={`badge ${p.id === "auto" ? "ok" : ""}`}>{p.tag}</span>
                </div>
                <span className="muted small">{p.desc}</span>
              </label>
            ))}
          </div>
          {preset.transcribe && (
            <label className="start-lang">
              Язык речи в видео
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
              </select>
              <span className="muted small">При первой расшифровке скачается модель (около 1,6 ГБ), дальше она хранится на диске.</span>
            </label>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Отмена</button>
          <button className="primary" disabled={busy} onClick={go}>
            <Icon name={preset.manual ? "sliders" : "play"} /> {preset.manual ? "Открыть настройки" : "Начать"}
          </button>
        </div>
      </div>
    </div>
  );
}
