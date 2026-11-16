/** Окно приложения (pywebview) отдаёт настоящие диалоги выбора файла; в обычном браузере используется встроенный обзор. */
declare global {
  interface Window {
    pywebview?: { api?: { pick_file?: () => Promise<string | null>; pick_folder?: () => Promise<string | null>; toggle_fullscreen?: () => void } };
  }
}

export const hasNativePicker = (): boolean => typeof window.pywebview?.api?.pick_file === "function";

export async function nativePickFile(): Promise<string | null> {
  return (await window.pywebview?.api?.pick_file?.()) ?? null;
}

export async function nativePickFolder(): Promise<string | null> {
  return (await window.pywebview?.api?.pick_folder?.()) ?? null;
}
