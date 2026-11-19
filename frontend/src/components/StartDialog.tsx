import { useState } from "react";
import { useTranslation } from "../i18n";
import Icon from "./Icon";

export interface StartPreset {
  id: string;
  title: string;
  desc: string;
  tag: string;
  en: { title: string; desc: string; tag: string };
  profile: "careful" | "standard" | "aggressive";
  transcribe: boolean;
  manual?: boolean;
}

export const START_PRESETS: StartPreset[] = [
  { id: "auto", title: "Авто: паузы и субтитры", tag: "Рекомендуется", desc: "Лекции, уроки, подкасты. Вырежет явные паузы и сразу распознает речь. Останется проверить результат.", en: { title: "Auto: pauses and subtitles", desc: "Lectures, lessons, podcasts. Cuts clear pauses and transcribes speech right away. You only review the result.", tag: "Recommended" }, profile: "standard", transcribe: true },
  { id: "dynamic", title: "Динамичный (Shorts, Reels)", tag: "Быстрый темп", desc: "Режет даже короткие паузы (от 0,7 с) и распознаёт речь для субтитров на видео.", en: { title: "Dynamic (Shorts, Reels)", desc: "Cuts even short pauses (from 0.7 s) and transcribes speech for on-video subtitles.", tag: "Fast pace" }, profile: "aggressive", transcribe: true },
  { id: "gentle", title: "Бережный (интервью, беседы)", tag: "Мягкий монтаж", desc: "Оставляет паузы на размышления (режет от 2 с). Подходит для разговоров и медленной речи.", en: { title: "Gentle (interviews, talks)", desc: "Keeps pauses for thinking (cuts from 2 s). Good for conversations and slow speech.", tag: "Soft edit" }, profile: "careful", transcribe: true },
  { id: "cuts", title: "Только паузы", tag: "Быстро", desc: "Найдёт паузы, субтитры не делает. Первый результат через минуту, субтитры можно добавить позже.", en: { title: "Pauses only", desc: "Finds pauses, no subtitles. First result in about a minute; subtitles can be added later.", tag: "Fast" }, profile: "standard", transcribe: false },
  { id: "manual", title: "Настрою вручную", tag: "Для опытных", desc: "Открыть шаг «Исходники» и выбрать профиль, порог и движок самому.", en: { title: "I will set it up myself", desc: "Open the Setup step and choose profile, threshold and engine yourself.", tag: "For advanced users" }, profile: "standard", transcribe: false, manual: true },
];

export const LANGS: [string, string][] = [["ru", "Русский"], ["en", "English"], ["auto", "Определить автоматически / Auto-detect"]];

export default function StartDialog({ filename, busy, onStart, onClose }: {
  filename: string; busy: boolean; onStart: (preset: StartPreset, language: string) => void; onClose: () => void;
}) {
  const { lang } = useTranslation();
  const ru = lang === "ru";
  const [sel, setSel] = useState(() => { try { return localStorage.getItem("whisp_start_preset") || "auto"; } catch { return "auto"; } });
  const [language, setLanguage] = useState(() => { try { return localStorage.getItem("whisp_start_lang") || "ru"; } catch { return "ru"; } });
  const [skipNext, setSkipNext] = useState(false);
  const preset = START_PRESETS.find((p) => p.id === sel)!;
  const go = () => { try { localStorage.setItem("whisp_start_lang", language); localStorage.setItem("whisp_start_preset", sel); if (skipNext) localStorage.setItem("whisp_start_skip", "1"); } catch { /* ignore */ } onStart(preset, language); };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog start-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={ru ? "Как обработать видео" : "How to process the video"}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>{ru ? "Как обработать видео?" : "How should the video be processed?"}</h2>
            <p className="muted small" style={{ margin: "2px 0 0", wordBreak: "break-all" }}>{filename}</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label={ru ? "Закрыть" : "Close"}>✕</button>
        </div>
        <div className="modal-body">
          <div className="start-grid" role="radiogroup">
            {START_PRESETS.map((p) => (
              <label key={p.id} className={`start-card ${sel === p.id ? "on" : ""}`}>
                <input type="radio" name="start" checked={sel === p.id} onChange={() => setSel(p.id)} />
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <b>{ru ? p.title : p.en.title}</b>
                  <span className={`badge ${p.id === "auto" ? "ok" : ""}`}>{ru ? p.tag : p.en.tag}</span>
                </div>
                <span className="muted small">{ru ? p.desc : p.en.desc}</span>
              </label>
            ))}
          </div>
          <label className="check" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={skipNext} onChange={(e) => setSkipNext(e.target.checked)} />
            <span>{ru ? "Больше не спрашивать, всегда использовать этот выбор (можно вернуть в «Настройки и модели»)" : "Do not ask again, always use this choice (can be re-enabled in Settings)"}</span>
          </label>
          {preset.transcribe && (
            <label className="start-lang">
              {ru ? "Язык речи в видео" : "Spoken language"}
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
              </select>
              <span className="muted small">{ru ? "При первой расшифровке скачается модель (около 1,6 ГБ), дальше она хранится на диске." : "The first transcription downloads a model (about 1.6 GB); it is kept on disk afterwards."}</span>
            </label>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>{ru ? "Отмена" : "Cancel"}</button>
          <button className="primary" disabled={busy} onClick={go}>
            <Icon name={preset.manual ? "sliders" : "play"} /> {preset.manual ? (ru ? "Открыть настройки" : "Open settings") : (ru ? "Начать" : "Start")}
          </button>
        </div>
      </div>
    </div>
  );
}
