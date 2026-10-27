"""Train per-tag logistic probes on MTT MERT embeddings.

Run AFTER extract_mtt_embeddings.py finishes:
  .venv/bin/python backend/scripts/train_tag_probes.py
"""

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "mtt_probes"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "scripts"))

from extract_mtt_embeddings import load_annotations  # noqa: E402

# english tag → 中文 label (all present in MTT's 168 tag columns)
TAGS = {
    "classical": "古典", "jazz": "爵士", "rock": "摇滚", "pop": "流行",
    "electronic": "电子", "folk": "民谣", "metal": "金属", "ambient": "氛围",
    "new age": "新世纪", "blues": "蓝调", "hip hop": "嘻哈",
    "happy": "欢快", "sad": "忧郁", "calm": "平静", "dark": "暗黑",
    "upbeat": "明快", "mellow": "柔和",
    "guitar": "吉他", "piano": "钢琴", "drums": "鼓", "violin": "小提琴",
    "strings": "弦乐", "voice": "人声",
}


def main():
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import average_precision_score
    from sklearn.model_selection import train_test_split

    rows = load_annotations()
    emb = np.load(DATA / "embeddings.npy")
    tag_names = list(TAGS)
    keep = [i for i, (_, _, flags) in enumerate(rows) if np.abs(emb[i]).sum() > 0]
    X = emb[keep]
    Y = np.array([[flags.get(t, 0) for t in tag_names] for i in keep for _, _, flags in [rows[i]]])
    print(f"{len(X)} clips · {len(tag_names)} tags")

    X_tr, X_va, Y_tr, Y_va = train_test_split(X, Y, test_size=0.08, random_state=42)
    out = {}
    AP_MIN = 0.4  # subjective/mood tags in MTT are noisy: only ship reliable probes
    for j, en in enumerate(tag_names):
        y, yv = Y_tr[:, j], Y_va[:, j]
        if y.sum() < 50:
            print(f"[skip] {en}: only {int(y.sum())} positives")
            continue
        lr = LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0)
        lr.fit(X_tr, y)
        prob = lr.predict_proba(X_va)[:, 1]
        auc = average_precision_score(yv, prob) if yv.sum() else 0.0
        if auc < AP_MIN:
            print(f"[skip] {en}: AP={auc:.3f} < {AP_MIN}")
            continue
        # per-tag threshold: max F1 on validation
        best_t, best_f1 = 0.5, 0.0
        for t in np.linspace(0.2, 0.9, 29):
            pred = prob >= t
            tp = float((pred & (yv == 1)).sum())
            f1 = 2 * tp / max(1e-9, 2 * tp + float((pred & (yv == 0)).sum()) + float(((~pred) & (yv == 1)).sum()))
            if f1 > best_f1:
                best_t, best_f1 = float(t), f1
        out[en] = {"zh": TAGS[en], "threshold": best_t, "model": lr}
        print(f"{en:12s} → {TAGS[en]:　<4} AP={auc:.3f} thr={best_t:.2f} pos={int(y.sum())}")

    import joblib

    joblib.dump({"tags": out}, DATA / "probes.joblib")
    print(f"saved {len(out)} probes → {DATA / 'probes.joblib'}")


if __name__ == "__main__":
    main()
