@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/4] Зависимости
python -m pip install -r backend\requirements.txt pyinstaller pillow || goto :err
echo [2/4] Иконка
python tools\make_icon.py || goto :err
echo [3/4] Интерфейс
cd frontend
call npm ci || call npm install || goto :err
call npm run build || goto :err
cd ..
echo [4/4] Сборка exe
python -m PyInstaller --noconfirm --clean whisp_desk.spec || goto :err
echo.
echo Готово: dist\WHISP_MEDIA_DESK\WHISP_MEDIA_DESK.exe
echo Положите ffmpeg.exe в dist\WHISP_MEDIA_DESK\tools\ffmpeg\ и ffprobe.exe в tools\ffprobe\ (или добавьте их в PATH).
exit /b 0
:err
echo Ошибка сборки.
exit /b 1
