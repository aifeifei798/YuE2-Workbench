from fastapi import APIRouter

from ..services import queue
from ..services.models_mgr import models

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/healthz")
def healthz():
    return {
        "status": "ok",
        "models": models.status(),
        "queue": {"depth": queue.queue_depth()},
    }
