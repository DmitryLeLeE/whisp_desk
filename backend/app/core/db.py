"""SQLite: список проектов, задачи и история операций. Состояние монтажа хранится в файлах проекта."""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
    created TEXT NOT NULL, updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, kind TEXT NOT NULL,
    status TEXT NOT NULL, stage TEXT NOT NULL DEFAULT '', progress REAL NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '', error TEXT, params TEXT NOT NULL DEFAULT '{}',
    created TEXT NOT NULL, started TEXT, finished TEXT, result TEXT
);
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, ts TEXT NOT NULL,
    action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_history_project ON history(project_id, id);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, id);
"""


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(SCHEMA)

    @contextmanager
    def cursor(self):
        with self._lock:
            yield self._conn

    def execute(self, sql: str, args: tuple = ()) -> sqlite3.Cursor | None:
        with self._lock:
            try:
                return self._conn.execute(sql, args)
            except sqlite3.ProgrammingError as e:
                if "closed database" in str(e).lower():
                    return None
                raise

    def query(self, sql: str, args: tuple = ()) -> list[dict]:
        with self._lock:
            try:
                cur = self._conn.execute(sql, args)
                return [dict(r) for r in cur.fetchall()]
            except sqlite3.ProgrammingError as e:
                if "closed database" in str(e).lower():
                    return []
                raise

    def close(self) -> None:
        with self._lock:
            self._conn.close()
