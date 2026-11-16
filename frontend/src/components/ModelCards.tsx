import { api, fmtSize } from "../api";
import type { WhispModel } from "../types";
import Icon from "./Icon";

const sizeLabel = (mb: number) => (mb >= 1000 ? `≈ ${(mb / 1000).toFixed(1)} ГБ` : `≈ ${mb} МБ`);

/** Карточки моделей Whisp: состояние загрузки, скачать и отменить. Используется в настройках и на шаге «Субтитры». */
export default function ModelCards({ models, selected, onSelect, onChanged, onError }: {
  models: WhispModel[]; selected?: string; onSelect?: (name: string) => void; onChanged: () => void; onError: (m: string) => void;
}) {
  const act = async (fn: () => Promise<unknown>) => { onError(""); try { await fn(); onChanged(); } catch (e) { onError((e as Error).message); } };
  return (
    <div className="models">
      {models.map((m) => {
        const d = m.download;
        const pct = d && d.total ? Math.round((d.done / d.total) * 100) : 0;
        const selectable = !!onSelect;
        return (
          <div key={m.name} className={`model ${selectable ? "pick-able" : ""} ${selected === m.name ? "on" : ""}`}
            onClick={() => selectable && onSelect?.(m.name)} role={selectable ? "radio" : undefined} aria-checked={selectable ? selected === m.name : undefined}>
            <div className="top"><b>{m.name}</b>
              {m.name === "turbo" && <span className="badge accent">рекомендуется</span>}
              <span className="grow" />
              {m.downloaded === true && <span className="badge ok"><Icon name="check" /> скачана</span>}
              {m.downloaded === false && !d && <span className="badge">не скачана</span>}
            </div>
            <span className="muted small">{m.quality} · {m.speed} · {sizeLabel(m.size_mb)}</span>
            {d?.state === "running" && (
              <>
                <div className="bar"><i style={{ width: `${Math.max(3, pct)}%` }} /></div>
                <span className="muted small">{d.total ? `${fmtSize(d.done)} из ${fmtSize(d.total)} (${pct}%)` : "Подключение…"}</span>
                <button onClick={(e) => { e.stopPropagation(); act(() => api.del(`/api/whisp/models/${m.name}/download`)); }}>Отменить загрузку</button>
              </>
            )}
            {d?.state === "error" && <span className="error small">{d.error}</span>}
            {m.downloaded === false && d?.state !== "running" && (
              <button onClick={(e) => { e.stopPropagation(); act(() => api.post(`/api/whisp/models/${m.name}/download`)); }}><Icon name="download" /> Скачать заранее</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
