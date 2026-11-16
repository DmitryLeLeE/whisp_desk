@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/3] Python-зависимости
python -m pip install -r backend\requirements.txt || goto :err
echo [2/3] Интерфейс
cd frontend
call npm install || goto :err
call npm run build || goto :err
cd ..
echo [3/3] Проверка FFmpeg
where ffmpeg >nul 2>nul || if not exist tools\ffmpeg\ffmpeg.exe echo ВНИМАНИЕ: FFmpeg не найден. Положите ffmpeg.exe в tools\ffmpeg\, ffprobe.exe в tools\ffprobe\ или добавьте в PATH.
echo Готово. Запуск: run.bat
exit /b 0
:err
echo Ошибка установки.
exit /b 1
