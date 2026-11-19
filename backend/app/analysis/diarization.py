"""Локальная детекция и разделение спикеров (Speaker Diarization) на основе спектрального анализа."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable
import wave

import numpy as np

from ..core.config import require_tool
from ..core.proc import run


def read_wav_16k_mono(wav_path: Path) -> tuple[np.ndarray, int]:
    """Читает 16-битный PCM WAV файл через стандартную библиотеку wave без внешних зависимостей."""
    with wave.open(str(wav_path), "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()
        frames = wf.readframes(n_frames)

    if sampwidth == 2:
        audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif sampwidth == 4:
        audio = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        audio = np.frombuffer(frames, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0

    if n_channels > 1:
        audio = audio.reshape(-1, n_channels).mean(axis=1)

    return audio, framerate


def extract_segment_features(audio_data: np.ndarray, sample_rate: int) -> np.ndarray:
    """Извлекает вектор спектральных признаков (тембр, высота тона, форманты) из фрагмента речи.
    
    Реализовано на чистом NumPy (FFT + Welch) без зависимости от scipy/librosa.
    """
    if len(audio_data.shape) > 1:
        audio_data = np.mean(audio_data, axis=1)

    if len(audio_data) < sample_rate * 0.1:
        # Слишком короткий фрагмент (<100мс)
        return np.zeros(9, dtype=np.float32)

    # 1. Расчет спектральной плотности мощности (PSD) методом Welch на NumPy
    nperseg = min(len(audio_data), 1024)
    step = nperseg // 2
    n_segs = max(1, (len(audio_data) - nperseg) // step + 1)
    window = np.hanning(nperseg)
    window_sum_sq = float(np.sum(window ** 2))

    psd_accum = np.zeros(nperseg // 2 + 1, dtype=np.float64)
    for seg_i in range(n_segs):
        start = seg_i * step
        chunk = audio_data[start : start + nperseg]
        if len(chunk) < nperseg:
            chunk = np.pad(chunk, (0, nperseg - len(chunk)))
        windowed = chunk * window
        fft_vals = np.fft.rfft(windowed)
        psd_accum += np.abs(fft_vals) ** 2

    psd = psd_accum / (n_segs * sample_rate * (window_sum_sq + 1e-12))
    freqs = np.fft.rfftfreq(nperseg, d=1.0 / sample_rate)
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
        energy = float(np.mean(psd[mask])) if np.any(mask) else 1e-10
        band_energies.append(float(np.log10(energy)))

    # 2. Спектральный центроид (яркость/высота голоса)
    sum_psd = float(np.sum(psd))
    centroid = float(np.sum(freqs * psd) / (sum_psd + 1e-12))

    # 3. Спектральный спад (Rolloff 85%)
    cumsum = np.cumsum(psd)
    rolloff_thresh = 0.85 * cumsum[-1]
    rolloff_idx = np.where(cumsum >= rolloff_thresh)[0]
    rolloff = float(freqs[rolloff_idx[0]]) if len(rolloff_idx) > 0 else float(freqs[-1])

    # 4. Zero-Crossing Rate
    zcr = float(np.mean(np.abs(np.diff(np.sign(audio_data))))) / 2.0

    # 5. RMS громкость
    rms = float(np.sqrt(np.mean(audio_data ** 2)))

    features = np.array([
        *band_energies,
        centroid / 2000.0,
        rolloff / 3000.0,
        zcr * 10.0,
        float(np.log10(rms + 1e-6)),
    ], dtype=np.float32)
    return features


def cluster_2_kmeans(X_norm: np.ndarray, n_init: int = 10, max_iter: int = 30) -> tuple[np.ndarray, float]:
    """2-кластерный k-means и расчет силуэта на чистом NumPy (без sklearn)."""
    n_samples = len(X_norm)
    if n_samples < 2:
        return np.zeros(n_samples, dtype=int), 0.0

    best_inertia = float("inf")
    best_labels = np.zeros(n_samples, dtype=int)

    rng = np.random.default_rng(42)

    for _ in range(n_init):
        # Инициализация центроидов: случайный первый, наиболее удаленный второй
        idx1 = int(rng.integers(0, n_samples))
        c1 = X_norm[idx1]
        dists1 = np.sum((X_norm - c1) ** 2, axis=1)
        idx2 = int(np.argmax(dists1))
        c2 = X_norm[idx2]

        centers = np.stack([c1, c2])

        for _ in range(max_iter):
            d0 = np.sum((X_norm - centers[0]) ** 2, axis=1)
            d1 = np.sum((X_norm - centers[1]) ** 2, axis=1)
            labels = (d1 < d0).astype(int)

            m0 = labels == 0
            m1 = labels == 1
            if not np.any(m0) or not np.any(m1):
                break

            new_c0 = np.mean(X_norm[m0], axis=0)
            new_c1 = np.mean(X_norm[m1], axis=0)

            if np.allclose(centers[0], new_c0) and np.allclose(centers[1], new_c1):
                break
            centers = np.stack([new_c0, new_c1])

        inertia = float(np.sum(np.min(np.stack([d0, d1]), axis=0)))
        if inertia < best_inertia:
            best_inertia = inertia
            best_labels = labels

    # Расчет коэффициента силуэта (silhouette score)
    m0 = best_labels == 0
    m1 = best_labels == 1
    if not np.any(m0) or not np.any(m1) or n_samples < 3:
        return best_labels, 0.0

    diffs = X_norm[:, np.newaxis, :] - X_norm[np.newaxis, :, :]
    dist_matrix = np.sqrt(np.sum(diffs ** 2, axis=2))

    sil_scores = []
    for i in range(n_samples):
        same_mask = m0 if best_labels[i] == 0 else m1
        other_mask = m1 if best_labels[i] == 0 else m0

        same_count = np.sum(same_mask) - 1
        a = float(np.sum(dist_matrix[i, same_mask]) / same_count) if same_count > 0 else 0.0
        b = float(np.mean(dist_matrix[i, other_mask]))

        max_ab = max(a, b)
        s = (b - a) / max_ab if max_ab > 0 else 0.0
        sil_scores.append(s)

    mean_sil = float(np.mean(sil_scores))
    return best_labels, mean_sil


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

    # Извлекаем легкий 16kHz mono 16-bit PCM WAV для быстрого чтения через wave
    ffmpeg_bin = require_tool("ffmpeg")
    cmd = [
        ffmpeg_bin, "-y", "-v", "error", "-nostdin",
        "-i", str(source_path),
        "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
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
        data, sr = read_wav_16k_mono(wav_path)
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
        # Нормализация признаков
        mean = np.mean(X, axis=0)
        std = np.std(X, axis=0) + 1e-8
        X_norm = (X - mean) / std

        # Кластеризация на чистом NumPy
        labels, sil = cluster_2_kmeans(X_norm, n_init=10)

        if sil < 0.08:
            # Различия минимальны — скорее всего один человек говорит в разной тональности
            if log:
                log(f"Диаризация: различия между голосами незначительны (силуэт {sil:.2f}), обнаружен 1 спикер")
            for c in cues:
                c["speaker"] = "SPEAKER_1"
            return {"speakers_count": 1, "cues": cues, "stats": {"SPEAKER_1": len(cues)}}

        # Определяем первого говорящего как SPEAKER_1
        first_cluster = int(labels[0])
        cluster_to_speaker = {
            first_cluster: "SPEAKER_1",
            1 - first_cluster: "SPEAKER_2",
        }

        # Применяем метки
        for idx_in_valid, orig_idx in enumerate(valid_indices):
            cues[orig_idx]["speaker"] = cluster_to_speaker[int(labels[idx_in_valid])]

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
