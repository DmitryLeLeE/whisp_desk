"""Точка входа (PyInstaller и обычный запуск). Один exe выполняет три роли:
  WHISP_MEDIA_DESK.exe                      — приложение;
  WHISP_MEDIA_DESK.exe --whisp-run ...      — рабочий процесс Whisp (его запускает само приложение).
"""
import multiprocessing
import sys

if __name__ == "__main__":
    multiprocessing.freeze_support()
    if len(sys.argv) > 2 and sys.argv[1] == "--whisp-run":
        from app.whisp_runner import main as runner_main
        raise SystemExit(runner_main(sys.argv[2:]))
    from app.main import cli
    cli()
