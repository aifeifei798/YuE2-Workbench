import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select

from ..core.db import SessionLocal
from ..models.tables import Job, Project, Version, uid

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectIn(BaseModel):
    title: str = ""
    style: str = ""
    lyrics: str = ""
    cot: str = "full"
    seed: int | None = None


@router.get("")
def list_projects():
    db = SessionLocal()
    try:
        counts = dict(
            db.execute(
                select(Version.project_id, func.count(Version.id)).group_by(Version.project_id)
            ).all()
        )
        rows = db.query(Project).order_by(Project.created_at.desc()).all()
        return [
            {
                "id": p.id,
                "title": p.title,
                "style": p.style,
                "cot": p.cot,
                "seed": p.seed,
                "created_at": p.created_at,
                "version_count": counts.get(p.id, 0),
            }
            for p in rows
        ]
    finally:
        db.close()


@router.post("", status_code=201)
def create_project(req: ProjectIn):
    db = SessionLocal()
    try:
        project = Project(
            id=uid("p"),
            title=req.title or "未命名",
            style=req.style,
            lyrics=req.lyrics,
            cot=req.cot,
            seed=req.seed,
            created_at=time.time(),
        )
        db.add(project)
        db.commit()
        return {"id": project.id, "title": project.title}
    finally:
        db.close()


@router.get("/{project_id}")
def get_project(project_id: str):
    db = SessionLocal()
    try:
        p = db.get(Project, project_id)
        if p is None:
            raise HTTPException(404)
        versions = (
            db.query(Version)
            .filter(Version.project_id == project_id)
            .order_by(Version.v.desc())
            .all()
        )
        jobs = (
            db.query(Job)
            .filter(Job.project_id == project_id)
            .order_by(Job.created_at.desc())
            .limit(10)
            .all()
        )
        return {
            "id": p.id,
            "title": p.title,
            "style": p.style,
            "lyrics": p.lyrics,
            "cot": p.cot,
            "seed": p.seed,
            "created_at": p.created_at,
            "versions": [_version_out(v) for v in versions],
            "recent_jobs": [
                {"id": j.id, "type": j.type, "status": j.status, "created_at": j.created_at}
                for j in jobs
            ],
        }
    finally:
        db.close()


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str):
    db = SessionLocal()
    try:
        p = db.get(Project, project_id)
        if p is None:
            raise HTTPException(404)
        db.query(Version).filter(Version.project_id == project_id).delete()
        db.delete(p)
        db.commit()
    finally:
        db.close()


def _version_out(v: Version) -> dict:
    base = f"/audio/projects/{v.project_id}/v{v.v:02d}" if v.audio_path else None
    return {
        "id": v.id,
        "v": v.v,
        "source": v.source,
        "parent_version_id": v.parent_version_id,
        "note": v.note,
        "status": v.status,
        "duration": v.duration,
        "abc": v.abc,
        "config": v.config_json,
        "created_at": v.created_at,
        "urls": (
            {
                "audio": f"{base}/song.flac",
                "abc": f"{base}/plan.abc",
                "latents": f"{base}/latents.npy",
                "semantic": f"{base}/semantic.npy",
            }
            if base
            else None
        ),
    }
