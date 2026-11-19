import { useSyncExternalStore } from "react";
import { saveState } from "../api";
import { useTranslation } from "../i18n";
import Icon from "./Icon";

/** «Сохранено» в шапке проекта: правки пишутся на диск сразу, индикатор показывает, дошла ли последняя. */
export default function SaveIndicator() {
  const { lang } = useTranslation();
  const ru = lang === "ru";
  const s = useSyncExternalStore(saveState.subscribe, saveState.get);
  if (s.pending > 0) return <span className="save-ind saving" role="status">{ru ? "Сохраняется…" : "Saving…"}</span>;
  if (s.failed) return <span className="save-ind failed" role="status" title={ru ? "Последняя правка не записана. Повторите действие." : "The last change was not saved. Try again."}>{ru ? "Не сохранено" : "Not saved"}</span>;
  if (s.lastSaved == null) return null;
  const time = new Date(s.lastSaved).toLocaleTimeString(ru ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit" });
  return (
    <span className="save-ind saved" role="status" title={(ru ? "Все правки записаны на диск, " : "All changes are written to disk, ") + time}>
      <Icon name="check" /> {ru ? "Сохранено" : "Saved"}
    </span>
  );
}
