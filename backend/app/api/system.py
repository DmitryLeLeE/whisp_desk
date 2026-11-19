"""Системные эндпоинты: информация о системе, проверка обновлений."""
from __future__ import annotations

import json
import logging
import platform
import re
import urllib.request
from fastapi import APIRouter

from ..core import config

LOG = logging.getLogger("whisp_desk.system")
router = APIRouter(prefix="/api/system", tags=["system"])

GITHUB_RELEASES_URL = "https://api.github.com/repos/DmitryLeLeE/whisp_desk/releases/latest"
GITHUB_RELEASES_PAGE = "https://github.com/DmitryLeLeE/whisp_desk/releases"


def _parse_version(v: str) -> tuple[int, ...]:
    nums = re.findall(r"\d+", v)
    return tuple(int(x) for x in nums) if nums else (0,)


@router.get("/info")
def system_info():
    return {
        "version": config.VERSION,
        "frozen": config.FROZEN,
        "platform": platform.platform(),
        "python": platform.python_version(),
        "ffmpeg": config.find_tool("ffmpeg") is not None,
        "ffprobe": config.find_tool("ffprobe") is not None,
        "projects_dir": str(config.PROJECTS_DIR),
        "host": config.HOST,
    }


@router.get("/check-update")
def check_update():
    """Проверка наличия новой версии на GitHub Releases с безопасным таймаутом."""
    current_ver = config.VERSION
    try:
        req = urllib.request.Request(
            GITHUB_RELEASES_URL,
            headers={
                "User-Agent": f"whisp-desk/{current_ver}",
                "Accept": "application/vnd.github.v3+json",
            },
        )
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                tag = (data.get("tag_name") or "").lstrip("v")
                has_update = bool(tag and _parse_version(tag) > _parse_version(current_ver))
                return {
                    "status": "ok",
                    "current_version": current_ver,
                    "latest_version": tag or current_ver,
                    "has_update": has_update,
                    "release_name": data.get("name") or f"Release {tag}",
                    "release_url": data.get("html_url", GITHUB_RELEASES_PAGE),
                    "published_at": data.get("published_at", ""),
                }
    except Exception as e:
        LOG.debug("Проверка обновлений пропущена или недоступна: %s", e)

    return {
        "status": "offline",
        "current_version": current_ver,
        "latest_version": current_ver,
        "has_update": False,
        "release_name": "",
        "release_url": GITHUB_RELEASES_PAGE,
        "published_at": "",
    }


def _scan_cache():
    items = []
    total_bytes = 0
    if config.PROJECTS_DIR.is_dir():
        for p_dir in config.PROJECTS_DIR.iterdir():
            if not p_dir.is_dir():
                continue
            analysis = p_dir / "analysis"
            if analysis.is_dir():
                for f in analysis.glob("*"):
                    if f.is_file() and f.name != "source_info.json":
                        try:
                            sz = f.stat().st_size
                            items.append(f)
                            total_bytes += sz
                        except OSError:
                            pass
                thumbs = analysis / "thumbnails"
                if thumbs.is_dir():
                    for f in thumbs.glob("*.jpg"):
                        try:
                            sz = f.stat().st_size
                            items.append(f)
                            total_bytes += sz
                        except OSError:
                            pass
            exports = p_dir / "exports"
            if exports.is_dir():
                for f in exports.glob("*.part"):
                    try:
                        sz = f.stat().st_size
                        items.append(f)
                        total_bytes += sz
                    except OSError:
                        pass
    return items, total_bytes


@router.get("/cache")
def get_cache_info():
    items, total_bytes = _scan_cache()
    mb = total_bytes / (1024 * 1024)
    return {
        "files_count": len(items),
        "total_bytes": total_bytes,
        "formatted": f"{mb:.1f} МБ" if mb >= 1 else f"{total_bytes / 1024:.0f} КБ",
    }


@router.post("/cache/clean")
def clean_cache():
    items, total_bytes = _scan_cache()
    deleted = 0
    freed_bytes = 0
    for f in items:
        try:
            sz = f.stat().st_size
            f.unlink(missing_ok=True)
            deleted += 1
            freed_bytes += sz
        except OSError:
            pass
    mb = freed_bytes / (1024 * 1024)
    return {
        "deleted_count": deleted,
        "freed_bytes": freed_bytes,
        "formatted": f"{mb:.1f} МБ" if mb >= 1 else f"{freed_bytes / 1024:.0f} КБ",
    }
