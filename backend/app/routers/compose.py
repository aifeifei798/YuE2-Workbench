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
