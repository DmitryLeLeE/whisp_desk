import { useTranslation } from "../i18n";
import Icon from "./Icon";

export default function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const { lang, t } = useTranslation();

  const shortcuts = lang === "ru" ? [
    { key: "Пробел", action: "Пуск / Пауза воспроизведения" },
    { key: "← / →", action: "Перемещение на 1 кадр назад / вперёд" },
    { key: "Shift + ← / →", action: "Перемещение на 5 секунд назад / вперёд" },
    { key: "I / O", action: "Установить точку входа (In) и выхода (Out)" },
    { key: "K", action: "Оставить фрагмент (KEEP)" },
    { key: "C", action: "Вырезать фрагмент (CUT)" },
    { key: "S", action: "Разделить сегмент по текущему кадру (Split)" },
    { key: "L", action: "Заблокировать/разблокировать фрагмент от правок" },
    { key: "R", action: "Отметить решение как проверенное (Review)" },
    { key: "Enter", action: "Принять решение и перейти к следующему непроверенному" },
    { key: "N", action: "Перейти к следующему непроверенному без изменений" },
    { key: "Ctrl + Z", action: "Отменить действие (Undo)" },
    { key: "Ctrl + Shift + Z", action: "Повторить действие (Redo)" },
    { key: "Ctrl + Колесо мыши", action: "Масштабирование таймлайна (Zoom)" },
    { key: "?", action: "Показать эту справку" },
  ] : [
    { key: "Space", action: "Play / Pause playback" },
    { key: "← / →", action: "Step 1 frame backward / forward" },
    { key: "Shift + ← / →", action: "Jump 5 seconds backward / forward" },
    { key: "I / O", action: "Set In / Out interval points" },
    { key: "K", action: "Keep selected segment" },
    { key: "C", action: "Cut selected segment" },
    { key: "S", action: "Split segment at current frame" },
    { key: "L", action: "Lock / unlock segment from edits" },
    { key: "R", action: "Mark segment as reviewed" },
    { key: "Enter", action: "Accept decision & jump to next unreviewed" },
    { key: "N", action: "Next unreviewed segment" },
    { key: "Ctrl + Z", action: "Undo last edit" },
    { key: "Ctrl + Shift + Z", action: "Redo edit" },
    { key: "Ctrl + Mouse Wheel", action: "Zoom timeline in / out" },
    { key: "?", action: "Show this help dialog" },
  ];

  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <Icon name="help" />
            <h2>{t("common.shortcuts")}</h2>
          </div>
          <button className="ghost" onClick={onClose}><Icon name="x" /></button>
        </div>
        <p className="muted small">
          {lang === "ru"
            ? "Горячие клавиши активны в окне монтажа. Вы можете управлять воспроизведением и разметкой без мыши."
            : "Keyboard shortcuts work directly inside the editor timeline."}
        </p>
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          <table className="kbd-table">
            <tbody>
              {shortcuts.map((s) => (
                <tr key={s.key}>
                  <td style={{ width: 180 }}><kbd>{s.key}</kbd></td>
                  <td>{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <button className="primary" onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}
