"""Blind A/B listening tests: random pairs, human votes, ELO taste ranking."""

import random

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func

from ..core.db import SessionLocal
from ..models.tables import BlindTest, Version, uid

router = APIRouter(prefix="/api/blind", tags=["blind"])

ELO_START = 1000.0
ELO_K = 32.0


def _playable(db) -> list[Version]:
    return (
        db.query(Version)
        .filter(Version.status == "done", Version.audio_path.isnot(None))
        .all()
    )


@router.get("/pair")
def next_pair():
    """Two random distinct versions, positions shuffled."""
    db = SessionLocal()
    try:
        pool = _playable(db)
        if len(pool) < 2:
            raise HTTPException(409, "至少需要两个已完成的版本才能盲测")
        a, b = random.sample(pool, 2)
        return {
            "a": {"version_id": a.id, "url": f"/audio/projects/{a.project_id}/v{a.v:02d}/song.flac"},
            "b": {"version_id": b.id, "url": f"/audio/projects/{b.project_id}/v{b.v:02d}/song.flac"},
        }
    finally:
        db.close()


class VoteIn(BaseModel):
    a: str
    b: str
    winner: str  # 'a' | 'b' | 'tie'


@router.post("/vote")
def vote(req: VoteIn):
    if req.winner not in ("a", "b", "tie"):
        raise HTTPException(400, "winner must be a|b|tie")
    if req.a == req.b:
        raise HTTPException(400, "a and b must differ")
    db = SessionLocal()
    try:
        for vid in (req.a, req.b):
            if db.get(Version, vid) is None:
                raise HTTPException(404, f"version {vid} not found")
        row = BlindTest(id=uid("bt"), a_version_id=req.a, b_version_id=req.b, winner=req.winner)
        db.add(row)
        db.commit()
        return {"ok": True, "id": row.id}
    finally:
        db.close()


@router.get("/stats")
def stats():
    """ELO over all votes in chronological order + W/L/T per version."""
    db = SessionLocal()
    try:
        rows = (
            db.query(BlindTest)
            .order_by(BlindTest.created_at.asc())
            .all()
        )
        elo: dict[str, float] = {}

        def expected(ra: float, rb: float) -> float:
            return 1.0 / (1.0 + 10 ** ((rb - ra) / 400.0))

        def ensure(vid: str) -> float:
            return elo.setdefault(vid, ELO_START)

        for r in rows:
            ra, rb = ensure(r.a_version_id), ensure(r.b_version_id)
            ea = expected(ra, rb)
            sa = 1.0 if r.winner == "a" else 0.0 if r.winner == "b" else 0.5
            elo[r.a_version_id] = ra + ELO_K * (sa - ea)
            elo[r.b_version_id] = rb + ELO_K * ((1.0 - sa) - (1.0 - ea))

        counts: dict[str, dict[str, int]] = {}
        for r in rows:
            for vid, is_winner in (
                (r.a_version_id, r.winner == "a"),
                (r.b_version_id, r.winner == "b"),
            ):
                c = counts.setdefault(vid, {"wins": 0, "losses": 0, "ties": 0})
                if r.winner == "tie":
                    c["ties"] += 1
                elif is_winner:
                    c["wins"] += 1
                else:
                    c["losses"] += 1

        playable = {v.id: v for v in _playable(db)}
        out = []
        for vid, e in elo.items():
            v = playable.get(vid)
            if v is None:
                continue  # version deleted since
            c = counts.get(vid, {"wins": 0, "losses": 0, "ties": 0})
            out.append({
                "version_id": vid,
                "project_id": v.project_id,
                "v": v.v,
                "note": v.note,
                "source": v.source,
                "elo": round(e, 1),
                **c,
            })
        out.sort(key=lambda x: -x["elo"])
        total = db.query(func.count(BlindTest.id)).scalar()
        return {"votes": total or 0, "rows": out}
    finally:
        db.close()
