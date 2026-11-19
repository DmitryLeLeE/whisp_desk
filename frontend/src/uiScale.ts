const KEY = "whisp_ui_scale";

export const getUiScale = (): number => {
  try {
    const v = parseFloat(localStorage.getItem(KEY) ?? "");
    return v >= 0.8 && v <= 1.5 ? v : 1;
  } catch { return 1; }
};

/** Масштаб всего интерфейса: zoom на корне, высота экрана компенсируется переменной --ui-zoom. */
export const applyUiScale = (v: number = getUiScale()) => {
  const root = document.documentElement;
  root.style.setProperty("--ui-zoom", String(v));
  (root.style as CSSStyleDeclaration & { zoom: string }).zoom = v === 1 ? "" : String(v);
};

export const setUiScaleValue = (v: number) => {
  try { localStorage.setItem(KEY, String(v)); } catch { /* ignore */ }
  applyUiScale(v);
};
