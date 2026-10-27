"""母带端点:预设查询 + 同步区间预览(A/B 试听)+ 整曲任务。"""

import hashlib
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..core.config import settings
from ..core.db import SessionLocal
from ..models.tables import Version
from ..services import master_svc, queue

router = APIRouter(prefix="/api/master", tags=["master"])

MAX_PREVIEW_SEC = 30.0


@router.get("/presets")
def presets():
    return {
        "names": master_svc.preset_names(),
        "presets": {name: p.to_dict() for name, p in master_svc.PRESETS.items()},
        "defaults": master_svc.Params().to_dict(),
    }


def _resolve_source(version_id: str | None, path: str | None) -> tuple[str, Path | None]:
    """→ (源音频路径, 分轨目录或 None)。"""
    db = SessionLocal()
    try:
        if version_id:
            v = db.get(Version, version_id)
            if v is None:
                raise HTTPException(404, "version not found")
            if not v.audio_path or not Path(v.audio_path).exists():
                raise HTTPException(400, "version has no audio")
            return v.audio_path, Path(v.audio_path).parent / "stems"
        if path and Path(path).exists():
            return path, settings.data_dir / "stems" / f"s_{master_svc.src_cache_key(path)}"
        raise HTTPException(400, "version_id or path required")
    finally:
        db.close()


class PreviewIn(BaseModel):
    version_id: str | None = None
    path: str | None = None
    region: tuple[float, float]
    preset: str | None = None
    overrides: dict = {}


@router.post("/preview")
def preview(req: PreviewIn):
    """同步渲染一个试听窗口(≤30s),返回 原始/母带/人声/配乐 四个剪辑 URL + 统计。

    剪辑时间 0 对齐区域起点;A/B 切换保持播放位置。结果按参数哈希缓存。
    """
    src_path, stems_dir = _resolve_source(req.version_id, req.path)
    params = master_svc.resolve_params(req.preset, req.overrides)

    start, end = float(req.region[0]), float(req.region[1])
    if not (0.0 <= start < end):
        raise HTTPException(400, "invalid region")
    end = start + min(end - start, MAX_PREVIEW_SEC)

    src = master_svc.load_source(src_path, stems_dir)
    track_end = src.original.shape[0] / src.sr
    if start >= track_end:
        raise HTTPException(400, f"region beyond track end ({track_end:.1f}s)")
    end = min(end, track_end)

    out = master_svc.render(src, params, start, end)

    key_src = hashlib.sha1(
        json.dumps(
            [str(Path(src_path).resolve()), round(start, 2), round(end, 2), req.preset, params.to_dict()],
            sort_keys=True, ensure_ascii=False,
        ).encode()
    ).hexdigest()[:20]
    cache_dir = settings.data_dir / "cache" / "master"
    cache_dir.mkdir(parents=True, exist_ok=True)

    sr = src.sr
    trim = max(0, int(start * sr) - int(out["offset_sec"] * sr))
    clips = {
        "original": src.original[int(start * sr): int(end * sr)],
        "mix": out["mix"][trim:],
    }
    if out["mode"] == "stems":
        clips["vocal"] = out["vocal"][trim:]
        clips["music"] = out["music"][trim:]

    urls = {}
    for name, audio in clips.items():
        p = cache_dir / f"m_{key_src}_{name}.wav"
        if not p.exists():
            sf.write(str(p), np.asarray(audio, dtype=np.float32), sr, subtype="PCM_16")
        urls[f"{name}_url" if name != "mix" else "url"] = "/audio/" + str(p.relative_to(settings.data_dir))

    return {
        "url": urls["url"],
        "original_url": urls["original_url"],
        "vocal_url": urls.get("vocal_url"),
        "music_url": urls.get("music_url"),
        "stats": out["stats"],
        "mode": out["mode"],
        "region": [round(start, 2), round(end, 2)],
        "duration": round(end - start, 2),
        "samplerate": sr,
    }


class MasterIn(BaseModel):
    version_id: str | None = None
    path: str | None = None
    upload_id: str | None = None  # 上传素材模式:母带版本回写素材关联
    preset: str | None = None
    overrides: dict = {}
    note: str | None = None
    create_version: bool = True
    project_id: str | None = None  # 仅 path 模式下需要,用于挂新版本


@router.post("", status_code=202)
async def start_master(req: MasterIn):
    if not req.version_id and not req.path:
        raise HTTPException(400, "version_id or path required")
    if req.preset and req.preset not in master_svc.PRESETS:
        raise HTTPException(400, f"unknown preset: {req.preset}")
    if req.create_version and not req.version_id and not req.project_id:
        raise HTTPException(400, "path mode needs project_id to attach the mastered version")
    project_id = _project_of(req.version_id) if req.version_id else req.project_id
    job = queue.submit(
        "master",
        {
            "version_id": req.version_id,
            "path": req.path,
            "upload_id": req.upload_id,
            "preset": req.preset,
            "overrides": req.overrides,
            "note": req.note,
            "create_version": req.create_version,
            "project_id": project_id,
        },
        project_id=project_id,
    )
    return {"job_id": job.id}


def _project_of(version_id: str) -> str | None:
    db = SessionLocal()
    try:
        v = db.get(Version, version_id)
        return v.project_id if v else None
    finally:
        db.close()
