"""Audio upload + analysis tools (transcribe / stems) + 上传素材统一管理."""

import shutil
import subprocess
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..services import queue
from ..core.config import settings
from ..core.db import SessionLocal
from ..models.tables import Project, UploadAsset, Version, uid
from ..services.master_svc import src_cache_key

router = APIRouter(prefix="/api", tags=["tools"])

# 母带/分轨都要能吃 YouTube/Suno 下载的容器格式(.webm/.mp4),解码统一走 ffmpeg
ALLOWED_EXTS = {
    ".mp3", ".wav", ".flac", ".m4a", ".m4b", ".ogg", ".oga", ".opus", ".aac", ".wma",
    ".webm", ".mp4", ".aiff", ".aif",
}


def _probe_duration(path: Path) -> float | None:
    """ffprobe 读时长(对所有容器格式都准);失败不挡上传。"""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            check=True, capture_output=True, text=True, timeout=30,
        ).stdout.strip()
        return round(float(out), 2)
    except Exception:
        return None


def _transcription_files(key: str) -> list[Path]:
    """扒谱产物:ABC/MIDI/标注,zip 本身不算。"""
    tdir = settings.data_dir / "transcriptions" / f"t_{key}"
    if not tdir.exists():
        return []
    return [p for p in tdir.iterdir() if p.is_file() and p.suffix != ".zip"]


def _upload_out(u: UploadAsset, db) -> dict:
    url = None
    try:
        url = "/audio/" + str(Path(u.path).relative_to(settings.data_dir))
    except ValueError:
        pass
    key = src_cache_key(u.path)
    derived = u.derived_json or {}

    covers = []
    for pid in derived.get("cover_project_ids", [])[-3:]:
        p = db.get(Project, pid)
        if p is not None:
            covers.append({"project_id": p.id, "title": p.title})
    masters = []
    for vid in derived.get("master_version_ids", [])[-3:]:
        v = db.get(Version, vid)
        if v is not None and v.status == "done" and v.audio_path and Path(v.audio_path).exists():
            masters.append({
                "version_id": v.id,
                "project_id": v.project_id,
                "v": v.v,
                "note": v.note,
                "audio_url": "/audio/" + str(Path(v.audio_path).relative_to(settings.data_dir)),
            })

    return {
        "id": u.id,
        "filename": u.filename,
        "path": u.path,
        "size": u.size,
        "duration": u.duration,
        "ext": u.ext,
        "note": u.note,
        "created_at": u.created_at,
        "url": url,
        "exists": Path(u.path).exists(),
        "has_stems": (settings.data_dir / "stems" / f"s_{key}" / "vocals.flac").exists(),
        "has_transcription": bool(_transcription_files(key)),
        "covers": covers,
        "masters": masters,
    }


def _adopt_orphans() -> None:
    """把建库之前堆在 data/uploads 里的无名文件收编进表(名字只能是 hex 名)。"""
    updir = settings.data_dir / "uploads"
    if not updir.exists():
        return
    db = SessionLocal()
    try:
        known = {p.path for p in db.query(UploadAsset.path)}
        for f in sorted(updir.iterdir()):
            if not f.is_file() or f.name.startswith("."):
                continue
            if str(f) in known:
                continue
            db.add(UploadAsset(
                id=uid("u"),
                filename=f.name,
                path=str(f),
                size=f.stat().st_size,
                duration=_probe_duration(f),
                ext=f.suffix.lower(),
                created_at=f.stat().st_mtime,
            ))
        db.commit()
    finally:
        db.close()


@router.get("/uploads")
def list_uploads():
    db = SessionLocal()
    try:
        _adopt_orphans()
        rows = db.query(UploadAsset).order_by(UploadAsset.created_at.desc()).all()
        return [_upload_out(u, db) for u in rows]
    finally:
        db.close()


@router.delete("/uploads/{upload_id}", status_code=204)
def delete_upload(upload_id: str):
    """删素材:连带按路径键控的分轨/扒谱缓存目录,避免留下查不到主的无派生物。"""
    db = SessionLocal()
    try:
        u = db.get(UploadAsset, upload_id)
        if u is None:
            raise HTTPException(404)
        p = Path(u.path)
        # 只允许删 data/uploads 里的东西,防误伤;缓存键要在 unlink 前算(mtime/size 是键的一部分)
        if p.exists() and str(p.resolve()).startswith(str((settings.data_dir / "uploads").resolve())):
            key = src_cache_key(u.path)
            shutil.rmtree(settings.data_dir / "stems" / f"s_{key}", ignore_errors=True)
            shutil.rmtree(settings.data_dir / "transcriptions" / f"t_{key}", ignore_errors=True)
            p.unlink()
        db.delete(u)
        db.commit()
    finally:
        db.close()


def _get_asset(upload_id: str) -> UploadAsset:
    db = SessionLocal()
    try:
        u = db.get(UploadAsset, upload_id)
        if u is None:
            raise HTTPException(404, "upload not found")
        return u
    finally:
        db.close()


def _zip_dir(src_dir: Path, out_name: str) -> Path:
    """把目录里已有的产物打包(缓存在目录内,产物更新后自动重打)。"""
    out = src_dir / out_name
    parts = [p for p in src_dir.iterdir() if p.is_file() and p.name != out_name] if src_dir.exists() else []
    if not parts:
        raise HTTPException(404, "no derived artifacts")
    if not out.exists() or out.stat().st_mtime < max(p.stat().st_mtime for p in parts):
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
            for p in parts:
                zf.write(p, p.name)
    return out


@router.get("/uploads/{upload_id}/export/stems.zip")
def upload_stems_zip(upload_id: str):
    u = _get_asset(upload_id)
    sdir = settings.data_dir / "stems" / f"s_{src_cache_key(u.path)}"
    if not (sdir / "vocals.flac").exists():
        raise HTTPException(404, "这个素材还没有分轨")
    return FileResponse(_zip_dir(sdir, "stems.zip"), media_type="application/zip",
                        filename=f"{Path(u.filename).stem}_分轨.zip")


@router.get("/uploads/{upload_id}/export/transcription.zip")
def upload_transcription_zip(upload_id: str):
    u = _get_asset(upload_id)
    tdir = settings.data_dir / "transcriptions" / f"t_{src_cache_key(u.path)}"
    if not _transcription_files(src_cache_key(u.path)):
        raise HTTPException(404, "这个素材还没有扒谱")
    return FileResponse(_zip_dir(tdir, "transcription.zip"), media_type="application/zip",
                        filename=f"{Path(u.filename).stem}_扒谱.zip")


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
    db = SessionLocal()
    try:
        row = UploadAsset(
            id=uid("u"),
            filename=file.filename or dest.name,
            path=str(dest),
            size=dest.stat().st_size,
            duration=_probe_duration(dest),
            ext=ext,
        )
        db.add(row)
        db.commit()
        return _upload_out(row, db)
    finally:
        db.close()


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
