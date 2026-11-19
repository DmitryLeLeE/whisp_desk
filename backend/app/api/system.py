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
