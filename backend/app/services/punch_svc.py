"""Region re-performance (punch): NAR candidates for a time region + latent-domain splice.

Core idea: the NAR synthesizer conditions on (text/ABC prefix + semantic tokens of the
segment) and draws its own noise per seed, so re-synthesizing latents for a segment
with different seeds yields different performances of identical musical content. A
chosen take is blended back into the cached full-song latents with short crossfades
and decoded via the VAE.
"""

import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from ..core.config import settings
from .models_mgr import models

FPS = 25  # latent frames per second (1920 samples @ 48kHz)
HALO = 16  # crossfade frames at both edges (0.64s)
MIN_FRAMES = 25  # 1s


def decode_latents(z: np.ndarray) -> np.ndarray:
    """Decode [T,64] float32 latents to [samples, 2] audio via the resident VAE."""
    import torch

    vae = models.vae()
    device = next(vae.parameters()).device
    with torch.inference_mode():
        audio = vae.decode(torch.from_numpy(z.T[None].astype(np.float32)).to(device)).cpu()
    return audio[0].float().clamp(-1, 1).T.numpy()


def decode_latents_full(z: np.ndarray) -> np.ndarray:
    """Tiled decode for full songs ([T,64] -> [samples, 2])."""
    import torch

    vae = models.vae()
    device = next(vae.parameters()).device
    with torch.inference_mode():
        audio = vae.decode_tiled(
            torch.from_numpy(z.T[None].astype(np.float32)).to(device),
            core_frames=1024, halo_frames=16, output_device="cpu",
        )
    return audio[0].float().clamp(-1, 1).T.numpy()


def load_context(version) -> dict:
    """Reconstruct everything the NAR needs from a stored version."""
    cfg = version.config_json or {}
    latents = np.load(version.latents_path).astype(np.float32)  # [T, 64]
    codec = np.load(version.semantic_path).tolist()
    vdir = Path(version.audio_path).parent
    abc_text = (vdir / "plan.abc").read_text(encoding="utf-8") if (vdir / "plan.abc").exists() else ""
    from yue2.protocol import SongRequest, token_prefixes

    pipe = models.pipeline()
    request = SongRequest(
        style=cfg.get("style", ""), lyrics=cfg.get("lyrics", ""),
        cot=cfg.get("cot", "full"), seed=int(cfg.get("seed", 0)),
    )
    if cfg.get("cot") == "off":
        prefix = token_prefixes(request, pipe.tokenizer)
    else:
        prefix = token_prefixes(request, pipe.tokenizer, pipe.tokenizer.encode(abc_text))
    return {
        "latents": latents,
        "codec": codec,
        "prefix": prefix,
        "ode_steps": pipe.generation_config.ode_steps,
        "context": pipe.generation_config.context,
        "seed": int(cfg.get("seed", 0)),
        "dir": vdir,
    }


def _snap_to_beats(a: float, b: float, beats: list[float], downbeats: list[float]) -> tuple[float, float]:
    """Snap region edges outward to the nearest downbeat (fallback: beat)."""
    grid = downbeats or beats
    if not grid:
        return a, b
    import bisect

    pre = [t for t in grid if t <= a + 0.05]
    post = [t for t in grid if t >= b - 0.05]
    if pre:
        a = pre[-1]
    if post:
        b = post[0]
    return a, b


