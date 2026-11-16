"""Шаблоны оформления: templates/<имя>/template.json + файлы графики рядом."""
from __future__ import annotations

import re
from pathlib import Path

from .config import TEMPLATES_DIR
from .fsutil import read_json

_NAME = re.compile(r"^[a-z0-9_-]+$")


def list_templates(root: Path | None = None) -> list[dict]:
    root = root or TEMPLATES_DIR
    out = []
    for d in sorted(root.iterdir()) if root.exists() else []:
        data = read_json(d / "template.json")
        if data:
            out.append({"id": d.name, "name": data.get("name", d.name), "description": data.get("description", "")})
    return out


def load_template(name: str, root: Path | None = None) -> tuple[dict, Path]:
    root = root or TEMPLATES_DIR
    if not _NAME.match(name):
        raise ValueError("Некорректное имя шаблона")
    data = read_json(root / name / "template.json")
    if data is None:
        raise FileNotFoundError(f"Шаблон не найден: {name}")
    return data, root / name
