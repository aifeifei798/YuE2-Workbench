"""HTDemucs stem separation service."""

import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from .models_mgr import models


def separate_file(src: str, out_dir: Path, emit=None) -> dict:
    """Separate src into 4 stems (FLAC). Returns url dict."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    emit = emit or (lambda **e: None)

    emit(stage="load_model", detail="loading HTDemucs-ft")
    model = models.demucs()
    device = next(model.parameters()).device

    emit(stage="load_audio", detail="decoding audio")
    wav, sr = _load_audio(src)
    # demucs expects [channels, frames] at model samplerate
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std() + 1e-8

    emit(stage="separate", detail="separating stems")
    from demucs.apply import apply_model

    with torch.inference_mode():
        sources = apply_model(model, wav[None].to(device), device=device, progress=False)[0]  # [S, C, T]
    sources = sources * ref.std() + ref.mean()

    names = list(model.sources)  # drums, bass, other, vocals
    urls, paths = {}, {}
    samplerate = model.samplerate
    for i, name in enumerate(names):
        out = out_dir / f"{name}.flac"
        audio = sources[i].cpu().numpy().T
        sf.write(out, audio, samplerate, subtype="PCM_16")
        urls[name] = f"/audio/stems/{out_dir.name}/{name}.flac"
        paths[name] = str(out)
        emit(stage="separate", detail=f"saved {name}")
    return {"stems": urls, "paths": paths, "samplerate": samplerate}


def _load_audio(src: str) -> tuple[torch.Tensor, int]:
    """Decode any audio file to [C, T] float32 tensor via ffmpeg -> wav."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", src,
             "-ac", "2", "-ar", "44100", "-f", "wav", tmp_path],
            check=True, capture_output=True,
        )
        data, sr = sf.read(tmp_path, dtype="float32", always_2d=True)
        return torch.from_numpy(data.T), sr
    finally:
        os.unlink(tmp_path)
