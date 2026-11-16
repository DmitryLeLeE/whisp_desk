# -*- mode: python ; coding: utf-8 -*-
# Сборка: python -m PyInstaller --noconfirm --clean whisp_desk.spec  (или build.bat)
import sys
from pathlib import Path

ROOT = Path(SPECPATH)
datas = [
    (str(ROOT / "frontend" / "dist"), "frontend/dist"),
    (str(ROOT / "templates"), "templates"),
    (str(ROOT / "assets" / "icon.png"), "assets"),
]
hidden = ["uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets.auto",
          "uvicorn.lifespan.on", "multipart"]
excludes = ["tkinter", "matplotlib", "scipy", "pandas", "IPython", "pytest"]

a = Analysis([str(ROOT / "backend" / "launcher.py")], pathex=[str(ROOT / "backend")], datas=datas,
             hiddenimports=hidden, excludes=excludes, noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="WHISP_MEDIA_DESK", console=True,
          icon=str(ROOT / "assets" / "icon.ico"), version=str(ROOT / "version_info.txt") if sys.platform == "win32" else None)
coll = COLLECT(exe, a.binaries, a.datas, name="WHISP_MEDIA_DESK")
