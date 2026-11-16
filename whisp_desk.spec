# -*- mode: python ; coding: utf-8 -*-
# Единый exe (onefile, без консоли). Сборка: build.bat или
#   python -m PyInstaller --noconfirm --clean whisp_desk.spec
# Перед сборкой: npm run build (интерфейс) и tools/ffmpeg, tools/ffprobe, tools/auto-editor (их скрипты кладут туда сами).
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH)
datas = [
    (str(ROOT / "frontend" / "dist"), "frontend/dist"),
    (str(ROOT / "templates"), "templates"),
    (str(ROOT / "assets" / "icon.png"), "assets"),
]
binaries = []
hidden = ["uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets.auto",
          "uvicorn.lifespan.on", "multipart",
          # Whisp лежит в app/vendor/whisp и импортирует соседей как верхнеуровневые модули
          "whisper_universal", "hub", "i18n", "translator"]

# Пакеты распознавания речи тянут данные и нативные библиотеки (VAD-модель, ctranslate2, onnxruntime).
for pkg in ("faster_whisper", "ctranslate2", "onnxruntime", "av", "sentencepiece", "huggingface_hub", "tokenizers",
            "ffmpeg", "webview"):
    try:
        d, b, h = collect_all(pkg)
    except Exception as e:  # пакет необязателен (webview нет на Linux)
        print(f"spec: пропускаю {pkg}: {e}")
        continue
    datas += d; binaries += b; hidden += h

# Встроенные программы: внутри exe лежат в tools/<имя>/, config.find_tool ищет их в sys._MEIPASS.
for name in ("ffmpeg", "ffprobe", "auto-editor"):
    folder = ROOT / "tools" / name
    if folder.is_dir():
        for f in folder.iterdir():
            if f.is_file() and f.suffix.lower() in (".exe", ""):
                binaries.append((str(f), f"tools/{name}"))

excludes = ["tkinter", "matplotlib", "scipy", "pandas", "IPython", "pytest", "torch", "torchvision", "tensorflow"]

a = Analysis([str(ROOT / "backend" / "launcher.py")], pathex=[str(ROOT / "backend"), str(ROOT / "backend" / "app" / "vendor" / "whisp")],
             binaries=binaries, datas=datas, hiddenimports=hidden, excludes=excludes, noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name="WHISP_MEDIA_DESK", console=False, upx=False,
          icon=str(ROOT / "assets" / "icon.ico"),
          version=str(ROOT / "version_info.txt") if sys.platform == "win32" else None)
