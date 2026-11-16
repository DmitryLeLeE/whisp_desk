# -*- coding: utf-8 -*-
"""Рисует иконку: assets/icon.png, assets/icon.ico и frontend/public/favicon.png. Запуск: python tools/make_icon.py (нужен Pillow)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024  # рисуем крупно, затем уменьшаем — края получаются гладкими
ROOT = Path(__file__).resolve().parent.parent


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], f: float) -> tuple[int, int, int]:
    return tuple(round(x + (y - x) * f) for x, y in zip(a, b))  # type: ignore[return-value]


def draw() -> Image.Image:
    top, bottom = (31, 41, 71), (14, 18, 33)               # тёмный сине-серый фон
    gradient = Image.new("RGB", (SIZE, SIZE))
    px = ImageDraw.Draw(gradient)
    for y in range(SIZE):
        px.line([(0, y), (SIZE, y)], fill=lerp(top, bottom, y / (SIZE - 1)))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=int(SIZE * 0.22), fill=255)
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    icon.paste(gradient, (0, 0), mask)
    d = ImageDraw.Draw(icon)

    keep, cut, accent = (63, 190, 140, 255), (224, 86, 78, 255), (255, 255, 255, 255)
    left, right = int(SIZE * 0.14), int(SIZE * 0.86)
    bar_h = int(SIZE * 0.115)
    r = bar_h // 2

    # дорожка 1: клип, вырезанная пауза (штрихи), клип
    y1 = int(SIZE * 0.30)
    d.rounded_rectangle((left, y1, int(SIZE * 0.47), y1 + bar_h), radius=r, fill=keep)
    d.rounded_rectangle((int(SIZE * 0.60), y1, right, y1 + bar_h), radius=r, fill=keep)
    for i in range(3):                                      # «разрез» — пунктир на месте паузы
        x = int(SIZE * 0.505) + i * int(SIZE * 0.032)
        d.rounded_rectangle((x, y1 + int(bar_h * 0.2), x + int(SIZE * 0.016), y1 + int(bar_h * 0.8)), radius=6, fill=cut)

    # дорожка 2: звук — столбики
    y2 = int(SIZE * 0.52)
    heights = [0.35, 0.7, 0.5, 0.95, 0.6, 0.3, 0.8, 0.45, 0.65, 0.25, 0.55, 0.85, 0.4]
    bw, gap = int(SIZE * 0.034), int(SIZE * 0.0225)
    total = len(heights) * bw + (len(heights) - 1) * gap
    x = (SIZE - total) // 2
    for h in heights:
        half = int(SIZE * 0.085 * h)
        d.rounded_rectangle((x, y2 + int(SIZE * 0.085) - half, x + bw, y2 + int(SIZE * 0.085) + half), radius=bw // 2,
                            fill=(255, 255, 255, 215))
        x += bw + gap

    # дорожка 3: субтитры
    y3 = int(SIZE * 0.74)
    line_h = int(SIZE * 0.055)
    d.rounded_rectangle((int(SIZE * 0.22), y3, int(SIZE * 0.78), y3 + line_h), radius=line_h // 2, fill=(255, 255, 255, 235))
    d.rounded_rectangle((int(SIZE * 0.32), y3 + line_h + int(SIZE * 0.035), int(SIZE * 0.68), y3 + 2 * line_h + int(SIZE * 0.035)),
                        radius=line_h // 2, fill=(255, 255, 255, 150))

    # линия воспроизведения
    px_x = int(SIZE * 0.535)
    d.rounded_rectangle((px_x - 9, int(SIZE * 0.16), px_x + 9, int(SIZE * 0.70)), radius=9, fill=accent)
    d.polygon([(px_x - 36, int(SIZE * 0.14)), (px_x + 36, int(SIZE * 0.14)), (px_x, int(SIZE * 0.20))], fill=accent)
    return icon


def main() -> None:
    (ROOT / "assets").mkdir(exist_ok=True)
    icon = draw()
    icon.resize((256, 256), Image.LANCZOS).save(ROOT / "assets" / "icon.png")
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    icon.save(ROOT / "assets" / "icon.ico", sizes=sizes)
    (ROOT / "frontend" / "public").mkdir(parents=True, exist_ok=True)
    icon.resize((64, 64), Image.LANCZOS).save(ROOT / "frontend" / "public" / "favicon.png")
    print("saved assets/icon.png, assets/icon.ico, frontend/public/favicon.png")


if __name__ == "__main__":
    main()
