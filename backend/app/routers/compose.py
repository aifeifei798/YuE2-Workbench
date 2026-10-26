import random
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..core.config import settings
from ..core.db import SessionLocal
from ..models.tables import Project, uid
from ..services import queue

router = APIRouter(prefix="/api", tags=["compose"])


class GenerateIn(BaseModel):
    project_id: str | None = None
    title: str | None = None
    style: str
    lyrics: str
    cot: Literal["full", "melody", "off"] = "full"
    seed: int | None = None
    cfg_scale: float | None = None
    abc: str | None = None
    note: str = ""
    parent_version_id: str | None = None
    source: str = "generated"


class PlanIn(BaseModel):
    style: str
    lyrics: str
    cot: Literal["full", "melody", "off"] = "full"
    seed: int | None = None
    cfg_scale: float | None = None


def _guard_queue() -> None:
    if queue.queue_depth() >= settings.max_queue:
        raise HTTPException(429, "queue is full, try again later")


@router.post("/generate", status_code=202)
async def generate(req: GenerateIn):
    _guard_queue()
    db = SessionLocal()
    try:
        if req.project_id:
            project = db.get(Project, req.project_id)
            if project is None:
                raise HTTPException(404, "project not found")
        else:
            title = (req.title or "").strip()
            if not title:
                raise HTTPException(400, "歌名必填")
            project = Project(
                id=uid("p"),
                title=title,
                style=req.style,
                lyrics=req.lyrics,
                cot=req.cot,
                seed=req.seed,
            )
            db.add(project)
            db.commit()
        params = {
            "project_id": project.id,
            "style": req.style,
            "lyrics": req.lyrics,
            "cot": req.cot,
            "seed": req.seed,
            "cfg_scale": req.cfg_scale,
            "abc": req.abc,
            "note": req.note,
            "parent_version_id": req.parent_version_id,
            "source": req.source,
        }
        job = queue.submit("generate", params, project_id=project.id)
        return {"job_id": job.id, "project_id": project.id}
    finally:
        db.close()


@router.post("/plan", status_code=202)
async def plan(req: PlanIn):
    _guard_queue()
    params = {
        "style": req.style,
        "lyrics": req.lyrics,
        "cot": req.cot,
        "seed": req.seed,
        "cfg_scale": req.cfg_scale,
    }
    job = queue.submit("plan", params)
    return {"job_id": job.id}


class SweepIn(BaseModel):
    project_id: str | None = None
    title: str | None = None
    style: str
    lyrics: str
    cot: Literal["full", "melody", "off"] = "full"
    seeds: list[int] | None = None
    n: int = 3
    cfg_scale: float | None = None


@router.post("/generate/sweep", status_code=202)
async def generate_sweep(req: SweepIn):
    """Seed sweep: queue the same lyrics/style as N serial generate jobs, one per seed."""
    _guard_queue()
    seeds = list(req.seeds or [])
    if not seeds:
        if not 2 <= req.n <= 5:
            raise HTTPException(400, "n must be 2..5")
        seeds = random.sample(range(1, 2**31), req.n)
    if not 2 <= len(seeds) <= 5:
        raise HTTPException(400, "2..5 seeds per sweep")
    if len(set(seeds)) != len(seeds):
        raise HTTPException(400, "duplicate seeds")
    db = SessionLocal()
    try:
        if req.project_id:
            project = db.get(Project, req.project_id)
            if project is None:
                raise HTTPException(404, "project not found")
        else:
            import time

            title = (req.title or "").strip() or f"种子扫描 {time.strftime('%m-%d %H:%M')}"
            project = Project(
                id=uid("p"),
                title=title,
                style=req.style,
                lyrics=req.lyrics,
                cot=req.cot,
                seed=None,
            )
            db.add(project)
            db.commit()
        job_ids = []
        for i, seed in enumerate(seeds):
            params = {
                "project_id": project.id,
                "style": req.style,
                "lyrics": req.lyrics,
                "cot": req.cot,
                "seed": seed,
                "cfg_scale": req.cfg_scale,
                "abc": None,
                "note": f"种子扫描 #{i + 1}",
                "parent_version_id": None,
                "source": "sweep",
            }
            job = queue.submit("generate", params, project_id=project.id)
            job_ids.append(job.id)
        return {"job_ids": job_ids, "seeds": seeds, "project_id": project.id}
    finally:
        db.close()
