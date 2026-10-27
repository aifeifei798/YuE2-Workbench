"""Extract MERT clip embeddings for MagnaTagATune (resumable, memmap storage).

Dataset: confit/magnatagatune (HF) — download with hfd.sh, e.g.:
  env -u http_proxy -u https_proxy HF_ENDPOINT=https://hf-mirror.com \
    bash hfd.sh confit/magnatagatune --dataset --local-dir <dir> -x 8

Run: .venv/bin/python backend/scripts/extract_mtt_embeddings.py \
      [--dataset <dir>] [--limit N]
"""

import csv
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "mtt_probes"
DATASET = Path(
    os.environ.get("MTT_DIR")
    or (sys.argv[sys.argv.index("--dataset") + 1] if "--dataset" in sys.argv else "")
    or "/home/feifei/develop/models/magnatagatune"
)

sys.path.insert(0, str(ROOT / "backend"))


def load_annotations():
    """Return list of (clip_id, mp3_path, {tag: 1|0})."""
    path = DATASET / "annotations_final.csv"
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter="\t")
        header = next(reader)
        tags = [t.strip('"') for t in header[1:-1]]
        for r in reader:
            r = [c.strip('"') for c in r]
            mp3 = r[-1]
            flags = {tags[i]: int(r[i + 1]) for i in range(len(tags))}
            rows.append((int(r[0]), mp3, flags))
    return rows


def main():
    limit = 0
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    DATA.mkdir(parents=True, exist_ok=True)
    rows = load_annotations()
    if limit:
        rows = rows[:limit]

    emb_path = DATA / "embeddings.npy"
    done_path = DATA / "done.json"
    done = set(json.loads(done_path.read_text())) if done_path.exists() else set()
    N, D = len(rows), 1024
    if emb_path.exists():
        shape = np.load(emb_path, mmap_mode="r").shape
        if shape[0] != N:
            # store built by a --limit run: rebuild for the full dataset
            emb_path.unlink()
            done_path.unlink(missing_ok=True)
            done = set()
    if not emb_path.exists():
        np.lib.format.open_memmap(emb_path, mode="w+", dtype=np.float32, shape=(N, D))

    import torch

    from app.services.models_mgr import models

    processor, model = models.mert()
    device = next(model.parameters()).device
    sr = processor.sampling_rate

    import soundfile as sf
    import torchaudio.functional as AF

    emb = np.load(emb_path, mmap_mode="r+")
    t0 = time.time()
    n_new = 0
    for i, (clip_id, mp3, flags) in enumerate(rows):
        if i in done:
            continue
        f = DATASET / mp3
        if not f.exists():
            emb[i, :] = 0.0
            done.add(i)
            continue
        try:
            data, file_sr = sf.read(f, dtype="float32", always_2d=True)
            mono = data.mean(axis=1)
            if file_sr != sr:
                mono = AF.resample(torch.from_numpy(mono), file_sr, sr).numpy()
            inputs = processor(mono, sampling_rate=sr, return_tensors="pt").to(device)
            with torch.inference_mode():
                out = model(**inputs)
            frames = out.last_hidden_state[0]
            vec = frames.mean(dim=0).float().cpu().numpy()
            vec /= np.linalg.norm(vec) + 1e-9
            emb[i, :] = vec
            done.add(i)
            n_new += 1
        except Exception as e:
            print(f"[skip] {mp3}: {e}", flush=True)
            emb[i, :] = 0.0
            done.add(i)
        if n_new % 200 == 0 and n_new:
            rate = n_new / (time.time() - t0)
            print(f"{i + 1}/{N} · {rate:.2f}/s · eta {(N - i) / rate / 60:.0f}min", flush=True)
            done_path.write_text(json.dumps(sorted(done)))
    done_path.write_text(json.dumps(sorted(done)))
    print(f"DONE {n_new} new, {len(done)}/{N} total in {(time.time() - t0) / 60:.1f}min", flush=True)


if __name__ == "__main__":
    main()
