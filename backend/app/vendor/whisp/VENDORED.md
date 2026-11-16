# Движок Whisp (WhisperSRT)

Файлы `whisper_universal.py`, `hub.py`, `i18n.py`, `translator.py` скопированы без изменений из
https://github.com/DmitryLeLeE/whisp (коммит `ada19333f3c3b6ef1cbe753ea4e795e03c5d1592`, версия 1.2.2). Лицензия — MIT, см. `LICENSE`.
GUI (`WhisperSRT_GUI.py`) не нужен и не копируется. Чтобы обновить движок, замените четыре файла и поменяйте коммит здесь.

Модули импортируют друг друга по плоским именам (`import hub`), поэтому папка добавляется в `sys.path`
в `app/integrations/whisp.py`.
