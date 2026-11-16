import sys


def test_desktop_module_imports_and_falls_back(monkeypatch):
    from app import desktop
    monkeypatch.setitem(sys.modules, "webview", None)  # как будто pywebview не установлен
    assert desktop.run_window("http://127.0.0.1:1/") is False
    assert desktop.wait_ready("http://127.0.0.1:1/", timeout=0.5) is False


def test_cli_window_mode_serves_and_falls_back_to_browser(tmp_path, monkeypatch):
    import socket
    import threading
    import time
    import urllib.request
    monkeypatch.setenv("WHISP_DESK_HOME", str(tmp_path))
    monkeypatch.setitem(sys.modules, "webview", None)
    opened = []
    import webbrowser
    monkeypatch.setattr(webbrowser, "open", lambda u: opened.append(u))
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    import importlib
    from app.core import config
    importlib.reload(config)
    from app import main
    monkeypatch.setattr(sys, "argv", ["x", "--port", str(port)])
    t = threading.Thread(target=main.cli, daemon=True)
    t.start()
    ok = False
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/system", timeout=1); ok = True; break
        except Exception:
            time.sleep(0.25)
    assert ok
    for _ in range(40):
        if opened:
            break
        time.sleep(0.25)
    assert opened == [f"http://127.0.0.1:{port}/"]