def make_candidates(version, region: tuple[float, float], n: int, seeds: list | None, emit, snap_to_beats: bool = True) -> dict:
    """Synthesize N alternative performances of [region] and decode audition wavs."""
    emit = emit or (lambda **e: None)
    ctx = load_context(version)
    T = len(ctx["latents"])
    a = max(0, int(region[0] * FPS))
    b = min(T, max(a + MIN_FRAMES, int(region[1] * FPS)))
    snapped = False
    if snap_to_beats:
        from .transcribe_svc import load_beats

        beats = load_beats(version)
        if beats["beats"] or beats["downbeats"]:
            fa, fb = _snap_to_beats(a / FPS, b / FPS, beats["beats"], beats["downbeats"])
            na, nb = max(0, int(fa * FPS)), min(T, max(int(fa * FPS) + MIN_FRAMES, int(fb * FPS)))
            if nb - na >= MIN_FRAMES and (na != a or nb != b):
                a, b = na, nb
                snapped = True
    if b - a < MIN_FRAMES:
        raise ValueError("region too short (min 1s)")
    punch_dir = ctx["dir"] / "punches" / f"p_{int(time.time())}"
    punch_dir.mkdir(parents=True, exist_ok=True)

    emit(stage="load_model", detail="loading YuE2 (NAR)")
    pipe = models.pipeline()
    model = pipe._load_model(for_nar=True)
    from yue2.nar import synthesize as nar_synthesize

    candidates = []
    seeds = seeds or [ctx["seed"] + 101 + i for i in range(n)]
    for i, seed_i in enumerate(seeds[:n]):
        emit(stage="nar", detail=f"candidate {i + 1}/{len(seeds[:n])} (seed {seed_i})")
        lat = nar_synthesize(
            model, ctx["prefix"], ctx["codec"][a:b], int(seed_i),
            steps=ctx["ode_steps"], context=ctx["context"],
        )
        if isinstance(lat, torch.Tensor):
            lat = lat.numpy()
        lat = np.asarray(lat, dtype=np.float32)
        np.save(punch_dir / f"cand_{i}.npy", lat)
        emit(stage="decode", detail=f"preview {i + 1}")
        wav = decode_latents(lat)
        sf.write(punch_dir / f"cand_{i}.wav", wav, 48000, subtype="PCM_16")
        candidates.append({
            "idx": i,
            "seed": int(seed_i),
            "latents_path": str(punch_dir / f"cand_{i}.npy"),
            "audition_url": f"/audio/{punch_dir.relative_to(settings.data_dir)}/cand_{i}.wav",
        })

    manifest = {
        "version_id": version.id, "region": list(region), "a": a, "b": b,
        "snapped": snapped, "candidates": candidates, "created_at": time.time(),
    }
    (punch_dir / "punch.json").write_text(json.dumps(manifest), encoding="utf-8")
    return {
        "punch_id": punch_dir.name,
        "region": list(region),
        "seconds": round((b - a) / FPS, 2),
        "snapped": snapped,
        "candidates": candidates,
    }


def apply_candidate(version, punch_id: str, idx: int, emit) -> dict:
    """Blend the chosen candidate into the song latents and decode a new version."""
    emit = emit or (lambda **e: None)
    ctx = load_context(version)
    punch_dir = ctx["dir"] / "punches" / punch_id
    manifest = json.loads((punch_dir / "punch.json").read_text(encoding="utf-8"))
    if manifest["version_id"] != version.id:
        raise ValueError("punch does not belong to this version")
    a, b = manifest["a"], manifest["b"]
    cand_path = punch_dir / f"cand_{idx}.npy"
    if not cand_path.exists():
        raise ValueError(f"candidate {idx} not found")
    cand = np.load(cand_path).astype(np.float32)

    orig = ctx["latents"]
    out = orig.copy()
    seg_len = b - a
    if len(cand) != seg_len:
        # tolerate small frame drift by trimming/padding the tail
        if len(cand) > seg_len:
            cand = cand[:seg_len]
        else:
            cand = np.pad(cand, ((0, seg_len - len(cand)), (0, 0)), mode="edge")
    w = np.ones(seg_len, dtype=np.float32)
    ramp = np.linspace(0.0, 1.0, HALO, dtype=np.float32)
    w[:HALO] = ramp
    w[-HALO:] = ramp[::-1]
    out[a:b] = cand * w[:, None] + orig[a:b] * (1.0 - w[:, None])

    emit(stage="decode", detail="decoding full song")
    audio = decode_latents_full(out)
    return {"audio": audio, "latents": out, "a": a, "b": b, "manifest": manifest, "idx": idx}
