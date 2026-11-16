"""Фоновая загрузка моделей Whisp. Не привязана к проекту, поэтому живёт отдельно от очереди задач."""
from __future__ import annotations

import threading

from ..integrations import whisp
from .proc import CancelToken, Cancelled


class ModelDownloads:
    def __init__(self) -> None:
        self._state: dict[str, dict] = {}
        self._tokens: dict[str, CancelToken] = {}
        self._lock = threading.Lock()

    def status(self) -> list[dict]:
        models = whisp.models_status()
        with self._lock:
            for m in models:
                st = self._state.get(m["name"])
                m["download"] = dict(st) if st and st["state"] in ("running", "error") else None
        return models

    def start(self, name: str) -> None:
        if name not in {m["name"] for m in whisp.MODELS}:
            raise ValueError(f"Неизвестная модель: {name}")
        with self._lock:
            if self._state.get(name, {}).get("state") == "running":
                return
            if any(s["state"] == "running" for s in self._state.values()):
                raise RuntimeError("Уже идёт загрузка другой модели. Дождитесь её окончания или отмените.")
            token = CancelToken()
            self._tokens[name] = token
            self._state[name] = {"state": "running", "done": 0, "total": 0, "error": None}
        threading.Thread(target=self._run, args=(name, token), daemon=True).start()

    def cancel(self, name: str) -> None:
        with self._lock:
            token = self._tokens.get(name)
        if token:
            token.cancel()

    def _run(self, name: str, token: CancelToken) -> None:
        def on_event(ev: dict) -> None:
            if ev["k"] == "download":
                with self._lock:
                    self._state[name].update(done=ev["done"], total=ev["total"])
        try:
            whisp.download_model(name, token=token, on_event=on_event)
            with self._lock:
                self._state[name] = {"state": "done", "done": 1, "total": 1, "error": None}
        except Cancelled:
            with self._lock:
                self._state.pop(name, None)
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._state[name] = {"state": "error", "done": 0, "total": 0, "error": str(exc)}
