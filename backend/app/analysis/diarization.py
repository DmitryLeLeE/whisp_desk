"""Локальная детекция и разделение спикеров (Speaker Diarization) на основе спектрального анализа."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

import numpy as np
from scipy import signal
from scipy.io import wavfile
import soundfile as sf
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

from ..core.config import require_tool
from ..core.proc import run


def extract_segment_features(audio_data: np.ndarray, sample_rate: int) -> np.ndarray:
    """Извлекает вектор спектральных признаков (тембр, высота тона, форманты) из фрагмента речи."""
    if len(audio_data.shape) > 1:
        # Конвертируем в моно
        audio_data = np.mean(audio_data, axis=1)

    if len(audio_data) < sample_rate * 0.1:
        # Слишком короткий фрагмент (<100мс)
        return np.zeros(12)

    # 1. Спектральная плотность мощности (PSD) через Welch
    freqs, psd = signal.welch(audio_data, fs=sample_rate, nperseg=min(len(audio_data), 1024))
    psd = psd + 1e-10  # Защита от log(0)

    # Энергия в частотных диапазонах (бас/высота тона, нижняя середина, верхняя середина, верха)
    bands = [
        (80, 250),    # F0 (основной тон мужского/женского голоса)
        (250, 600),   # F1 (первая форманта)
        (600, 1500),  # F2 (вторая форманта)
        (1500, 3000), # F3
        (3000, 6000), # Присутствие и сибилянты
    ]

    band_energies = []
    for f_low, f_high in bands:
        mask = (freqs >= f_low) & (freqs <= f_high)
        energy = np.mean(psd[mask]) if np.any(mask) else 1e-10
        band_energies.append(np.log10(energy))

    # 2. Спектральный центроид (яркость/высота голоса)
    centroid = np.sum(freqs * psd) / np.sum(psd)

    # 3. Спектральный спад (Rolloff 85%)
    cumsum = np.cumsum(psd)
    rolloff_idx = np.where(cumsum >= 0.85 * cumsum[-1])[0]
    rolloff = freqs[rolloff_idx[0]] if len(rolloff_idx) > 0 else freqs[-1]

    # 4. Zero-Crossing Rate
    zcr = np.mean(np.abs(np.diff(np.sign(audio_data)))) / 2

    # 5. RMS громкость
    rms = np.sqrt(np.mean(audio_data ** 2))

    features = np.array([
        *band_energies,
        centroid / 2000.0,
        rolloff / 3000.0,
        zcr * 10.0,
        np.log10(rms + 1e-6),
    ])
    return features


def diarize_cues(
    source_path: Path,
    cues: list[dict],
    work_dir: Path,
    *,
    log: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Разделяет реплики по спикерам ('SPEAKER_1' и 'SPEAKER_2')."""
    if not cues:
        return {"speakers_count": 0, "cues": [], "stats": {}}

    if len(cues) < 3:
        # Слишком мало реплик для кластеризации — считаем одного спикера
        for c in cues:
            c["speaker"] = "SPEAKER_1"
        return {"speakers_count": 1, "cues": cues, "stats": {"SPEAKER_1": len(cues)}}

    work_dir.mkdir(parents=True, exist_ok=True)
    wav_path = work_dir / "diarize_temp.wav"

    if log:
        log("Извлечение аудиодорожки 16kHz для анализа голосов спикеров...")

    # Извлекаем легкий 16kHz mono WAV для быстрого чтения через soundfile
    ffmpeg_bin = require_tool("ffmpeg")
    cmd = [
        ffmpeg_bin, "-y", "-v", "error", "-nostdin",
        "-i", str(source_path),
        "-vn", "-ar", "16000", "-ac", "1",
        str(wav_path),
    ]
    code, err = run(cmd)
    if code != 0 or not wav_path.is_file():
        if log:
            log(f"Не удалось подготовить аудио для диаризации: {err}")
        for c in cues:
            c["speaker"] = "SPEAKER_1"
        return {"speakers_count": 1, "cues": cues, "stats": {"SPEAKER_1": len(cues)}}

    try:
        data, sr = sf.read(str(wav_path))
        feature_matrix: list[np.ndarray] = []
        valid_indices: list[int] = []

        for i, cue in enumerate(cues):
            s_ms = cue.get("start_ms", 0)
            e_ms = cue.get("end_ms", 0)
            start_sample = int(s_ms * sr / 1000)
            end_sample = min(len(data), int(e_ms * sr / 1000))

            if end_sample - start_sample > int(sr * 0.15):  # реплики длиннее 150 мс
                seg_audio = data[start_sample:end_sample]
                feat = extract_segment_features(seg_audio, sr)
                feature_matrix.append(feat)
                valid_indices.append(i)

        if len(feature_matrix) < 3:
            for c in cues:
                c["speaker"] = "SPEAKER_1"
            return {"speakers_count": 1, "cues": cues, "stats": {"SPEAKER_1": len(cues)}}

        X = np.array(feature_matrix)
        # Нормализация
        mean = np.mean(X, axis=0)
        std = np.std(X, axis=0) + 1e-8
        X_norm = (X - mean) / std

        # Кластеризация на 2 спикера
        kmeans = KMeans(n_clusters=2, n_init=10, random_state=42)
        labels = kmeans.fit_predict(X_norm)

        # Проверяем различимость кластеров через силуэт
        try:
            sil = silhouette_score(X_norm, labels)
        except Exception:
            sil = 0.0

        if sil < 0.08:
            # Различия минимальны — скорее всего один человек говорит в разной тональности
            if log:
                log(f"Диаризация: различия между голосами незначительны (силуэт {sil:.2f}), обнаружен 1 спикер")
            for c in cues:
                c["speaker"] = "SPEAKER_1"
            return {"speakers_count": 1, "cues": cues, "stats": {"SPEAKER_1": len(cues)}}

        # Определяем первого говорящего как SPEAKER_1
        first_cluster = labels[0]
        cluster_to_speaker = {
            first_cluster: "SPEAKER_1",
            1 - first_cluster: "SPEAKER_2",
        }

        # Применяем метки
        for idx_in_valid, orig_idx in enumerate(valid_indices):
            cues[orig_idx]["speaker"] = cluster_to_speaker[labels[idx_in_valid]]

        # Заполняем пропущенные (короткие) реплики по контексту соседних
        last_spk = "SPEAKER_1"
        for c in cues:
            if "speaker" not in c:
                c["speaker"] = last_spk
            else:
                last_spk = c["speaker"]

        spk1_count = sum(1 for c in cues if c.get("speaker") == "SPEAKER_1")
        spk2_count = sum(1 for c in cues if c.get("speaker") == "SPEAKER_2")

        if log:
            log(f"Диаризация завершена: 2 спикера (Спикер 1: {spk1_count} реплик, Спикер 2: {spk2_count} реплик)")

        return {
            "speakers_count": 2,
            "cues": cues,
            "stats": {"SPEAKER_1": spk1_count, "SPEAKER_2": spk2_count},
            "silhouette": float(sil),
        }
    finally:
        if wav_path.is_file():
            try:
                wav_path.unlink()
            except Exception:
                pass
