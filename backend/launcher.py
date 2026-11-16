"""Точка входа (PyInstaller и обычный запуск). Один exe выполняет три роли:
  WHISP_MEDIA_DESK.exe                      — приложение;
  WHISP_MEDIA_DESK.exe --whisp-run ...      — рабочий процесс Whisp (его запускает само приложение).
"""
import multiprocessing
import os
import sys

# exe без консоли: sys.stdout/sys.stderr равны None, и любой print или tqdm (загрузка моделей) падает на .write.
for _name in ("stdout", "stderr"):
    if getattr(sys, _name) is None:
        setattr(sys, _name, open(os.devnull, "w", encoding="utf-8"))

if __name__ == "__main__":
    multiprocessing.freeze_support()
    if len(sys.argv) > 2 and sys.argv[1] == "--whisp-run":
        from app.whisp_runner import main as runner_main
        raise SystemExit(runner_main(sys.argv[2:]))
    from app.main import cli
    cli()
