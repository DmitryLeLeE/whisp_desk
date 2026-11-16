@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/6] Python-зависимости
python -m pip install -r backend\requirements.txt pyinstaller pillow || goto :err
echo [2/6] Иконка
python tools\make_icon.py || goto :err
echo [3/6] Интерфейс
cd frontend
call npm ci || call npm install || goto :err
call npm run build || goto :err
cd ..
echo [4/6] FFmpeg и Auto-Editor (скачиваются один раз в tools\)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\fetch_tools.ps1 || goto :err
echo [5/6] Сборка единого exe
python -m PyInstaller --noconfirm --clean whisp_desk.spec || goto :err
echo [6/6] Проверка размера
if not exist dist\WHISP_MEDIA_DESK.exe goto :err
echo.
echo Готово: dist\WHISP_MEDIA_DESK.exe  (один файл, внутри FFmpeg, Auto-Editor и Whisp)
echo Установщик (необязательно): iscc installer\whisp_desk.iss
exit /b 0
:err
echo Ошибка сборки.
exit /b 1
