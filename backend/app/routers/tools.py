"""Audio upload + analysis tools (transcribe / stems) + 上传素材统一管理."""

import json
import re
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
from ..models.tables import Job, Project, UploadAsset, Version, uid
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


def _transcription_runs(key: str) -> list[Path]:
    """按时间倒序的扒谱 run 目录。

    首次访问会把旧版平铺在 t_<key> 顶层的文件收进一个 run(一次性的自愈迁移),
    之后 has_transcription / zip / 版本列表都以 run 目录为准。
    """
    tdir = settings.data_dir / "transcriptions" / f"t_{key}"
    if not tdir.exists():
        return []
    legacy = [p for p in tdir.iterdir() if not p.name.startswith("r_") and p.suffix != ".zip"]
    if legacy:
        existing = sorted(
            (d for d in tdir.iterdir() if d.is_dir() and d.name.startswith("r_")),
            key=lambda d: d.stat().st_mtime,
        )
        # 部分迁移过的目录残余收进最早的 run,别拆成两个版本
        rd = existing[0] if existing else tdir / f"r_{int(tdir.stat().st_mtime) * 1000}"
        rd.mkdir(exist_ok=True)
        for p in legacy:
            p.rename(rd / p.name)
    return sorted(
        (d for d in tdir.iterdir() if d.is_dir() and d.name.startswith("r_") and any(d.iterdir())),
        key=lambda d: d.stat().st_mtime,
        reverse=True,
    )


def _transcription_files(key: str) -> list[Path]:
    """最新一次扒谱的全部产物文件。"""
    runs = _transcription_runs(key)
    if not runs:
        return []
    return [p for p in runs[0].iterdir() if p.is_file() and p.suffix != ".zip"]


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


@router.get("/uploads/{upload_id}/stems")
def upload_stems(upload_id: str):
    """素材的已有分轨(与版本分轨端点同构)。"""
    u = _get_asset(upload_id)
    sdir = settings.data_dir / "stems" / f"s_{src_cache_key(u.path)}"
    out = {}
    for name in ("vocals", "drums", "bass", "other"):
        p = sdir / f"{name}.flac"
        if p.exists():
            out[name] = "/audio/" + str(p.relative_to(settings.data_dir))
    if "vocals" not in out:
        raise HTTPException(404, "这个素材还没有分轨")
    return {"stems": out}


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
    # 取最新一个"有文件"的 run(纯目录 run 打不出包)
    for rd in _transcription_runs(src_cache_key(u.path)):
        if any(p.is_file() for p in rd.iterdir()):
            return FileResponse(_zip_dir(rd, "transcription.zip"), media_type="application/zip",
                                filename=f"{Path(u.filename).stem}_扒谱.zip")
    raise HTTPException(404, "这个素材还没有扒谱")


def _run_melody_only(rd: Path, names: set[str]) -> bool:
    """优先读 run.json;旧 run 没有就退回文件启发式。"""
    meta_path = rd / "run.json"
    if meta_path.exists():
        try:
            return bool(json.loads(meta_path.read_text(encoding="utf-8")).get("melody_only"))
        except Exception:
            pass
    return not names & {"chords.mid", "chord.lab"}


@router.get("/uploads/{upload_id}/transcriptions")
def upload_transcription_runs(upload_id: str):
    """历次扒谱版本(新→旧),供前端选版本恢复,不用重跑。"""
    u = _get_asset(upload_id)
    out = []
    for rd in _transcription_runs(src_cache_key(u.path)):
        names = {p.name for p in rd.iterdir() if p.is_file()}
        out.append({
            "run_id": rd.name,
            "created_at": rd.stat().st_mtime,
            "has_score": "score.abc" in names,
            "melody_only": _run_melody_only(rd, names),
            "n_files": len(names),
        })
    return out


@router.get("/uploads/{upload_id}/transcriptions/{run_id}")
def upload_transcription_run(upload_id: str, run_id: str):
    """重建某一次扒谱的完整结果(abc + files + summary),与任务返回同构。"""
    if not re.fullmatch(r"r_[0-9]+", run_id):
        raise HTTPException(400, "bad run_id")
    u = _get_asset(upload_id)
    rd = settings.data_dir / "transcriptions" / f"t_{src_cache_key(u.path)}" / run_id
    if not rd.is_dir():
        raise HTTPException(404, "run not found")
    from ..services.transcribe_svc import summarize

    abc = ""
    abc_path = rd / "score.abc"
    if abc_path.exists():
        abc = abc_path.read_text(encoding="utf-8")
    events = []
    events_path = rd / "events.json"
    if events_path.exists():
        try:
            data = json.loads(events_path.read_text(encoding="utf-8"))
            events = data.get("events", []) if isinstance(data, dict) else data
        except Exception:
            events = []
    files = {}
    for p in sorted(rd.iterdir()):
        if p.is_file() and p.suffix != ".zip":
            files[p.name] = "/audio/" + str(p.relative_to(settings.data_dir))
    names = set(files)
    return {
        "abc": abc,
        "melody_only": _run_melody_only(rd, names),
        "files": files,
        "summary": summarize(events),
    }


@router.delete("/uploads/{upload_id}/transcriptions/{run_id}", status_code=204)
def delete_transcription_run(upload_id: str, run_id: str):
    """删除某次扒谱版本,不提供找回。"""
    if not re.fullmatch(r"r_[0-9]+", run_id):
        raise HTTPException(400, "bad run_id")
    u = _get_asset(upload_id)
    rd = settings.data_dir / "transcriptions" / f"t_{src_cache_key(u.path)}" / run_id
    if not rd.is_dir():
        raise HTTPException(404, "run not found")
    shutil.rmtree(rd)
    if rd.parent.is_dir() and not any(rd.parent.iterdir()):
        rd.parent.rmdir()


@router.get("/uploads/{upload_id}/covers")
def upload_covers(upload_id: str):
    """历次翻唱版本:项目仍在的才返回;result 是当时的 prepare 结果,可整份恢复。"""
    u = _get_asset(upload_id)
    ids = (u.derived_json or {}).get("cover_project_ids", [])[-10:]
    if not ids:
        return []
    db = SessionLocal()
    try:
        job_map = {}
        for j in (
            db.query(Job)
            .filter(Job.type == "cover_prepare", Job.status == "done")
            .order_by(Job.created_at.desc())
            .all()
        ):
            pid = (j.result or {}).get("project_id")
            if pid and pid not in job_map:
                job_map[pid] = j.result
        out = []
        for pid in ids:
            p = db.get(Project, pid)
            if p is None:
                continue
            out.append({
                "project_id": pid,
                "title": p.title,
                "created_at": p.created_at,
                "result": job_map.get(pid),
            })
        out.sort(key=lambda x: x["created_at"], reverse=True)
        return out
    finally:
        db.close()


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
