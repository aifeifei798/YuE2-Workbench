"""P0 smoke: YuE2 (load + plan + short song) -> SheetSage2 transcribe -> MERT embed.
Run sequentially in one process to keep GPU memory ordered."""

import os
import sys
import time
import traceback

os.environ.setdefault("HF_HUB_OFFLINE", "1")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "smoke", "out")
os.makedirs(OUT, exist_ok=True)

SNAP = os.path.expanduser(
    "~/.cache/huggingface/hub/models--m-a-p--YuE2-3B/snapshots"
)
ASSET = None
for d in os.listdir(SNAP):
    p = os.path.join(SNAP, d, "assets", "audio", "jingle-bells-heavy-metal-cover.mp3")
    if os.path.exists(p):
        ASSET = p
        break

STYLE = "acoustic pop, warm female vocal, piano, light strings"
LYRICS = "[Verse]\nSmoke test running late at night\nEvery token falls in place\n\n[Chorus]\nBurn it bright, burn it clean\nThis is just a test tonight"


def step(name, fn):
    print(f"\n===== {name} =====", flush=True)
    t0 = time.time()
    try:
        fn()
        print(f"[PASS] {name} ({time.time() - t0:.1f}s)", flush=True)
        return True
    except Exception:
        traceback.print_exc()
        print(f"[FAIL] {name} ({time.time() - t0:.1f}s)", flush=True)
        return False


def smoke_yue2():
    import torch
    from yue2 import YuE2Pipeline

    t0 = time.time()
    pipe = YuE2Pipeline.from_pretrained("m-a-p/YuE2-3B", device="cuda", progress=False)
    print(f"pipeline loaded in {time.time() - t0:.1f}s", flush=True)
    t0 = time.time()
    plan = pipe.plan(style=STYLE, lyrics=LYRICS, cot="full", seed=42)
    print(f"plan ok, abc {len(plan.abc or '')} chars in {time.time() - t0:.1f}s", flush=True)
    print((plan.abc or "")[:200], flush=True)
    t0 = time.time()
    song = pipe(style=STYLE, lyrics=LYRICS, cot="full", seed=42)
    dur = len(song.audio) / 48000
    print(f"song {dur:.1f}s generated in {time.time() - t0:.1f}s", flush=True)
    path = os.path.join(OUT, "smoke.flac")
    song.save(path)
    print("saved", path, flush=True)
    pipe.close()


def smoke_vae_roundtrip():
    import numpy as np
    import torch
    from yue2.modeling_vae import YuE2VAE

    vae = YuE2VAE.from_pretrained("m-a-p/YuE2-Vae", device="cuda", local_files_only=True)
    z = torch.randn(1, 64, 200, generator=torch.Generator().manual_seed(0))
    with torch.inference_mode():
        audio = vae.decode(z).cpu()
    assert torch.isfinite(audio).all(), "non-finite audio"
    print("decode ok, audio", tuple(audio.shape), flush=True)
    vae = vae.to("cpu")
    del vae
    torch.cuda.empty_cache()


def smoke_sheetsage2():
    import torch
    from transformers import AutoModel

    model = AutoModel.from_pretrained(
        "m-a-p/SheetSage2", trust_remote_code=True
    ).eval().to("cuda" if torch.cuda.is_available() else "cpu")
    out = os.path.join(OUT, "transcribe")
    result = model.transcribe(ASSET, output_dir=out)
    abc = result["abc"]
    print("transcribed abc chars:", len(abc), flush=True)
    print(abc[:200], flush=True)
    del model
    torch.cuda.empty_cache()


def smoke_mert():
    import soundfile as sf
    import torch
    import torchaudio.functional as AF
    from transformers import AutoFeatureExtractor, AutoModel

    repo = "m-a-p/MERT-v2-30s"
    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = AutoFeatureExtractor.from_pretrained(repo, trust_remote_code=True)
    model = AutoModel.from_pretrained(repo, trust_remote_code=True).eval().to(device)
    audio, sr = sf.read(ASSET, dtype="float32", always_2d=True)
    audio = audio[: 30 * sr].mean(axis=1)
    wave = AF.resample(torch.from_numpy(audio), sr, processor.sampling_rate)
    inputs = processor(wave.numpy(), sampling_rate=processor.sampling_rate, return_tensors="pt").to(device)
    with torch.inference_mode():
        out = model(**inputs, output_hidden_states=True)
    print("frames", tuple(out.last_hidden_state.shape), "layers", len(out.hidden_states), flush=True)
    del model
    torch.cuda.empty_cache()


ok = True
ok &= step("YuE2 load+plan+generate", smoke_yue2)
ok &= step("YuE2-Vae decode", smoke_vae_roundtrip)
ok &= step("SheetSage2 transcribe", smoke_sheetsage2)
ok &= step("MERT-v2-30s embed", smoke_mert)
print("\nSMOKE", "ALL PASS" if ok else "HAS FAILURES", flush=True)
sys.exit(0 if ok else 1)
