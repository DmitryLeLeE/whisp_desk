import { api, fmtSize } from "../api";
import type { WhispModel } from "../types";
import { useTranslation } from "../i18n";
import Icon from "./Icon";

const sizeLabel = (mb: number, ru: boolean) => (mb >= 1000 ? `≈ ${(mb / 1000).toFixed(1)} ${ru ? "ГБ" : "GB"}` : `≈ ${mb} ${ru ? "МБ" : "MB"}`);

/** Карточки моделей Whisp: состояние загрузки, скачать и отменить. Используется в настройках и на шаге «Субтитры». */
export default function ModelCards({ models, selected, onSelect, onChanged, onError, compact }: {
  compact?: boolean; models: WhispModel[]; selected?: string; onSelect?: (name: string) => void; onChanged: () => void; onError: (m: string) => void;
}) {
  const { lang } = useTranslation();
  const ru = lang === "ru";
  const act = async (fn: () => Promise<unknown>) => { onError(""); try { await fn(); onChanged(); } catch (e) { onError((e as Error).message); } };
  return (
    <div className={`models ${compact ? "compact" : ""}`}>
      {models.map((m) => {
        const d = m.download;
        const pct = d && d.total ? Math.round((d.done / d.total) * 100) : 0;
        const selectable = !!onSelect;
        return (
          <div key={m.name} className={`model ${selectable ? "pick-able" : ""} ${selected === m.name ? "on" : ""}`}
            onClick={() => selectable && onSelect?.(m.name)} role={selectable ? "radio" : undefined} aria-checked={selectable ? selected === m.name : undefined}>
            <div className="top"><b>{m.name}</b>
              {m.name === "turbo" && <span className="badge accent">{ru ? "рекомендуется" : "recommended"}</span>}
              <span className="grow" />
              {m.downloaded === true && <span className="badge ok"><Icon name="check" /> {ru ? "скачана" : "downloaded"}</span>}
              {m.downloaded === false && !d && <span className="badge">{ru ? "нужна загрузка" : "download needed"}</span>}
            </div>
            <span className="muted small">{m.quality} · {m.speed} · {sizeLabel(m.size_mb, ru)}</span>
            {d?.state === "running" && (
              <>
                <div className="bar"><i style={{ width: `${Math.max(3, pct)}%` }} /></div>
                <span className="muted small">{d.total ? `${fmtSize(d.done)} ${ru ? "из" : "of"} ${fmtSize(d.total)} (${pct}%)` : (ru ? "Подключение…" : "Connecting…")}</span>
                <button onClick={(e) => { e.stopPropagation(); act(() => api.del(`/api/whisp/models/${m.name}/download`)); }}>{ru ? "Отменить загрузку" : "Cancel download"}</button>
              </>
            )}
            {d?.state === "error" && <span className="error small">{d.error}</span>}
            {!compact && m.downloaded === false && d?.state !== "running" && (
              <button onClick={(e) => { e.stopPropagation(); act(() => api.post(`/api/whisp/models/${m.name}/download`)); }}><Icon name="download" /> {ru ? "Скачать заранее" : "Download in advance"}</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
