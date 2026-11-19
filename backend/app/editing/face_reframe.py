"""Умный авто-кроп лица (Smart Reframe) для вертикальных видео 9:16 с использованием OpenCV."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

import cv2
import numpy as np


class FaceReframe:
    def __init__(self):
        cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
        if not os.path.exists(cascade_path):
            raise FileNotFoundError(f"Файл каскада Хаара не найден: {cascade_path}")
        self.cascade = cv2.CascadeClassifier(cascade_path)

    def detect_face_center_x(self, frame_bgr: np.ndarray) -> int | None:
        """Находит центр самого крупного лица в кадре по горизонтали (X)."""
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        faces = self.cascade.detectMultiScale(
            gray,
            scaleFactor=1.15,
            minNeighbors=4,
            minSize=(40, 40),
            flags=cv2.CASCADE_SCALE_IMAGE,
        )
        if len(faces) == 0:
            return None

        # Выбираем самое крупное лицо (главный спикер)
        best_face = max(faces, key=lambda f: f[2] * f[3])
        x, y, w, h = best_face
        return int(x + w / 2)


def compute_smart_reframe_segments(
    source_path: Path,
    width: int,
    height: int,
    ranges_ms: list[tuple[int, int]],
    *,
    sample_fps: float = 1.0,
    log: Callable[[str], None] | None = None,
) -> list[int]:
    """Вычисляет сглаженные координаты X для кропа 9:16 под лицо спикера для каждого сегмента монтажа.

    Возвращает список целочисленных значений X (по одному для каждого сегмента).
    """
    crop_w = round(height * 9 / 16 / 2) * 2
    max_x = max(0, width - crop_w)
    default_x = max_x // 2

    if max_x == 0 or not ranges_ms:
        return [default_x] * len(ranges_ms)

    try:
        reframe = FaceReframe()
    except Exception as e:
        if log:
            log(f"Smart Reframe: каскад лиц недоступен ({e}), используется центральный кроп")
        return [default_x] * len(ranges_ms)

    cap = cv2.VideoCapture(str(source_path))
    if not cap.isOpened():
        if log:
            log("Smart Reframe: не удалось открыть видеофайл, используется центральный кроп")
        return [default_x] * len(ranges_ms)

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frame_interval = max(1, int(fps / sample_fps))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    # Карта распознанных координат по времени: time_ms -> face_center_x
    detected_centers: list[tuple[int, int]] = []

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_interval == 0:
            t_ms = int((frame_idx / fps) * 1000)
            cx = reframe.detect_face_center_x(frame)
            if cx is not None:
                detected_centers.append((t_ms, cx))

        frame_idx += 1
        # Ограничиваем сэмплирование разумным максимумом для скорости
        if total_frames > 0 and frame_idx > 3000:
            break

    cap.release()

    if not detected_centers:
        if log:
            log("Smart Reframe: лица не обнаружены, применен центрированный кроп")
        return [default_x] * len(ranges_ms)

    if log:
        log(f"Smart Reframe: обнаружено {len(detected_centers)} кадров с лицом спикера")

    # Для каждого монтажного сегмента находим среднюю координату лица в его интервале
    result_x: list[int] = []
    last_valid_x = default_x

    for start_ms, end_ms in ranges_ms:
        seg_faces = [cx for t_ms, cx in detected_centers if start_ms <= t_ms <= end_ms]
        if not seg_faces:
            # Если в этом конкретном сегменте лицо не попало в сэмпл, ищем ближайшее по времени
            closest = min(detected_centers, key=lambda item: abs(item[0] - (start_ms + end_ms) // 2))
            target_cx = closest[1]
        else:
            target_cx = int(np.median(seg_faces))

        # Вычисляем левый край кроп-прямоугольника так, чтобы лицо было по центру
        ideal_x = target_cx - crop_w // 2
        clamped_x = max(0, min(max_x, ideal_x))

        # Сглаживание между соседними сегментами, чтобы не было резких прыжков
        smoothed_x = int(0.6 * clamped_x + 0.4 * last_valid_x)
        smoothed_x = max(0, min(max_x, smoothed_x))
        # Четное значение для FFmpeg yuv420p
        smoothed_x = smoothed_x - smoothed_x % 2

        result_x.append(smoothed_x)
        last_valid_x = smoothed_x

    return result_x
