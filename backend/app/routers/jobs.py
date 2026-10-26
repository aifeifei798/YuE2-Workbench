import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..core.db import SessionLocal
from ..models.tables import Job
from ..services import queue

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _job_out(job: Job) -> dict:
    return {
        "id": job.id,
        "type": job.type,
        "status": job.status,
        "params": job.params,
        "result": job.result,
        "error": job.error,
        "project_id": job.project_id,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


@router.get("")
def list_jobs(limit: int = 50):
    db = SessionLocal()
    try:
        rows = db.query(Job).order_by(Job.created_at.desc()).limit(limit).all()
        return [_job_out(j) for j in rows]
    finally:
        db.close()


@router.get("/{job_id}")
def get_job(job_id: str):
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            raise HTTPException(404)
        return _job_out(job)
    finally:
        db.close()


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: str):
    if not queue.cancel(job_id):
        raise HTTPException(404)
    return {"ok": True}


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: str):
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            raise HTTPException(404)
        if job.status not in ("done", "failed", "cancelled"):
            raise HTTPException(409, "cancel the job before deleting it")
        db.delete(job)
        db.commit()
        queue.runtimes.pop(job_id, None)
    finally:
        db.close()


@router.get("/{job_id}/events")
async def job_events(job_id: str):
    rt = queue.runtimes.get(job_id)
    if rt is None:
        raise HTTPException(404)
    q: asyncio.Queue = asyncio.Queue()
    rt.subscribers.add(q)

    async def stream():
        try:
            for ev in list(rt.events):
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                if ev.get("status") in queue.TERMINAL:
                    return
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                if ev.get("status") in queue.TERMINAL:
                    return
        finally:
            rt.subscribers.discard(q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
