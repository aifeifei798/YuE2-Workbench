"""Agent score editing + evaluation endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import queue

router = APIRouter(prefix="/api", tags=["agent"])


class AgentEditIn(BaseModel):
    version_id: str
    instruction: str


class EvaluateIn(BaseModel):
    version_ids: list[str]
    labels: list[str] | None = None


@router.post("/agent/edit", status_code=202)
async def agent_edit(req: AgentEditIn):
    if not req.instruction.strip():
        raise HTTPException(400, "instruction required")
    job = queue.submit("agent_edit", {"version_id": req.version_id, "instruction": req.instruction.strip()})
    return {"job_id": job.id}


@router.post("/evaluate/batch", status_code=202)
async def evaluate_batch(limit: int = 8):
    job = queue.submit("evaluate_batch", {"limit": min(limit, 20)})
    return {"job_id": job.id}


@router.get("/leaderboard")
def leaderboard():
    from pathlib import Path

    from ..core.config import settings
    from ..core.db import SessionLocal
    from ..models.tables import Project, Version

    def score(m: dict) -> float | None:
        intel, coh, snr = m.get("intelligibility"), m.get("coherence"), m.get("vae_recon_snr_db")
        clip = (m.get("audio") or {}).get("clip_ratio")
        if intel is None or coh is None:
            return None
        s = 0.45 * intel + 0.30 * coh
        if snr is not None:
            s += 0.20 * max(0.0, min(1.0, snr / 25.0))
        if clip is not None:
            s += 0.05 * (1.0 - min(1.0, clip * 100))
        return round(s, 4)

    db = SessionLocal()
    try:
        rows = (
            db.query(Version, Project.title)
            .join(Project, Version.project_id == Project.id)
            .filter(Version.status == "done", Version.audio_path.isnot(None))
            .order_by(Version.created_at.desc())
            .all()
        )
        out = []
        for v, ptitle in rows:
            eval_path = Path(v.audio_path).parent / "eval.json"
            m = None
            if eval_path.exists():
                import json as _json

                try:
                    m = _json.loads(eval_path.read_text(encoding="utf-8"))
                except Exception:
                    m = None
            out.append({
                "version_id": v.id,
                "project_id": v.project_id,
                "project": ptitle,
                "v": v.v,
                "note": v.note,
                "source": v.source,
                "duration": v.duration,
                "metrics": (
                    {
                        "intelligibility": m.get("intelligibility"),
                        "coherence": m.get("coherence"),
                        "vae_recon_snr_db": m.get("vae_recon_snr_db"),
                        "clip_ratio": (m.get("audio") or {}).get("clip_ratio"),
                    }
                    if m
                    else None
                ),
                "score": score(m) if m else None,
            })
        out.sort(key=lambda r: -(r["score"] if r["score"] is not None else -1))
        return out
    finally:
        db.close()


@router.post("/evaluate", status_code=202)
async def evaluate(req: EvaluateIn):
    if not 1 <= len(req.version_ids) <= 4:
        raise HTTPException(400, "1..4 version_ids")
    if len(req.version_ids) == 2 and not req.labels:
        req.labels = ["A", "B"]
    job = queue.submit("evaluate", {"version_ids": req.version_ids, "labels": req.labels})
    return {"job_id": job.id}


@router.get("/agent/history")
def agent_history(version_id: str):
    from ..core.db import SessionLocal
    from ..models.tables import Version
    from ..services.agent_svc import agent_history as _hist

    db = SessionLocal()
    try:
        version = db.get(Version, version_id)
        if version is None:
            raise HTTPException(404)
        return _hist(version)
    finally:
        db.close()


@router.post("/agent/apply")
def agent_apply(req: dict):
    """Adopt a proposed score as the version's ABC draft (render via /api/generate)."""
    from ..core.db import SessionLocal
    from ..models.tables import Version
    from ..services.agent_svc import save_draft

    version_id = (req or {}).get("version_id")
    abc = (req or {}).get("abc") or ""
    if not version_id or not abc.strip():
        raise HTTPException(400, "version_id and abc required")
    db = SessionLocal()
    try:
        version = db.get(Version, version_id)
        if version is None:
            raise HTTPException(404)
        if not version.audio_path:
            raise HTTPException(400, "version has no rendered audio")
        draft = save_draft(version, abc, str((req or {}).get("note") or "agent 提案"))
        return {"saved": True, "updated_at": draft["updated_at"]}
    finally:
        db.close()


@router.post("/duel")
def duel_standlone(req: dict):
    """Metrics duel between two evaluated versions (sync, no job)."""
    import json as _json
    from pathlib import Path

    from ..core.config import settings
    from ..core.db import SessionLocal
    from ..models.tables import Version
    from ..services.eval_svc import duel

    ids = [(req or {}).get("a"), (req or {}).get("b")]
    if not all(ids):
        raise HTTPException(400, "a and b required")
    db = SessionLocal()
    try:
        metrics = {}
        titles = {}
        for vid in ids:
            v = db.get(Version, vid)
            if v is None:
                raise HTTPException(404, f"{vid} not found")
            titles[vid] = f"v{v.v} {v.note or v.source}"
            ep = Path(v.audio_path).parent / "eval.json" if v.audio_path else None
            if not ep or not ep.exists():
                raise HTTPException(409, f"{vid} 尚未评测,先跑 /api/evaluate")
            metrics[vid] = _json.loads(ep.read_text(encoding="utf-8"))
    finally:
        db.close()
    return duel(metrics[ids[0]], metrics[ids[1]], titles[ids[0]], titles[ids[1]])
