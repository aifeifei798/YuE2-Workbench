import os, time, traceback
os.environ.setdefault("HF_HUB_OFFLINE", "1")
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SRC = "/home/feifei/develop/app/YuE2-Workbench/data/projects/p_35663ba10d97/v01/song.flac"
OUT = "/home/feifei/develop/app/YuE2-Workbench/smoke/out"

def step(name, fn):
    print(f"===== {name} =====", flush=True)
    t0 = time.time()
    try:
        fn(); print(f"[PASS] {name} ({time.time()-t0:.1f}s)", flush=True); return True
    except Exception:
        traceback.print_exc(); print(f"[FAIL] {name} ({time.time()-t0:.1f}s)", flush=True); return False

def stems():
    from backend.app.services.stems_svc import separate_file
    r = separate_file(SRC, os.path.join(OUT, "stems_test"))
    print("stems:", {k: v.split("/")[-1] for k, v in r["stems"].items()}, flush=True)

def mert():
    from backend.app.services.mert_svc import analyze_file, segment_structure
    r = analyze_file(SRC)
    print("embedding:", r["embedding"].shape, "norm", float((r["embedding"]**2).sum())**0.5, flush=True)
    seg = segment_structure(r["frames_25hz"])
    print("segments:", seg, flush=True)

ok = step("HTDemucs separate", stems)
ok &= step("MERT-FullSong analyze", mert)
print("SMOKE P2", "ALL PASS" if ok else "HAS FAILURES", flush=True)
