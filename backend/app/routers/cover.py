from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import queue

router = APIRouter(prefix="/api/cover", tags=["cover"])


class PrepareIn(BaseModel):
    path: str


@router.post("/prepare", status_code=202)
async def prepare(req: PrepareIn):
    if not req.path:
        raise HTTPException(400, "path required")
    job = queue.submit("cover_prepare", {"path": req.path})
    return {"job_id": job.id}
