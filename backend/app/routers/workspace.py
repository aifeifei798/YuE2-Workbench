"""Workspace endpoints: fast region audition + punch jobs."""

from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import queue
from ..core.config import settings
from ..core.db import SessionLocal
from ..models.tables import Version
from ..services import punch_svc

router = APIRouter(prefix="/api", tags=["workspace"])


class AuditionIn(BaseModel):
    version_id: str
    region: tuple[float, float]


class PunchIn(BaseModel):
    version_id: str
    region: tuple[float, float]
    candidates: int = 3
    seeds: list[int] | None = None
    snap_to_beats: bool = True


class PunchApplyIn(BaseModel):
    version_id: str
    punch_id: str
    idx: int
    note: str | None = None


def _load_version(version_id: str) -> Version:
    db = SessionLocal()
    try:
        version = db.get(Version, version_id)
        if version is None:
            raise HTTPException(404, "version not found")
        if not version.latents_path or not Path(version.latents_path).exists():
            raise HTTPException(400, "version has no latents")
        return version
    finally:
        db.close()


@router.post("/audition")
def audition(req: AuditionIn):
    """Synchronous region playback: slice cached latents, decode, return URL (<1s warm)."""
    import time

    version = _load_version(req.version_id)
    latents = np.load(version.latents_path).astype(np.float32)
    T = len(latents)
    a = max(0, int(req.region[0] * punch_svc.FPS))
    b = min(T, max(a + 1, int(req.region[1] * punch_svc.FPS)))
    if b - a < 2:
        raise HTTPException(400, "region too short")
    z = latents[max(0, a - punch_svc.HALO): min(T, b + punch_svc.HALO)]
    wav = punch_svc.decode_latents(z)
    cache_dir = settings.data_dir / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    name = f"aud_{version.id}_{a}_{b}.wav"
    out = cache_dir / name
    if not out.exists():
        sf.write(out, wav, 48000, subtype="PCM_16")
    return {
        "url": "/audio/" + str(out.relative_to(settings.data_dir)),
        "region": [a / punch_svc.FPS, b / punch_svc.FPS],
        "duration": round((b - a) / punch_svc.FPS, 2),
        "decoded_at": time.time(),
    }


@router.get("/versions/{version_id}/beats")
def version_beats(version_id: str):
    version = _load_version(version_id)
    from ..services.transcribe_svc import load_beats

    beats = load_beats(version)
    if not beats["beats"] and not beats["downbeats"]:
        raise HTTPException(404, "no transcription for this version yet")
    return beats


@router.post("/generate/punch", status_code=202)
async def punch(req: PunchIn):
    _ = _load_version(req.version_id)
    job = queue.submit("punch", {
        "version_id": req.version_id,
        "region": list(req.region),
        "candidates": max(1, min(req.candidates, 8)),
        "seeds": req.seeds,
        "snap_to_beats": req.snap_to_beats,
    })
    return {"job_id": job.id}


@router.post("/punch/apply", status_code=202)
async def punch_apply(req: PunchApplyIn):
    _ = _load_version(req.version_id)
    job = queue.submit("punch_apply", {
        "version_id": req.version_id,
        "punch_id": req.punch_id,
        "idx": req.idx,
        "note": req.note,
    })
    return {"job_id": job.id}
