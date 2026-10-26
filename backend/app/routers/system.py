from fastapi import APIRouter, HTTPException

from ..services import queue
from ..services.models_mgr import models

router = APIRouter(prefix="/api", tags=["system"])

MODEL_INFO = [
    {"name": "yue2", "label": "YuE2-3B 生成管线", "repo": "m-a-p/YuE2-3B", "vram": "~11 GB"},
    {"name": "vae", "label": "YuE2-Vae 解码器(试听/挖补)", "repo": "m-a-p/YuE2-Vae", "vram": "~4 GB"},
    {"name": "sheetsage2", "label": "SheetSage2 扒谱", "repo": "m-a-p/SheetSage2", "vram": "~2 GB"},
    {"name": "mert", "label": "MERT-FullSong 特征", "repo": "m-a-p/MERT-v2-FullSong", "vram": "~2 GB"},
    {"name": "htdemucs", "label": "HTDemucs 分轨", "repo": "adefossez/HTDemucs-ft", "vram": "~2 GB"},
    {"name": "asr", "label": "Qwen3-ASR 歌词识别", "repo": "Qwen/Qwen3-ASR-0.6B", "vram": "~2 GB"},
    {"name": "agent", "label": "Qwen3-0.6B 改谱 Agent", "repo": "Qwen/Qwen3-0.6B", "vram": "~1.5 GB"},
]


@router.get("/healthz")
def healthz():
    return {
        "status": "ok",
        "models": models.status(),
        "queue": {"depth": queue.queue_depth()},
    }


@router.get("/models")
def list_models():
    status = models.status()
    out = []
    for m in MODEL_INFO:
        s = status.get(m["name"], {})
        out.append({**m, "loaded": s.get("loaded", False)})
    return out


@router.post("/models/{name}/load", status_code=202)
async def load_model(name: str):
    if name not in {m["name"] for m in MODEL_INFO}:
        raise HTTPException(404, f"unknown model: {name}")
    job = queue.submit("model_load", {"name": name})
    return {"job_id": job.id}


@router.post("/models/{name}/unload")
def unload_model(name: str):
    try:
        released = models.unload(name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"unloaded": released}
