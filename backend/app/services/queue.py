"""In-process job queue: one heavy lane (GPU), SSE event fan-out, cooperative cancel."""

import asyncio
import threading
import time
import traceback
import uuid
from collections import deque
from dataclasses import dataclass, field

from ..core.db import SessionLocal
from ..models.tables import Job

MAX_EVENTS = 400
TERMINAL = {"done", "failed", "cancelled"}


@dataclass
class JobRuntime:
    loop: asyncio.AbstractEventLoop
    events: list = field(default_factory=list)
    subscribers: set = field(default_factory=set)
    cancel: threading.Event = field(default_factory=threading.Event)


runtimes: dict[str, JobRuntime] = {}
_pending: deque[str] = deque()
_running: str | None = None
_wakeup: asyncio.Event | None = None


def emit(job_id: str, **event) -> None:
    rt = runtimes.get(job_id)
    if rt is None:
        return
    event["t"] = time.time()
    rt.events.append(event)
    if len(rt.events) > MAX_EVENTS:
        del rt.events[: len(rt.events) - MAX_EVENTS]
    for q in list(rt.subscribers):
        rt.loop.call_soon_threadsafe(q.put_nowait, event)


def submit(type: str, params: dict, project_id: str | None = None) -> Job:
    """Must be called from the event loop thread."""
    db = SessionLocal()
    try:
        job = Job(id=f"job_{uuid.uuid4().hex[:12]}", type=type, params=params, project_id=project_id)
        db.add(job)
        db.commit()
        runtimes[job.id] = JobRuntime(loop=asyncio.get_running_loop())
        _pending.append(job.id)
        if _wakeup is not None:
            _wakeup.set()
        return job
    finally:
        db.close()


def queue_depth() -> int:
    return len(_pending) + (1 if _running else 0)


def recover_stale_jobs() -> int:
    """Mark jobs left queued/running by a previous process as failed.

    In-memory _pending/runtimes are gone after a restart, so those rows would
    otherwise stay non-terminal forever (uncancellable and undeletable).
    Call once at startup, before the worker starts.
    """
    db = SessionLocal()
    n = 0
    try:
        rows = db.query(Job).filter(Job.status.in_(("queued", "running"))).all()
        for job in rows:
            job.status = "failed"
            job.error = "interrupted by server restart"
            job.finished_at = time.time()
            n += 1
        if n:
            db.commit()
    finally:
        db.close()
    if n:
        print(f"[queue] marked {n} stale job(s) as failed after restart", flush=True)
    return n


def cancel(job_id: str) -> bool:
    rt = runtimes.get(job_id)
    if rt is None:
        return False
    rt.cancel.set()
    if job_id in _pending:
        _pending.remove(job_id)
        _finish(job_id, status="cancelled")
    return True


async def worker_loop() -> None:
    global _wakeup, _running
    _wakeup = asyncio.Event()
    while True:
        if not _pending:
            await _wakeup.wait()
            _wakeup.clear()
            continue
        job_id = _pending.popleft()
        rt = runtimes.get(job_id)
        if rt is None:
            continue
        if rt.cancel.is_set():
            _finish(job_id, status="cancelled")
            continue
        _running = job_id
        _set_status(job_id, "running")
        try:
            await asyncio.to_thread(_run_sync, job_id)
        except Exception:
            traceback.print_exc()
            _finish(job_id, status="failed", error="worker crashed")
        finally:
            _running = None


def _set_status(job_id: str, status: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        job.status = status
        if status == "running":
            job.started_at = time.time()
        db.commit()
    finally:
        db.close()
    emit(job_id, status=status)


def _finish(job_id: str, status: str, error: str | None = None) -> None:
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        job.status = status
        if error:
            job.error = error
        job.finished_at = time.time()
        db.commit()
    finally:
        db.close()
    emit(job_id, status=status, error=error)


def _run_sync(job_id: str) -> None:
    rt = runtimes.get(job_id)
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if job is None:
            return
        from .tasks import TASKS

        result = TASKS[job.type](
            job.params or {},
            emit=lambda **e: emit(job_id, **e),
            cancelled=rt.cancel.is_set,
        )
        job.result = result
        job.status = "done"
        job.finished_at = time.time()
        db.commit()
        emit(job_id, status="done", result=result)
    except InterruptedError:
        _finish(job_id, status="cancelled")
    except Exception as exc:
        traceback.print_exc()
        _finish(job_id, status="failed", error=f"{type(exc).__name__}: {exc}"[:2000])
    finally:
        db.close()
