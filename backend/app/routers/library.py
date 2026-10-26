import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import queue
from ..core.config import settings
from ..core.db import SessionLocal
from ..models.tables import LibraryItem
from ..services import library_svc
from ..services.transcribe_svc import TRANSCRIPTION_FILES

router = APIRouter(prefix="/api/library", tags=["library"])


class ImportIn(BaseModel):
    path: str
    title: str | None = None
    artist: str | None = None
    with_transcribe: bool = False


class ImportVersionIn(BaseModel):
    version_id: str
    with_transcribe: bool = False


@router.post("/import-version", status_code=202)
async def import_version(req: ImportVersionIn):
    from pathlib import Path

    from ..models.tables import Project, Version

    db = SessionLocal()
    try:
        version = db.get(Version, req.version_id)
        if version is None:
            raise HTTPException(404, "version not found")
        if not version.audio_path or not Path(version.audio_path).exists():
            raise HTTPException(400, "version has no rendered audio")
        project = db.get(Project, version.project_id)
        title = project.title if project else Path(version.audio_path).stem
    finally:
        db.close()
    job = queue.submit(
        "library_import",
        {"path": version.audio_path, "title": title, "with_transcribe": req.with_transcribe},
    )
    return {"job_id": job.id}


class PlaylistIn(BaseModel):
    item_id: str
    n: int = 10
    diversity: float = 0.3


@router.post("/import", status_code=202)
async def import_item(req: ImportIn):
    job = queue.submit(
        "library_import",
        {
            "path": req.path,
            "title": req.title,
            "artist": req.artist,
            "with_transcribe": req.with_transcribe,
        },
    )
    return {"job_id": job.id}


@router.get("")
def list_items():
    db = SessionLocal()
    try:
        rows = db.query(LibraryItem).order_by(LibraryItem.created_at.desc()).all()
        return [library_svc._item_out(it) for it in rows]
    finally:
        db.close()


@router.get("/{item_id}")
def get_item(item_id: str):
    db = SessionLocal()
    try:
        it = db.get(LibraryItem, item_id)
        if it is None:
            raise HTTPException(404)
        out = library_svc._item_out(it)
        if it.transcription_dir:
            files = {}
            for name in TRANSCRIPTION_FILES:
                p = Path(it.transcription_dir) / name
                if p.exists():
                    files[name] = "/audio/" + str(p.relative_to(settings.data_dir))
            out["transcription_files"] = files
        return out
    finally:
        db.close()


@router.get("/{item_id}/similar")
def similar_items(item_id: str, k: int = 8):
    try:
        return library_svc.similar(item_id, k=k)
    except ValueError as e:
        raise HTTPException(404 if "not found" in str(e) else 400, str(e))


@router.post("/playlist")
def make_playlist(req: PlaylistIn):
    try:
        return library_svc.playlist(req.item_id, n=req.n, diversity=req.diversity)
    except ValueError as e:
        raise HTTPException(404 if "not found" in str(e) else 400, str(e))


@router.post("/dedup")
def dedup(threshold: float = 0.85):
    """Pairwise similarity report — flags likely covers/duplicates."""
    import numpy as np

    db = SessionLocal()
    try:
        items = db.query(LibraryItem).all()
        vecs = []
        for it in items:
            v = library_svc._load_vector(it)
            if v is not None:
                vecs.append((it, v))
        pairs = []
        for i in range(len(vecs)):
            for j in range(i + 1, len(vecs)):
                sim = float(vecs[i][1] @ vecs[j][1])
                if sim >= threshold:
                    pairs.append({
                        "a": library_svc._item_out(vecs[i][0]),
                        "b": library_svc._item_out(vecs[j][0]),
                        "similarity": round(sim, 4),
                    })
        pairs.sort(key=lambda x: -x["similarity"])
        return {"threshold": threshold, "compared": len(vecs), "pairs": pairs}
    finally:
        db.close()


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: str):
    db = SessionLocal()
    try:
        it = db.get(LibraryItem, item_id)
        if it is None:
            raise HTTPException(404)
        for p in (it.path, it.embedding_path, it.transcription_dir):
            path = Path(p) if p else None
            if path is None:
                continue
            if path.is_file():
                path.unlink(missing_ok=True)
            elif path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
        db.delete(it)
        db.commit()
    finally:
        db.close()
