import os, time, traceback
os.environ.setdefault("HF_HUB_OFFLINE", "0")
import torch
from transformers import AutoModel
snap = os.path.expanduser("~/.cache/huggingface/hub/models--m-a-p--YuE2-3B/snapshots")
asset = None
for d in os.listdir(snap):
    p = os.path.join(snap, d, "assets", "audio", "jingle-bells-heavy-metal-cover.mp3")
    if os.path.exists(p): asset = p
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "transcribe")
try:
    t0 = time.time()
    model = AutoModel.from_pretrained("m-a-p/SheetSage2", trust_remote_code=True).eval().to("cuda")
    print(f"loaded {time.time()-t0:.1f}s", flush=True)
    t0 = time.time()
    result = model.transcribe(asset, output_dir=out)
    print(f"[PASS] SheetSage2 ({time.time()-t0:.1f}s) abc chars:", len(result["abc"]), flush=True)
    print(result["abc"][:200], flush=True)
except Exception:
    traceback.print_exc(); print("[FAIL] SheetSage2", flush=True)
