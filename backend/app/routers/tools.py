"""Audio upload + analysis tools (transcribe / stems)."""

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..services import queue
from ..core.config import settings

router = APIRouter(prefix="/api", tags=["tools"])

ALLOWED_EXTS = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".opus", ".aac", ".wma"}


@router.post("/upload")
def upload(file: UploadFile = File(...)):
    # sync def: FastAPI runs it in the threadpool, so a large copy doesn't
    # block the event loop (SSE heartbeats etc.)
    ext = Path(file.filename or "audio.mp3").suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, f"unsupported file type: {ext}")
    file_id = uuid.uuid4().hex[:16]
    dest = settings.data_dir / "uploads" / f"{file_id}{ext}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {
        "path": str(dest),
        "filename": file.filename,
        "size": dest.stat().st_size,
        "url": "/audio/" + str(dest.relative_to(settings.data_dir)),
    }


class TranscribeIn(BaseModel):
    path: str | None = None
    version_id: str | None = None
    melody_only: bool = False


class StemsIn(BaseModel):
    path: str | None = None
    version_id: str | None = None


@router.post("/transcribe", status_code=202)
async def transcribe(req: TranscribeIn):
    if not req.path and not req.version_id:
        raise HTTPException(400, "path or version_id required")
    job = queue.submit(
        "transcribe",
        {"path": req.path, "version_id": req.version_id, "melody_only": req.melody_only},
    )
    return {"job_id": job.id}


@router.post("/stems", status_code=202)
async def stems(req: StemsIn):
    if not req.path and not req.version_id:
        raise HTTPException(400, "path or version_id required")
    job = queue.submit("stems", {"path": req.path, "version_id": req.version_id})
    return {"job_id": job.id}


class LyricsIn(BaseModel):
    path: str | None = None
    version_id: str | None = None
    language: str | None = None


class AnalyzeIn(BaseModel):
    path: str | None = None
    version_id: str | None = None


@router.post("/lyrics", status_code=202)
async def lyrics(req: LyricsIn):
    if not req.path and not req.version_id:
        raise HTTPException(400, "path or version_id required")
    job = queue.submit(
        "lyrics",
        {"path": req.path, "version_id": req.version_id, "language": req.language},
    )
    return {"job_id": job.id}


@router.post("/analyze", status_code=202)
async def analyze(req: AnalyzeIn):
    if not req.path and not req.version_id:
        raise HTTPException(400, "path or version_id required")
    job = queue.submit("analyze", {"path": req.path, "version_id": req.version_id})
    return {"job_id": job.id}
