import { useTranslation } from "../i18n";

interface Item { q: string; a: string }

const RU: Item[] = [
  { q: "Как начать?", a: "Перетащите видео в окно и выберите профиль обработки. «Авто» найдёт паузы и распознает речь, после чего откроет монтаж. Или нажмите «Демо-проект», чтобы попробовать без своих файлов." },
  { q: "Что значат цвета на таймлайне?", a: "Зелёное остаётся в видео, красное вырезается. Пунктирная рамка означает, что решение ещё не проверено. Фиолетовым отмечено то, что вы изменили вручную." },
  { q: "Предпросмотр не показывает видео", a: "Копия для предпросмотра создаётся во время поиска пауз. Если её нет, откройте «Исходники» и нажмите «Пересчитать монтаж». Видео должно открываться в самой программе; формат оригинала (MKV, MOV, MTS) значения не имеет." },
  { q: "Нет звука в предпросмотре", a: "Проверьте кнопку громкости под монитором и режим «Пропускать вырезанное»: на красных участках звук намеренно отключается. Если звука нет и в исходном файле, у видео может не быть звуковой дорожки (или выбрана не та, см. «Исходники → Аудиодорожка»)." },
  { q: "Модель распознавания не скачивается", a: "Нужен доступ в интернет только для первой загрузки модели (turbo около 1,6 ГБ). Если сеть ограничена, скачайте модель заранее на другом компьютере и положите в папку моделей (см. «Настройки и модели») либо загрузите готовые субтитры SRT/VTT/ASS на шаге «Субтитры»." },
  { q: "Программа не открывается или окно пустое", a: "Если окно приложения пустое, программа сама откроет страницу в браузере: адрес написан в журнале (папка logs рядом с программой). Для окна нужен Microsoft Edge WebView2 Runtime, он входит в Windows 11 и обычно есть в Windows 10." },
  { q: "Где лежат мои файлы?", a: "Проекты хранятся в папке projects рядом с программой (или в папке данных, если она задана при установке). Исходное видео не копируется и не изменяется. Готовые экспорты лежат в папке exports внутри проекта." },
  { q: "Куда отправляются мои видео?", a: "Никуда. Анализ, расшифровка и сборка выполняются на вашем компьютере. Интернет нужен только для скачивания моделей и для проверки обновлений по кнопке в настройках." },
  { q: "Как сообщить об ошибке?", a: "«Настройки и модели» → «Скопировать отчёт для GitHub»: в отчёте версия, состояние программ и системная информация, без ваших файлов. Вставьте его в новое обращение на GitHub." },
];

const EN: Item[] = [
  { q: "How do I start?", a: "Drop a video into the window and pick a processing profile. \"Auto\" finds pauses and transcribes speech, then opens the editor. Or click \"Demo project\" to try the app without your own files." },
  { q: "What do the timeline colours mean?", a: "Green is kept, red is cut. A dashed outline means the decision is not reviewed yet. Purple marks what you changed by hand." },
  { q: "The preview shows no video", a: "The preview copy is created while pauses are detected. If it is missing, open Setup and click Re-analyze. The original format (MKV, MOV, MTS) does not matter." },
  { q: "No sound in the preview", a: "Check the volume button under the monitor and the \"Skip cuts\" option: sound is muted on red parts on purpose. If the source has no sound either, it may have no audio track, or another track is selected (Setup, Audio track)." },
  { q: "The speech model does not download", a: "Internet access is only needed for the first model download (turbo is about 1.6 GB). On a restricted network, download the model elsewhere and place it in the models folder (see Settings), or import ready SRT/VTT/ASS subtitles on the Subtitles step." },
  { q: "The app does not open or the window is blank", a: "If the app window stays blank, the program opens the page in your browser instead; the address is in the log (the logs folder next to the program). The window needs Microsoft Edge WebView2 Runtime, included in Windows 11 and usually present on Windows 10." },
  { q: "Where are my files?", a: "Projects live in the projects folder next to the program (or in the data folder chosen at install). The source video is never copied or changed. Exports are in the project's exports folder." },
  { q: "Where do my videos go?", a: "Nowhere. Analysis, transcription and rendering happen on your computer. The internet is used only to download models and to check for updates when you click the button in Settings." },
  { q: "How do I report a problem?", a: "Settings, then \"Copy report for GitHub\": it contains the version, tool status and system info, never your files. Paste it into a new GitHub issue." },
];

export default function HelpModal({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  const { lang } = useTranslation();
  const items = lang === "ru" ? RU : EN;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog help-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={lang === "ru" ? "Справка" : "Help"}>
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>{lang === "ru" ? "Справка и частые вопросы" : "Help and FAQ"}</h2>
          <button className="btn-icon" onClick={onClose} aria-label={lang === "ru" ? "Закрыть" : "Close"}>✕</button>
        </div>
        <div className="modal-body help-body">
          {items.map((it) => (
            <details key={it.q} className="more">
              <summary>{it.q}</summary>
              <p className="muted" style={{ margin: "6px 0 10px" }}>{it.a}</p>
            </details>
          ))}
        </div>
        <div className="modal-footer">
          <button onClick={onTour}>{lang === "ru" ? "Показать обзор программы" : "Show app tour"}</button>
          <button className="primary" onClick={onClose}>{lang === "ru" ? "Закрыть" : "Close"}</button>
        </div>
      </div>
    </div>
  );
}
