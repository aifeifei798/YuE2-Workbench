"""Music library: import + MERT analysis + similarity search + playlist."""

import os
import shutil
from pathlib import Path

import numpy as np

from ..core.config import settings
from ..core.db import SessionLocal
from ..models.tables import LibraryItem, uid
from .mert_svc import analyze_file, segment_structure
from .transcribe_svc import transcribe_file


def compute_tags(path: str, key: str | None = None, tempo: float | None = None) -> list[str]:
    """Heuristic mood/energy tags from measurable features (no external data needed)."""
    import numpy as np
    import soundfile as sf

    tags = []
    try:
        data, sr = sf.read(path, dtype="float32", always_2d=True)
        mono = data.mean(axis=1)
        n = len(mono)
        seg = mono[n // 3 : n // 3 + sr * 30] if n > sr * 40 else mono
        rms = float(np.sqrt((seg**2).mean()))
        tags.append("激烈" if rms > 0.12 else ("轻柔" if rms < 0.05 else "适中"))
        spec = np.abs(np.fft.rfft(seg[: sr * 10] * np.hanning(min(len(seg), sr * 10))))
        freqs = np.fft.rfftfreq(min(len(seg), sr * 10), 1 / sr)
        centroid = float((spec * freqs).sum() / (spec.sum() + 1e-9))
        tags.append("明亮" if centroid > 2200 else ("温暖" if centroid < 1200 else "均衡"))
    except Exception:
        pass
    if tempo:
        tags.append("慢板" if tempo < 90 else ("快速" if tempo > 135 else "中速"))
    if key:
        tags.append("忧郁" if ("minor" in key or key.endswith(":m")) else "明朗")
    return tags


def import_item(params: dict, emit) -> dict:
    src = params["path"]
    if not Path(src).exists():
        raise ValueError(f"file not found: {src}")
    db = SessionLocal()
    item = None
    try:
        item_id = uid("lib")
        ext = Path(src).suffix.lower() or ".mp3"
        dest = settings.data_dir / "library" / f"{item_id}{ext}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        emit(stage="copy", detail="copying into library")
        shutil.copy2(src, dest)

        result = analyze_file(str(dest), emit)

        embedding_path = settings.data_dir / "library" / f"{item_id}.emb.npy"
        np.save(embedding_path, result["embedding"])
        segments = segment_structure(result["frames_25hz"])

        item = LibraryItem(
            id=item_id,
            path=str(dest),
            title=params.get("title") or Path(src).stem,
            artist=params.get("artist") or "",
            duration=result["duration"],
            structure_json={"segments": segments},
            embedding_path=str(embedding_path),
            tags_json=compute_tags(str(dest), tempo=None),
        )
        db.add(item)
        db.commit()

        if params.get("with_transcribe"):
            emit(stage="transcribe", detail="SheetSage2 transcription")
            tr = transcribe_file(
                str(dest), settings.data_dir / "library" / f"{item_id}_transcription", emit=emit
            )
            summary = tr.get("summary") or {}
            keys = summary.get("keys") or []
            item.transcription_dir = tr["dir"]
            if keys:
                item.key = keys[0].get("key")
            if summary.get("tempo"):
                item.tempo = summary["tempo"]
            item.tags_json = compute_tags(str(dest), item.key, item.tempo)
            db.commit()
            emit(stage="transcribe", detail="done")

        emit(stage="done", detail=f"{item.title} · {result['duration']:.0f}s")
        return {"item_id": item_id, "duration": result["duration"], "title": item.title}
    except Exception:
        if item is not None:
            db.rollback()
        raise
    finally:
        db.close()


def _load_vector(item: LibraryItem) -> np.ndarray | None:
    if not item.embedding_path or not Path(item.embedding_path).exists():
        return None
    v = np.load(item.embedding_path)
    n = np.linalg.norm(v)
    return v / n if n > 0 else None


def similar(item_id: str, k: int = 8) -> list[dict]:
    db = SessionLocal()
    try:
        items = db.query(LibraryItem).all()
        by_id = {i.id: i for i in items}
        base = by_id.get(item_id)
        if base is None:
            raise ValueError("item not found")
        base_v = _load_vector(base)
        if base_v is None:
            raise ValueError("item has no embedding yet")
        scored = []
        for it in items:
            if it.id == item_id:
                continue
            v = _load_vector(it)
            if v is None:
                continue
            scored.append((float(base_v @ v), it))
        scored.sort(key=lambda x: -x[0])
        return [_item_out(it, similarity=s) for s, it in scored[:k]]
    finally:
        db.close()


def playlist(item_id: str, n: int = 10, diversity: float = 0.3) -> list[dict]:
    """Seed + greedy MMR-style selection: relevance to seed with diversity penalty."""
    db = SessionLocal()
    try:
        items = {i.id: i for i in db.query(LibraryItem).all()}
        base = items.get(item_id)
        if base is None:
            raise ValueError("item not found")
        base_v = _load_vector(base)
        if base_v is None:
            raise ValueError("seed item has no embedding yet")
        candidates = []
        for it in items.values():
            if it.id == item_id:
                continue
            v = _load_vector(it)
            if v is None:
                continue
            candidates.append((it, v, float(base_v @ v)))
        chosen, chosen_vecs = [], []
        pool = sorted(candidates, key=lambda x: -x[2])
        while pool and len(chosen) < n:
            best, best_score = None, -1e9
            for it, v, rel in pool:
                div = max((float(v @ cv) for cv in chosen_vecs), default=0.0)
                score = (1 - diversity) * rel - diversity * div
                if score > best_score:
                    best, best_score = (it, v, rel), score
            chosen.append(best)
            chosen_vecs.append(best[1])
            pool = [p for p in pool if p[0].id != best[0].id]
        return [_item_out(it, similarity=s) for it, _, s in chosen]
    finally:
        db.close()


def _item_out(it: LibraryItem, similarity: float | None = None) -> dict:
    out = {
        "id": it.id,
        "title": it.title,
        "artist": it.artist,
        "duration": it.duration,
        "key": it.key,
        "tempo": it.tempo,
        "structure": (it.structure_json or {}).get("segments", []),
        "has_transcription": bool(it.transcription_dir),
        "tags": it.tags_json or [],
        "audio_url": "/audio/" + os.path.relpath(it.path, settings.data_dir),
        "created_at": it.created_at,
    }
    if similarity is not None:
        out["similarity"] = round(similarity, 4)
    return out
