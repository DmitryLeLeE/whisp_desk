export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Состояние сохранения: сколько записывающих запросов сейчас в пути и чем закончился последний. */
export interface SaveSnapshot { pending: number; lastSaved: number | null; failed: boolean }
let saveSnap: SaveSnapshot = { pending: 0, lastSaved: null, failed: false };
const saveListeners = new Set<() => void>();
const setSave = (patch: Partial<SaveSnapshot>) => { saveSnap = { ...saveSnap, ...patch }; saveListeners.forEach((l) => l()); };
export const saveState = {
  subscribe: (l: () => void) => { saveListeners.add(l); return () => { saveListeners.delete(l); }; },
  get: () => saveSnap,
};
const tracksSave = (method: string, url: string) => method !== "GET" && !/\/(open-file|reveal|download|analyze|render|transcribe)\b/.test(url);

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const track = tracksSave(method, url);
  if (track) setSave({ pending: saveSnap.pending + 1 });
  try {
    const r = await rawRequest<T>(method, url, body);
    if (track) setSave({ failed: false });
    return r;
  } catch (e) {
    if (track) setSave({ failed: true });
    throw e;
  } finally {
    if (track) {
      const failed = saveSnap.failed;
      setSave({ pending: Math.max(0, saveSnap.pending - 1), ...(failed ? {} : { lastSaved: Date.now() }) });
    }
  }
}

async function rawRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch { /* ответ без JSON */ }
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T,>(url: string) => request<T>("GET", url),
  post: <T,>(url: string, body: unknown = {}) => request<T>("POST", url, body),
  put: <T,>(url: string, body: unknown) => request<T>("PUT", url, body),
  patch: <T,>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: (url: string) => request<void>("DELETE", url),
  async upload<T>(url: string, file: File): Promise<T> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) {
      const j = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail), res.status);
    }
    return res.json() as Promise<T>;
  },
};

export const fmtTime = (ms: number, withMs = true): string => {
  const total = Math.max(0, ms);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const base = `${h ? h + ":" : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
  return withMs ? `${base}.${String(Math.floor(total % 1000)).padStart(3, "0")}` : base;
};

/** Разбор «чч:мм:сс.mmm», «мм:сс» или секунд. Возвращает миллисекунды или null. */
export const parseTime = (text: string): number | null => {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || isNaN(Number(p)))) return null;
  const nums = parts.map(Number);
  let sec = 0;
  for (const n of nums) sec = sec * 60 + n;
  return Math.round(sec * 1000);
};

export const fmtSize = (bytes: number): string =>
  bytes > 2 ** 30 ? `${(bytes / 2 ** 30).toFixed(2)} ГБ` : bytes > 2 ** 20 ? `${(bytes / 2 ** 20).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`;
