"""Запуск внешних процессов: список аргументов (без shell), отмена, прогресс."""
from __future__ import annotations

import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable, Sequence

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0


class Cancelled(Exception):
    pass


class CancelToken:
    """Токен отмены: хранит текущий subprocess и убивает его при cancel()."""

    def __init__(self) -> None:
        self._cancelled = threading.Event()
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()

    @property
    def cancelled(self) -> bool:
        return self._cancelled.is_set()

    def cancel(self) -> None:
        self._cancelled.set()
        with self._lock:
            proc = self._proc
        if proc and proc.poll() is None:
            terminate(proc)

    def attach(self, proc: subprocess.Popen) -> None:
        with self._lock:
            self._proc = proc
        if self.cancelled:
            terminate(proc)

    def check(self) -> None:
        if self.cancelled:
            raise Cancelled()


def terminate(proc: subprocess.Popen) -> None:
    try:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    except OSError:
        pass


def run(
    args: Sequence[str | Path],
    *,
    cwd: Path | None = None,
    token: CancelToken | None = None,
    on_line: Callable[[str], None] | None = None,
    merge_stderr: bool = True,
    env: dict[str, str] | None = None,
) -> tuple[int, str]:
    """Запускает команду, возвращает (код, весь вывод). Построчно вызывает on_line."""
    proc = subprocess.Popen(
        [str(a) for a in args],
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT if merge_stderr else subprocess.PIPE,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=_NO_WINDOW,
    )
    if token:
        token.attach(proc)
    lines: list[str] = []
    stderr_buf: list[str] = []
    err_thread = None
    if not merge_stderr and proc.stderr is not None:
        def _drain() -> None:
            stderr_buf.extend(proc.stderr)  # type: ignore[arg-type]
        err_thread = threading.Thread(target=_drain, daemon=True)
        err_thread.start()
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip("\r\n")
        lines.append(line)
        if on_line:
            on_line(line)
    proc.wait()
    if err_thread:
        err_thread.join(timeout=5)
    if token:
        token.check()
    out = "\n".join(lines)
    if stderr_buf:
        out += "\n" + "".join(stderr_buf)
    return proc.returncode, out
