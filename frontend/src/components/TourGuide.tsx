import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import Icon from "./Icon";

export interface TourStep {
  id: string;
  targetSelector: string;
  title: string;
  content: string;
  placement?: "bottom" | "top" | "left" | "right";
}

interface TourGuideProps {
  steps: TourStep[];
  isOpen: boolean;
  onClose: () => void;
  onComplete?: () => void;
  lang?: "ru" | "en";
}

export default function TourGuide({
  steps,
  isOpen,
  onClose,
  onComplete,
  lang = "ru",
}: TourGuideProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [placement, setPlacement] = useState<"bottom" | "top" | "left" | "right">("bottom");
  const [coords, setCoords] = useState<{ top: number; left: number; arrowOffset?: number }>({ top: 100, left: 100 });

  const step = steps[currentIdx];

  const updatePosition = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.targetSelector) as HTMLElement | null;
    if (!el) {
      setRect(null);
      return;
    }

    const r = el.getBoundingClientRect();
    setRect(r);

    // Вычисляем оптимальное положение всплывающего окна
    const cardWidth = Math.min(380, window.innerWidth - 32);
    const cardHeight = 220; // приближенная высота карточки
    const margin = 16;
    const arrowMargin = 12;

    let targetPlacement = step.placement ?? "bottom";

    // Автоматическая корректировка, если не помещается снизу
    if (targetPlacement === "bottom" && r.bottom + cardHeight + margin > window.innerHeight) {
      if (r.top - cardHeight - margin > 0) {
        targetPlacement = "top";
      }
    } else if (targetPlacement === "top" && r.top - cardHeight - margin < 0) {
      if (r.bottom + cardHeight + margin < window.innerHeight) {
        targetPlacement = "bottom";
      }
    }

    setPlacement(targetPlacement);

    let top = 0;
    let left = 0;
    let arrowOffset = 0;

    if (targetPlacement === "bottom") {
      top = r.bottom + arrowMargin;
      left = r.left + r.width / 2 - cardWidth / 2;
    } else if (targetPlacement === "top") {
      top = r.top - cardHeight - arrowMargin;
      left = r.left + r.width / 2 - cardWidth / 2;
    } else if (targetPlacement === "left") {
      left = r.left - cardWidth - arrowMargin;
      top = r.top + r.height / 2 - cardHeight / 2;
    } else if (targetPlacement === "right") {
      left = r.right + arrowMargin;
      top = r.top + r.height / 2 - cardHeight / 2;
    }

    // Удерживаем внутри экрана
    const minLeft = 16;
    const maxLeft = window.innerWidth - cardWidth - 16;
    const clampedLeft = Math.max(minLeft, Math.min(maxLeft, left));
    arrowOffset = r.left + r.width / 2 - clampedLeft;

    const clampedTop = Math.max(16, Math.min(window.innerHeight - cardHeight - 16, top));

    setCoords({ top: clampedTop, left: clampedLeft, arrowOffset });
  }, [step]);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentIdx(0);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !step) return;

    const el = document.querySelector(step.targetSelector) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }

    updatePosition();
    const timer = setTimeout(updatePosition, 150);

    const onScrollOrResize = () => updatePosition();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [isOpen, step, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (currentIdx < steps.length - 1) {
          setCurrentIdx((i) => i + 1);
        } else {
          onComplete ? onComplete() : onClose();
        }
      } else if (e.key === "ArrowLeft") {
        if (currentIdx > 0) setCurrentIdx((i) => i - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, currentIdx, steps.length, onClose, onComplete]);

  if (!isOpen || !step) return null;

  const isLast = currentIdx === steps.length - 1;
  const isFirst = currentIdx === 0;

  const next = () => {
    if (!isLast) {
      setCurrentIdx((i) => i + 1);
    } else {
      if (onComplete) onComplete();
      onClose();
    }
  };

  const prev = () => {
    if (!isFirst) setCurrentIdx((i) => i - 1);
  };

  const pad = 6;
  const rx = 10;

  return (
    <div className="tour-overlay" aria-modal="true" role="dialog">
      {/* Затемняющая SVG-маска с отверстием вокруг подсвечиваемого элемента */}
      <svg className="tour-mask" width="100%" height="100%">
        <defs>
          <mask id="tour-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - pad}
                y={rect.top - pad}
                width={rect.width + pad * 2}
                height={rect.height + pad * 2}
                rx={rx}
                ry={rx}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(8, 10, 16, 0.75)"
          mask="url(#tour-spotlight-mask)"
        />
      </svg>

      {/* Пульсирующая рамка-подсветка вокруг элемента */}
      {rect && (
        <div
          className="tour-highlight-ring"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            borderRadius: rx,
          }}
        />
      )}

      {/* Всплывающая интерактивная карточка с указателем-стрелочкой */}
      <div
        className={`tour-card tour-arrow-${placement}`}
        style={{
          top: coords.top,
          left: coords.left,
          "--arrow-offset": `${Math.max(20, Math.min(340, coords.arrowOffset ?? 40))}px`,
        } as React.CSSProperties}
      >
        <div className="tour-head">
          <span className="tour-badge">
            {lang === "ru" ? `Шаг ${currentIdx + 1} из ${steps.length}` : `Step ${currentIdx + 1} of ${steps.length}`}
          </span>
          <button className="tour-close" onClick={onClose} aria-label="Close" title={lang === "ru" ? "Закрыть тур" : "Close tour"}>
            <Icon name="x" />
          </button>
        </div>

        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-content">{step.content}</p>

        <div className="tour-dots">
          {steps.map((s, idx) => (
            <span
              key={s.id}
              className={`tour-dot ${idx === currentIdx ? "active" : ""} ${idx < currentIdx ? "passed" : ""}`}
              onClick={() => setCurrentIdx(idx)}
            />
          ))}
        </div>

        <div className="tour-footer">
          <button className="tour-skip" onClick={onClose}>
            {lang === "ru" ? "Пропустить" : "Skip"}
          </button>
          <div className="row" style={{ gap: 8 }}>
            {!isFirst && (
              <button className="ghost small" onClick={prev}>
                <Icon name="chevron-left" /> {lang === "ru" ? "Назад" : "Back"}
              </button>
            )}
            <button className="primary small" onClick={next}>
              {isLast ? (lang === "ru" ? "Завершить ✓" : "Finish ✓") : (lang === "ru" ? "Далее →" : "Next →")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
