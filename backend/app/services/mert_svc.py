"""MERT-v2-FullSong analysis: clip embedding + structure segmentation."""

from pathlib import Path

import numpy as np
import soundfile as sf
import torch
import torchaudio.functional as AF

from .models_mgr import models

MAX_WINDOW_S = 300  # FullSong is pretrained on 30-360s; stay inside comfortably


def _load_mono(path: str, target_sr: int) -> np.ndarray:
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if sr != target_sr:
        mono = AF.resample(torch.from_numpy(mono), sr, target_sr).numpy()
    return mono


def analyze_file(src: str, emit=None) -> dict:
    """Return {embedding: [1024] L2-normalized, frames_1hz: [T,1024], duration}."""
    emit = emit or (lambda **e: None)
    emit(stage="load_model", detail="loading MERT-v2-FullSong")
    processor, model = models.mert()
    device = next(model.parameters()).device
    sr = processor.sampling_rate

    emit(stage="decode", detail="decoding audio")
    mono = _load_mono(src, sr)
    duration = len(mono) / sr
    win = MAX_WINDOW_S * sr
    windows = [mono[i : i + win] for i in range(0, len(mono), win)] or [mono]

    clip_parts, frame_parts = [], []
    for wi, w in enumerate(windows):
        if len(w) < sr // 2:
            continue
        emit(stage="embed", detail=f"embedding window {wi + 1}/{len(windows)}")
        inputs = processor(w, sampling_rate=sr, return_tensors="pt").to(device)
        with torch.inference_mode():
            out = model(**inputs, output_hidden_states=True)
        frames = out.last_hidden_state[0]  # [T, 1024] @ 25Hz
        mask = out.feature_attention_mask[0].to(frames.dtype)[..., None]  # [T, 1]
        clip = (frames * mask).sum(0) / mask.sum(0).clamp_min(1)
        clip_parts.append(clip.float().cpu().numpy())
        frame_parts.append(frames.float().cpu().numpy())

    clip_vec = np.mean(clip_parts, axis=0)
    clip_vec /= np.linalg.norm(clip_vec) + 1e-9
    if not frame_parts:
        raise ValueError("audio too short for MERT analysis (need at least ~0.5s)")
    frames_all = np.concatenate(frame_parts, axis=0)
    return {
        "embedding": clip_vec,
        "frames_25hz": frames_all.astype(np.float16),
        "duration": duration,
    }


def segment_structure(frames_25hz: np.ndarray, fps: int = 25, min_segment: float = 12.0) -> list:
    """Foote-style novelty segmentation on 1Hz-pooled frame embeddings.

    Returns [{"start": s, "end": s, "label": "A"|"B"|...}, ...]
    """
    pooled = frames_25hz.astype(np.float32)
    if pooled.shape[0] < fps * 30:
        return []
    pooled = pooled[: (pooled.shape[0] // fps) * fps]
    pooled = pooled.reshape(-1, fps, pooled.shape[1]).mean(axis=1)  # 1 Hz
    norm = pooled / (np.linalg.norm(pooled, axis=1, keepdims=True) + 1e-9)
    T = len(norm)
    w = min(24, T // 4)  # checkerboard kernel half-size (seconds)
    if w < 6:
        return []
    kernel = np.block([[np.ones((w, w)), -np.ones((w, w))], [-np.ones((w, w)), np.ones((w, w))]]) / (2 * w)
    sim = norm @ norm.T
    novelty = np.zeros(T)
    for t in range(w, T - w):
        novelty[t] = float((sim[t - w : t + w, t - w : t + w] * kernel).sum())
    # peak pick with min gap
    min_gap = int(min_segment)
    peaks = []
    order = np.argsort(novelty[w : T - w])[::-1] + w
    for t in order:
        if all(abs(t - p) >= min_gap for p in peaks):
            peaks.append(int(t))
        if len(peaks) >= 24:
            break
    bounds = sorted([0] + peaks + [T])
    # label segments greedily by mean embedding similarity
    labels, next_label = [], 0
    seg_means = []
    for a, b in zip(bounds, bounds[1:]):
        if b - a < min_gap:
            labels.append(None)
            seg_means.append(None)
            continue
        m = norm[a:b].mean(axis=0)
        m /= np.linalg.norm(m) + 1e-9
        assigned = None
        for idx, (sm, lb) in enumerate(zip(seg_means, labels)):
            if sm is not None and float(sm @ m) > 0.995:
                assigned = lb
                break
        if assigned is None:
            assigned = chr(ord("A") + next_label)
            next_label += 1
        labels.append(assigned)
        seg_means.append(m)
    segments = []
    for (a, b), lb in zip(zip(bounds, bounds[1:]), labels):
        if lb is None:
            continue
        segments.append({"start": round(a, 1), "end": round(b, 1), "label": lb})
    return segments
