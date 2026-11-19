import { useState } from "react";
import { useTranslation } from "../i18n";
import Icon from "./Icon";

export default function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const { lang, t } = useTranslation();
  const [preset, setPreset] = useState(() => localStorage.getItem("whisp_kbd_preset") || "whisp");

  const changePreset = (p: string) => {
    setPreset(p);
    localStorage.setItem("whisp_kbd_preset", p);
    window.dispatchEvent(new Event("whisp_kbd_preset_changed"));
  };

  const shortcutsWhispRu = [
    { key: "Пробел", action: "Пуск / Пауза воспроизведения" },
    { key: "J / L", action: "Перемотка назад / вперёд на 2 секунды (Shift: 5 с)" },
    { key: "← / →", action: "Перемещение на 1 кадр назад / вперёд" },
    { key: "Q", action: "Ripple Cut слева (обрезать начало до курсора)" },
    { key: "W", action: "Ripple Cut справа (обрезать конец от курсора)" },
    { key: "S", action: "Разрезать сегмент по текущему кадру (Split)" },
    { key: "C", action: "Вырезать выбранный сегмент (CUT)" },
    { key: "K", action: "Оставить выбранный фрагмент (KEEP)" },
    { key: "I / O", action: "Установить точку входа (In) и выхода (Out)" },
    { key: "M", action: "Поставить или изменить маркер (Marker)" },
    { key: "L", action: "Заблокировать/разблокировать фрагмент от правок" },
    { key: "R", action: "Отметить решение как проверенное (Review)" },
    { key: "Enter", action: "Принять решение и перейти к следующему непроверенному" },
    { key: "N", action: "Перейти к следующему непроверенному без изменений" },
    { key: "Ctrl + Z", action: "Отменить действие (Undo)" },
    { key: "Ctrl + Shift + Z", action: "Повторить действие (Redo)" },
    { key: "Ctrl + Колесо мыши", action: "Масштабирование таймлайна (Zoom)" },
    { key: "~ / F11", action: "Полноэкранный режим монитора (Fullscreen)" },
    { key: "?", action: "Показать эту справку" },
  ];

  const shortcutsPremiereRu = [
    { key: "Пробел", action: "Пуск / Пауза воспроизведения" },
    { key: "J / K / L", action: "Транспорт: Назад / Пауза / Вперёд (нажатия ускоряют)" },
    { key: "C", action: "Разрезать фрагмент по курсору" },
    { key: "Q", action: "Ripple Trim In (Удалить начало фрагмента до курсора)" },
    { key: "W", action: "Ripple Trim Out (Удалить конец фрагмента от курсора)" },
    { key: "I / O", action: "Mark In / Mark Out (Метки начала и конца)" },
    { key: "M", action: "Add Marker (Добавить маркер)" },
    { key: "← / →", action: "Шаг на 1 кадр назад / вперёд" },
    { key: "Shift + ← / →", action: "Шаг на 5 секунд" },
    { key: "Ctrl + Z", action: "Отменить (Undo)" },
    { key: "Ctrl + Shift + Z", action: "Повторить (Redo)" },
    { key: "~ / F11", action: "Полноэкранный просмотр видео" },
    { key: "Ctrl + Колесо мыши", action: "Зум таймлайна" },
  ];

  const shortcutsDaVinciRu = [
    { key: "Пробел", action: "Пуск / Пауза воспроизведения" },
    { key: "J / K / L", action: "Shuttle: Назад / Пауза / Вперёд" },
    { key: "B", action: "Blade Tool (Лезвие / Разрез по курсору)" },
    { key: "Q / W", action: "Ripple Cut начала / конца фрагмента" },
    { key: "I / O", action: "Метки In и Out" },
    { key: "M", action: "Добавить маркер таймлайна" },
    { key: "Ctrl + Z", action: "Отменить" },
    { key: "Ctrl + Shift + Z", action: "Повторить" },
    { key: "~ / F11", action: "Полноэкранный режим монитора" },
  ];

  const shortcutsWhispEn = [
    { key: "Space", action: "Play / Pause playback" },
    { key: "J / L", action: "Jump 2 seconds backward / forward (Shift: 5s)" },
    { key: "← / →", action: "Step 1 frame backward / forward" },
    { key: "Q", action: "Ripple cut left (trim start to playhead)" },
    { key: "W", action: "Ripple cut right (trim playhead to end)" },
    { key: "S", action: "Split segment at current frame" },
    { key: "C", action: "Cut selected segment" },
    { key: "K", action: "Keep selected segment" },
    { key: "I / O", action: "Set In / Out points" },
    { key: "M", action: "Add or edit timeline marker" },
    { key: "L", action: "Lock / unlock segment" },
    { key: "R", action: "Mark segment as reviewed" },
    { key: "Enter", action: "Accept decision & jump to next unreviewed" },
    { key: "N", action: "Next unreviewed segment" },
    { key: "Ctrl + Z", action: "Undo last edit" },
    { key: "Ctrl + Shift + Z", action: "Redo edit" },
    { key: "Ctrl + Mouse Wheel", action: "Zoom timeline in / out" },
    { key: "~ / F11", action: "Fullscreen Program Monitor" },
    { key: "?", action: "Show this help dialog" },
  ];

  const shortcutsPremiereEn = [
    { key: "Space", action: "Play / Pause" },
    { key: "J / K / L", action: "Transport Shuttle: Rewind / Pause / Fast Forward" },
    { key: "C", action: "Razor Tool (Cut at playhead)" },
    { key: "Q", action: "Ripple Trim In (Trim head to playhead)" },
    { key: "W", action: "Ripple Trim Out (Trim tail from playhead)" },
    { key: "I / O", action: "Set In / Out marks" },
    { key: "M", action: "Add Marker" },
    { key: "Ctrl + Z / Ctrl + Shift + Z", action: "Undo / Redo" },
    { key: "~ / F11", action: "Fullscreen Program Monitor" },
  ];

  const shortcutsDaVinciEn = [
    { key: "Space", action: "Play / Pause" },
    { key: "J / K / L", action: "Shuttle: Reverse / Stop / Forward" },
    { key: "B", action: "Blade Tool (Split at playhead)" },
    { key: "Q / W", action: "Ripple Trim In / Out" },
    { key: "I / O", action: "Set In / Out" },
    { key: "M", action: "Add Marker" },
    { key: "Ctrl + Z", action: "Undo" },
    { key: "~ / F11", action: "Fullscreen Monitor" },
  ];

  const list = lang === "ru"
    ? (preset === "premiere" ? shortcutsPremiereRu : preset === "davinci" ? shortcutsDaVinciRu : shortcutsWhispRu)
    : (preset === "premiere" ? shortcutsPremiereEn : preset === "davinci" ? shortcutsDaVinciEn : shortcutsWhispEn);

  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <Icon name="help" />
            <h2>{t("common.shortcuts")}</h2>
          </div>
          <button className="ghost" onClick={onClose}><Icon name="x" /></button>
        </div>

        <div className="row" style={{ marginTop: 12, marginBottom: 12, gap: 10, alignItems: "center" }}>
          <span className="small muted">{lang === "ru" ? "Пресет раскладки:" : "Shortcuts Profile:"}</span>
          <select value={preset} onChange={(e) => changePreset(e.target.value)} style={{ padding: "4px 8px" }}>
            <option value="whisp">Whisp Desk (Default)</option>
            <option value="premiere">Adobe Premiere Pro</option>
            <option value="davinci">DaVinci Resolve</option>
          </select>
        </div>

        <p className="muted small">
          {lang === "ru"
            ? "Горячие клавиши активны в окне монтажа. Вы можете управлять воспроизведением и разметкой без мыши."
            : "Keyboard shortcuts work directly inside the editor timeline."}
        </p>

        <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
          <table className="kbd-table">
            <tbody>
              {list.map((s) => (
                <tr key={s.key}>
                  <td style={{ width: 140 }}><kbd>{s.key}</kbd></td>
                  <td>{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="primary" onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}
