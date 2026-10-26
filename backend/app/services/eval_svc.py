"""Version quality evaluation: audio stats, lyric intelligibility (CER),
MERT structural coherence, VAE reconstruction error. Plus duel comparison."""

import json
import re
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import soundfile as sf

from .asr_svc import transcribe_lyrics
from .mert_svc import analyze_file
from .models_mgr import models

_SECTION_RE = re.compile(r"\[[^\]]*\]|%.*")
_PUNCT_RE = re.compile(r"[^\w\u4e00-\u9fff]+")


def normalize_lyrics(text: str) -> str:
    text = _SECTION_RE.sub("", text)
    text = _PUNCT_RE.sub("", text).lower()
    return text


def _audio_stats(audio: np.ndarray) -> dict:
    peak = float(np.abs(audio).max())
    clip_ratio = float((np.abs(audio) > 0.999).mean())
    rms = float(np.sqrt((audio**2).mean()))
    crest = round(20 * np.log10(peak / (rms + 1e-9)), 2)
    return {"peak": round(peak, 4), "clip_ratio": round(clip_ratio, 6),
            "rms": round(rms, 4), "crest_db": crest}


def _coherence(frames_25hz: np.ndarray) -> float:
    """Mean cosine similarity between adjacent 8s blocks (structure smoothness)."""
    fps = 25
    pooled = frames_25hz.astype(np.float32)
    if pooled.shape[0] < fps * 16:
        return 0.0
    pooled = pooled[: (pooled.shape[0] // (fps * 8)) * fps * 8]
    blocks = pooled.reshape(-1, fps * 8, pooled.shape[1]).mean(axis=1)
    norm = blocks / (np.linalg.norm(blocks, axis=1, keepdims=True) + 1e-9)
    sims = [float(a @ b) for a, b in zip(norm, norm[1:])]
    return round(sum(sims) / len(sims), 4) if sims else 0.0


def evaluate_version(version, emit) -> dict:
    emit = emit or (lambda **e: None)
    vdir = Path(version.audio_path).parent
    out_path = vdir / "eval.json"
    if out_path.exists():
        return json.loads(out_path.read_text(encoding="utf-8"))

    cfg = version.config_json or {}
    audio, sr = sf.read(version.audio_path, dtype="float32", always_2d=True)
    metrics: dict = {"duration": round(len(audio) / sr, 2)}
    emit(stage="stats", detail="audio statistics")
    metrics["audio"] = _audio_stats(audio)

    emit(stage="asr", detail="lyrics intelligibility (ASR)")
    try:
        asr = transcribe_lyrics(version.audio_path, emit)
        ref = normalize_lyrics(cfg.get("lyrics", ""))
        hyp = normalize_lyrics(asr["text"])
        metrics["intelligibility"] = round(SequenceMatcher(None, ref, hyp).ratio(), 4) if ref else None
        metrics["asr_text"] = asr["text"][:200]
    except Exception as exc:
        metrics["intelligibility"] = None
        metrics["asr_error"] = str(exc)[:120]

    emit(stage="mert", detail="MERT embedding + coherence")
    analysis = analyze_file(version.audio_path, emit)
    metrics["coherence"] = _coherence(analysis["frames_25hz"])
    emb_path = vdir / "eval_embedding.npy"
    np.save(emb_path, analysis["embedding"])
    metrics["embedding_path"] = str(emb_path)

    emit(stage="vae_recon", detail="VAE reconstruction error")
    try:
        import torch

        from .punch_svc import decode_latents_full

        vae = models.full_vae()
        device = next(vae.parameters()).device
        x = torch.from_numpy(audio.T[None].astype(np.float32)).to(device)  # [1,2,S]
        with torch.inference_mode():
            z = vae.encode(x)
            if isinstance(z, tuple):
                z = z[0]
            recon = vae.decode_tiled(z.float(), core_frames=1024, halo_frames=16, output_device="cpu")
        recon = recon[0].numpy().T  # [S, 2]
        n = min(len(recon), len(audio))
        err = audio[:n] - recon[:n]
        snr = 10 * np.log10((audio[:n] ** 2).sum() / ((err**2).sum() + 1e-9))
        metrics["vae_recon_snr_db"] = round(float(snr), 2)
        metrics["latent_shape"] = list(z.shape[-2:])
    except Exception as exc:
        metrics["vae_recon_snr_db"] = None
        metrics["vae_error"] = str(exc)[:120]

    out_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=1), encoding="utf-8")
    return metrics


def duel(metrics_a: dict, metrics_b: dict, label_a: str, label_b: str) -> dict:
    """Rule-based suggestion + metric deltas. Human listens and decides."""

    def better(key, higher=True):
        va, vb = metrics_a.get(key), metrics_b.get(key)
        if va is None or vb is None:
            return None
        if va == vb:
            return "tie"
        if higher:
            return label_a if va > vb else label_b
        return label_a if va < vb else label_b

    rows = [
        {"metric": "歌词清晰度 intelligibility", "a": metrics_a.get("intelligibility"), "b": metrics_b.get("intelligibility"), "winner": better("intelligibility")},
        {"metric": "结构连贯性 coherence", "a": metrics_a.get("coherence"), "b": metrics_b.get("coherence"), "winner": better("coherence")},
        {"metric": "VAE 重构 SNR (dB)", "a": metrics_a.get("vae_recon_snr_db"), "b": metrics_b.get("vae_recon_snr_db"), "winner": better("vae_recon_snr_db")},
        {"metric": "削波率 clip_ratio", "a": metrics_a.get("audio", {}).get("clip_ratio"), "b": metrics_b.get("audio", {}).get("clip_ratio"), "winner": better("audio.clip_ratio", higher=False)},
        {"metric": "峰值因数 crest (dB)", "a": metrics_a.get("audio", {}).get("crest_db"), "b": metrics_b.get("audio", {}).get("crest_db"), "winner": None},
    ]
    wins = [r["winner"] for r in rows if r["winner"] in (label_a, label_b)]
    suggestion = "tie"
    if wins:
        suggestion = label_a if wins.count(label_a) > wins.count(label_b) else label_b
    return {"rows": rows, "auto_suggestion": suggestion}
