import { useEffect, useState } from "react";

export type Language = "ru" | "en";

const DICT: Record<Language, Record<string, string>> = {
  ru: {
    // Nav & Common
    "brand.title": "WHISP",
    "brand.sub": "MEDIA DESK",
    "nav.projects": "Проекты",
    "nav.settings": "Настройки и модели",
    "nav.theme.dark": "Тёмная тема",
    "nav.theme.light": "Светлая тема",
    "nav.lang": "Язык: RU",
    "common.cancel": "Отмена",
    "common.save": "Сохранить",
    "common.delete": "Удалить",
    "common.edit": "Редактировать",
    "common.apply": "Применить",
    "common.back": "Назад",
    "common.help": "Горячие клавиши",
    "common.loading": "Загрузка...",
    "common.error": "Ошибка",
    "common.confirm": "Подтвердить",
    "common.close": "Закрыть",
    "common.shortcuts": "Справка по клавишам",

    // Home
    "home.title": "Проекты",
    "home.subtitle": "Локальный черновой монтаж и синхронизация субтитров без облаков",
    "home.new_project": "Создать проект",
    "home.drag_drop": "Перетащите видео сюда, чтобы создать проект",
    "home.or_browse": "или выберите файл на диске",
    "home.empty": "У вас пока нет проектов. Создайте первый!",
    "home.card.duration": "Длительность",
    "home.card.reduction": "Сокращение",
    "home.card.open": "Открыть",
    "home.modal.name": "Название проекта",
    "home.modal.type": "Тип контента",
    "home.modal.type.lecture": "Лекция / Доклад",
    "home.modal.type.interview": "Интервью / Диалог",
    "home.modal.type.podcast": "Подкаст",
    "home.modal.type.generic": "Обычное видео",
    "home.modal.create": "Создать",

    // Steps
    "step.setup": "Источник и анализ",
    "step.editor": "Монтаж",
    "step.subtitles": "Субтитры",
    "step.export": "Экспорт",

    // Setup Panel
    "setup.source_file": "Исходный медиафайл",
    "setup.select_file": "Выбрать файл",
    "setup.browse": "Обзор…",
    "setup.profile": "Профиль поиска пауз",
    "setup.profile.careful": "Осторожный",
    "setup.profile.careful.desc": "Длинные паузы (от 2.0 с), мягкие запасы",
    "setup.profile.standard": "Стандартный",
    "setup.profile.standard.desc": "Оптимально для лекций и вебинаров (от 1.2 с)",
    "setup.profile.aggressive": "Агрессивный",
    "setup.profile.aggressive.desc": "Короткие паузы (от 0.7 с), плотная речь",
    "setup.btn.analyze": "Запустить анализ",
    "setup.btn.reanalyze": "Пересчитать анализ",
    "setup.btn.compare": "Сравнить движки",

    // Editor
    "editor.speed": "Скорость",
    "editor.zoom_in": "Приблизить",
    "editor.zoom_out": "Отдалить",
    "editor.zoom_fit": "По ширине",
    "editor.split": "Разрезать (S)",
    "editor.keep": "Оставить (K)",
    "editor.cut": "Вырезать (C)",
    "editor.lock": "Зафиксировать (L)",
    "editor.review": "Проверено (R)",
    "editor.next_unreviewed": "След. непроверенное (N)",
    "editor.accept_next": "Принять и перейти (Enter)",
    "editor.undo": "Отмена (Ctrl+Z)",
    "editor.redo": "Повтор (Ctrl+Shift+Z)",
    "editor.stats.source": "Исходник",
    "editor.stats.output": "Результат",
    "editor.stats.saved": "Сэкономлено",
    "editor.stats.unreviewed": "Непроверенных",
    "editor.help.title": "Горячие клавиши редактора",
    "editor.autoscroll": "Автоскролл",
    "editor.autoscroll.title": "Автоматически следовать за курсором воспроизведения",

    // Chapters
    "chapters.title": "Умные главы видео (YouTube)",
    "chapters.generate": "Сгенерировать умные главы",
    "chapters.copy_desc": "Скопировать для описания",
    "chapters.copied": "Главы скопированы в буфер обмена!",
    "chapters.hint": "Главы создаются автоматически по смысловым фразам, паузам и сменам сцен.",

    // Batch & Denoise
    "batch.title": "Пакетный импорт проектов",
    "batch.btn_analyze_all": "Запустить анализ для всех",
    "audio.denoise": "Подавление фонового шума (FFmpeg Denoiser)",
    "audio.denoise_hint": "Удаляет гул вентилятора, кондиционера и фоновое шипение микрофона (afftdn)",
    "audio.denoise_level": "Уровень шумоподавления",
    "audio.denoise.soft": "Мягкое (-6 dB)",
    "audio.denoise.std": "Стандартное (-12 dB)",
    "audio.denoise.strong": "Сильное (-18 dB)",

    // Subtitles
    "subs.tab.orig": "Оригинал",
    "subs.tab.trans": "Перевод",
    "subs.tab.bilingual": "Двуязычные",
    "subs.whisp_title": "Распознавание речи (Whisp)",
    "subs.btn.transcribe": "Расшифровать речь",
    "subs.btn.translate_only": "Перевести имеющиеся субтитры",
    "subs.import_title": "Импорт субтитров",
    "subs.import_btn": "Выбрать файл субтитров…",
    "subs.search": "Поиск по тексту…",
    "subs.edit_hint": "Дважды кликните по реплике, чтобы отредактировать текст",
    "subs.save_cues": "Сохранить изменения",
    "subs.target_lang": "Язык перевода",
    "subs.no_cues": "Субтитры ещё не загружены",

    // Export
    "export.title": "Экспорт проекта",
    "export.nle_section": "Экспорт в видеоредакторы",
    "export.premiere_title": "Adobe Premiere Pro",
    "export.premiere_desc": "Final Cut Pro 7 XML (xmeml v5) — открывается в Premiere Pro и DaVinci Resolve со всеми склейками, дорожками и привязкой исходника.",
    "export.davinci_title": "DaVinci Resolve / Final Cut Pro",
    "export.davinci_desc": "FCPXML 1.9 и маркеры таймлайна (CSV) для быстрой навигации по сокращениям.",
    "export.otio_title": "OpenTimelineIO (.otio)",
    "export.otio_desc": "Универсальный стандарт открытого обмена таймлайнами.",
    "export.edl_title": "EDL CMX3600",
    "export.edl_desc": "Для Kdenlive, Vegas Pro, Avid и классических систем.",
    "export.chapters_title": "YouTube Chapters & Audacity",
    "export.chapters_desc": "Список глав с таймкодами для плееров и текстовая дорожка меток для аудиоредакторов.",
    "export.btn_export_nle": "Экспортировать проекты для монтажа",
    "export.render_mp4": "Рендер готового MP4",
    "export.btn_render_final": "Финальный рендер MP4",
    "export.btn_render_fast": "Быстрый тест (480p)",
    "export.files_title": "Экспортированные файлы",
    "export.versions_title": "Версии монтажа",
    "export.save_version": "Сохранить версию",

    // Settings
    "settings.title": "Настройки и модели",
    "settings.models": "Модели распознавания Whisp",
    "settings.tools": "Внешние программы",

    // Tour & Help
    "tour.btn": "Обучение",
    "tour.home.step1.title": "1. Загрузка видео",
    "tour.home.step1.desc": "Перетащите видео лекции, вебинара или интервью сюда, либо нажмите кнопку «Выбрать видео».",
    "tour.home.step2.title": "2. Профиль контента",
    "tour.home.step2.desc": "Выберите тип видео: Лекция, Интервью или Подкаст. Программа подстроит чувствительность вырезки пауз.",
    "tour.home.step3.title": "3. Статус компонентов",
    "tour.home.step3.desc": "Здесь отображается готовность локального FFmpeg и Whisp, а также переключатель языка интерфейса (RU/EN).",
    "tour.home.step4.title": "4. Горячие клавиши",
    "tour.home.step4.desc": "Нажмите на иконку вопроса или клавишу «?» на клавиатуре в любой момент, чтобы увидеть список горячих клавиш.",

    "tour.project.step1.title": "1. Четыре этапа работы",
    "tour.project.step1.desc": "Пайплайн состоит из 4 шагов: Настройка параметров -> Монтаж склеек -> Субтитры и перевод -> Экспорт в монтажки.",
    "tour.project.step2.title": "2. Таймлайн и плеер",
    "tour.project.step2.desc": "Зелёные фрагменты остаются (речь), красные штрихованные — вырезаются (тишина). Клик по отрезку меняет его статус. Пробел запускает воспроизведение.",
    "tour.project.step3.title": "3. Субтитры и перевод",
    "tour.project.step3.desc": "Распознавание речи, мгновенный локальный перевод без повторного сканирования и двуязычный просмотр.",
    "tour.project.step4.title": "4. Экспорт в Premiere и DaVinci",
    "tour.project.step4.desc": "Создание готовых таймлайнов XML/FCPXML/OTIO для монтажа и рендер финального MP4.",

    // Quick Start Guide on Home
    "quickstart.title": "Быстрый старт: как работает Whisp Media Desk",
    "quickstart.btn_tour": "Интерактивный тур со стрелочками",
    "quickstart.step1.title": "1. Загрузите видео",
    "quickstart.step1.desc": "Выберите видеозапись лекции, вебинара или подкаста с локального диска.",
    "quickstart.step2.title": "2. Умная вырезка пауз",
    "quickstart.step2.desc": "Локальный анализ находит паузы и вздохи без отправки данных в облако.",
    "quickstart.step3.title": "3. Субтитры и перевод",
    "quickstart.step3.desc": "Автоматическая генерация субтитров и локальный перевод на любой язык.",
    "quickstart.step4.title": "4. Экспорт в монтажку",
    "quickstart.step4.desc": "Экспортируйте проект в Adobe Premiere Pro, DaVinci Resolve или готовый MP4.",

    // NLE Help in Export
    "export.nle_help.title": "Как импортировать в монтажные программы:",
    "export.nle_help.premiere": "В Adobe Premiere Pro: Файл > Импорт... (Ctrl+I) и выберите premiere.xml. Программа создаст таймлайн с нарезанными клипами и привязанным аудио.",
    "export.nle_help.davinci": "В DaVinci Resolve: Файл > Импорт > Временная шкала... и выберите final.fcpxml или premiere.xml. Для цветных маркеров: Таймлайн > Импорт маркеров > davinci_markers.csv.",
    "export.nle_help.fcpx": "В Final Cut Pro: File > Import > XML... и выберите final.fcpxml.",
  },
  en: {
    // Nav & Common
    "brand.title": "WHISP",
    "brand.sub": "MEDIA DESK",
    "nav.projects": "Projects",
    "nav.settings": "Settings & Models",
    "nav.theme.dark": "Dark Theme",
    "nav.theme.light": "Light Theme",
    "nav.lang": "Language: EN",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.apply": "Apply",
    "common.back": "Back",
    "common.help": "Shortcuts",
    "common.loading": "Loading...",
    "common.error": "Error",
    "common.confirm": "Confirm",
    "common.close": "Close",
    "common.shortcuts": "Keyboard Shortcuts",

    // Home
    "home.title": "Projects",
    "home.subtitle": "Local rough cut studio and subtitle sync without cloud dependencies",
    "home.new_project": "New Project",
    "home.drag_drop": "Drag & drop video here to create a project",
    "home.or_browse": "or browse local files",
    "home.empty": "No projects yet. Create your first one!",
    "home.card.duration": "Duration",
    "home.card.reduction": "Reduction",
    "home.card.open": "Open",
    "home.modal.name": "Project Name",
    "home.modal.type": "Content Type",
    "home.modal.type.lecture": "Lecture / Presentation",
    "home.modal.type.interview": "Interview / Dialogue",
    "home.modal.type.podcast": "Podcast",
    "home.modal.type.generic": "General Video",
    "home.modal.create": "Create",

    // Steps
    "step.setup": "Source & Analysis",
    "step.editor": "Editor",
    "step.subtitles": "Subtitles",
    "step.export": "Export",

    // Setup Panel
    "setup.source_file": "Source Media File",
    "setup.select_file": "Select File",
    "setup.browse": "Browse…",
    "setup.profile": "Silence Cut Profile",
    "setup.profile.careful": "Cautious",
    "setup.profile.careful.desc": "Long silences only (2.0s+), large padding",
    "setup.profile.standard": "Standard",
    "setup.profile.standard.desc": "Optimal for lectures and webinars (1.2s+)",
    "setup.profile.aggressive": "Aggressive",
    "setup.profile.aggressive.desc": "Cuts short pauses (0.7s+), tight speech pacing",
    "setup.btn.analyze": "Start Analysis",
    "setup.btn.reanalyze": "Re-run Analysis",
    "setup.btn.compare": "Compare Engines",

    // Editor
    "editor.speed": "Speed",
    "editor.zoom_in": "Zoom In",
    "editor.zoom_out": "Zoom Out",
    "editor.zoom_fit": "Fit Width",
    "editor.split": "Split (S)",
    "editor.keep": "Keep (K)",
    "editor.cut": "Cut (C)",
    "editor.lock": "Lock (L)",
    "editor.review": "Reviewed (R)",
    "editor.next_unreviewed": "Next Unreviewed (N)",
    "editor.accept_next": "Accept & Next (Enter)",
    "editor.undo": "Undo (Ctrl+Z)",
    "editor.redo": "Redo (Ctrl+Shift+Z)",
    "editor.stats.source": "Source",
    "editor.stats.output": "Result",
    "editor.stats.saved": "Saved",
    "editor.stats.unreviewed": "Unreviewed",
    "editor.help.title": "Editor Keyboard Shortcuts",
    "editor.autoscroll": "Auto-Scroll",
    "editor.autoscroll.title": "Automatically scroll timeline to follow playhead",

    // Chapters
    "chapters.title": "Smart Video Chapters (YouTube)",
    "chapters.generate": "Generate Smart Chapters",
    "chapters.copy_desc": "Copy for Video Description",
    "chapters.copied": "Chapters copied to clipboard!",
    "chapters.hint": "Chapters are generated automatically based on semantic keywords, speech pauses, and scene cuts.",

    // Batch & Denoise
    "batch.title": "Batch Project Import",
    "batch.btn_analyze_all": "Analyze All in Queue",
    "audio.denoise": "Noise Reduction (FFmpeg Denoiser)",
    "audio.denoise_hint": "Removes fan hum, air conditioning, and microphone hiss (afftdn)",
    "audio.denoise_level": "Reduction Level",
    "audio.denoise.soft": "Soft (-6 dB)",
    "audio.denoise.std": "Standard (-12 dB)",
    "audio.denoise.strong": "Aggressive (-18 dB)",

    // Subtitles
    "subs.tab.orig": "Original",
    "subs.tab.trans": "Translation",
    "subs.tab.bilingual": "Bilingual",
    "subs.whisp_title": "Speech Recognition (Whisp)",
    "subs.btn.transcribe": "Transcribe Speech",
    "subs.btn.translate_only": "Translate Subtitles",
    "subs.import_title": "Import Subtitles",
    "subs.import_btn": "Choose Subtitle File…",
    "subs.search": "Search in subtitles…",
    "subs.edit_hint": "Double-click any cue to edit text",
    "subs.save_cues": "Save Changes",
    "subs.target_lang": "Target Language",
    "subs.no_cues": "No subtitles yet",

    // Export
    "export.title": "Project Export",
    "export.nle_section": "Export to Video Editors (NLE)",
    "export.premiere_title": "Adobe Premiere Pro",
    "export.premiere_desc": "Final Cut Pro 7 XML (xmeml v5) — opens natively in Premiere Pro and DaVinci Resolve with exact cuts, linked audio, and source relinking.",
    "export.davinci_title": "DaVinci Resolve / Final Cut Pro",
    "export.davinci_desc": "FCPXML 1.9 & timeline marker CSV for fast navigation across cuts.",
    "export.otio_title": "OpenTimelineIO (.otio)",
    "export.otio_desc": "Universal open timeline interchange standard.",
    "export.edl_title": "EDL CMX3600",
    "export.edl_desc": "For Kdenlive, Vegas Pro, Avid, and legacy NLEs.",
    "export.chapters_title": "YouTube Chapters & Audacity",
    "export.chapters_desc": "Video chapters list with timestamps and audio cue label track.",
    "export.btn_export_nle": "Export NLE Project Package",
    "export.render_mp4": "Render MP4 Video",
    "export.btn_render_final": "Final MP4 Render",
    "export.btn_render_fast": "Quick Test (480p)",
    "export.files_title": "Exported Files",
    "export.versions_title": "Timeline Versions",
    "export.save_version": "Save Version",

    // Settings
    "settings.title": "Settings & Models",
    "settings.models": "Whisp Speech Models",
    "settings.tools": "External Tools",

    // Tour & Help
    "tour.btn": "Guided Tour",
    "tour.home.step1.title": "1. Import Video",
    "tour.home.step1.desc": "Drag and drop your lecture, webinar, or interview video here, or click 'Choose Video'.",
    "tour.home.step2.title": "2. Content Profile",
    "tour.home.step2.desc": "Choose your content type: Lecture, Interview, or Podcast. The app adjusts silence detection sensitivity accordingly.",
    "tour.home.step3.title": "3. Component Status",
    "tour.home.step3.desc": "Shows readiness of local FFmpeg and Whisp engines, as well as the language switcher (RU/EN).",
    "tour.home.step4.title": "4. Keyboard Shortcuts",
    "tour.home.step4.desc": "Click the help icon or press '?' on your keyboard at any time to open the shortcuts cheat sheet.",

    "tour.project.step1.title": "1. Four Pipeline Steps",
    "tour.project.step1.desc": "The workflow consists of 4 steps: Setup -> Rough Cut Review -> Subtitles & Translation -> Export to NLEs.",
    "tour.project.step2.title": "2. Timeline & Player",
    "tour.project.step2.desc": "Green segments are kept (speech), red striped segments are cut (silence). Click any segment to toggle it. Space bar toggles playback.",
    "tour.project.step3.title": "3. Subtitles & Translation",
    "tour.project.step3.desc": "Speech recognition, instant on-demand local translation without re-scanning audio, and bilingual view.",
    "tour.project.step4.title": "4. Export to Premiere & DaVinci",
    "tour.project.step4.desc": "Generate ready-to-import XML/FCPXML/OTIO timeline projects and render final MP4 videos.",

    // Quick Start Guide on Home
    "quickstart.title": "Quick Start: How Whisp Media Desk Works",
    "quickstart.btn_tour": "Interactive Tour with Guided Arrows",
    "quickstart.step1.title": "1. Choose Video",
    "quickstart.step1.desc": "Select a recorded lecture, webinar, or podcast from your local disk.",
    "quickstart.step2.title": "2. Smart Silence Cutting",
    "quickstart.step2.desc": "Local speech analysis detects pauses and filler silences without cloud uploads.",
    "quickstart.step3.title": "3. Subtitles & Translation",
    "quickstart.step3.desc": "Automatic transcription and on-demand translation into any language.",
    "quickstart.step4.title": "4. Export to NLE",
    "quickstart.step4.desc": "Export project sequences directly to Adobe Premiere Pro, DaVinci Resolve, or MP4.",

    // NLE Help in Export
    "export.nle_help.title": "How to import into video editors:",
    "export.nle_help.premiere": "In Adobe Premiere Pro: File > Import... (Ctrl+I) and select premiere.xml. Premiere creates a sequence with cut clips and linked audio.",
    "export.nle_help.davinci": "In DaVinci Resolve: File > Import > Timeline... and select final.fcpxml or premiere.xml. For color markers: Timeline > Import Markers > davinci_markers.csv.",
    "export.nle_help.fcpx": "In Final Cut Pro: File > Import > XML... and select final.fcpxml.",
  },
};

let currentLang: Language = ((): Language => {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "en" || saved === "ru") return saved;
  } catch {
    /* ignore */
  }
  return "ru";
})();

const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return currentLang;
}

export function setLanguage(lang: Language): void {
  currentLang = lang;
  try {
    localStorage.setItem("lang", lang);
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export function t(key: string, fallback?: string): string {
  return DICT[currentLang]?.[key] ?? DICT.ru?.[key] ?? fallback ?? key;
}

export function useTranslation() {
  const [lang, setLang] = useState<Language>(currentLang);

  useEffect(() => {
    const onLang = () => setLang(currentLang);
    listeners.add(onLang);
    return () => {
      listeners.delete(onLang);
    };
  }, []);

  return {
    lang,
    t: (key: string, fallback?: string) => DICT[lang]?.[key] ?? DICT.ru?.[key] ?? fallback ?? key,
    setLanguage,
  };
}
