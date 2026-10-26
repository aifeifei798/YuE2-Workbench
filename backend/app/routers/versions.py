"""Per-version endpoints: detail, delete, fork, ABC draft, transcription, stems."""

import json
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..core.config import settings
from ..core.db import SessionLocal
from ..models.tables import Project, Version
from ..services.transcribe_svc import TRANSCRIPTION_FILES, load_beats, summarize
from .projects import _version_out

router = APIRouter(prefix="/api/versions", tags=["versions"])


def _get_version(version_id: str) -> Version:
    db = SessionLocal()
    try:
        v = db.get(Version, version_id)
        if v is None:
            raise HTTPException(404, "version not found")
        return v
    finally:
        db.close()


def _vdir(v: Version) -> Path:
    return Path(v.audio_path).parent if v.audio_path else None


def _draft(v: Version) -> dict | None:
    d = _vdir(v) / "edits" / "draft.json" if _vdir(v) else None
    if d and d.exists():
        try:
            return json.loads(d.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _detail(v: Version) -> dict:
    out = _version_out(v)
    project = SessionLocal()
    try:
        p = project.get(Project, v.project_id)
        out["project_title"] = p.title if p else ""
    finally:
        project.close()
    vdir = _vdir(v)
    out["abc_draft"] = _draft(v)
    out["has_transcription"] = bool(vdir and (vdir / "transcription" / "score.abc").exists())
    out["has_stems"] = bool(vdir and (vdir / "stems" / "vocals.flac").exists())
    out["has_beats"] = bool(vdir and (vdir / "transcription" / "beat.lab").exists())
    out["has_analysis"] = bool(vdir and (vdir / "analysis.json").exists())
    return out


@router.get("/{version_id}")
def get_version(version_id: str):
    return _detail(_get_version(version_id))


@router.delete("/{version_id}", status_code=204)
def delete_version(version_id: str):
    db = SessionLocal()
    try:
        v = db.get(Version, version_id)
        if v is None:
            raise HTTPException(404)
        vdir = _vdir(v)
        # children keep existing but lose the parent pointer
        db.query(Version).filter(Version.parent_version_id == version_id).update(
            {Version.parent_version_id: None}
        )
        db.delete(v)
        db.commit()
    finally:
        db.close()
    if vdir and vdir.exists() and str(vdir).startswith(str(settings.data_dir)):
        shutil.rmtree(vdir, ignore_errors=True)


class ForkOut(BaseModel):
    note: str | None = None


@router.post("/{version_id}/fork", status_code=200)
def fork_version(version_id: str, req: ForkOut | None = None):
    v = _get_version(version_id)
    vdir = _vdir(v)
    if not vdir or not (vdir / "song.flac").exists():
        raise HTTPException(400, "version has no artifacts to fork")
    db = SessionLocal()
    new_v = None
    ndir = None
    try:
        from ..models.tables import uid
        from ..services.tasks import VLOCK, _alloc_version_dir

        with VLOCK:
            vnum, ndir = _alloc_version_dir(db, v.project_id)
            for name in ("song.flac", "plan.abc", "semantic.npy", "latents.npy", "config.json"):
                src = vdir / name
                if src.exists():
                    shutil.copy2(src, ndir / name)
            note = (req.note if req else None) or f"自 v{v.v} 复制"
            new_v = Version(
                id=uid("v"),
                project_id=v.project_id,
                v=vnum,
                source="fork",
                parent_version_id=v.id,
                note=note[:60],
                status="done",
                abc=v.abc,
                audio_path=str(ndir / "song.flac"),
                latents_path=str(ndir / "latents.npy") if (ndir / "latents.npy").exists() else None,
                semantic_path=str(ndir / "semantic.npy") if (ndir / "semantic.npy").exists() else None,
                duration=v.duration,
                config_json=v.config_json,
            )
            db.add(new_v)
            db.commit()
        return {"version_id": new_v.id, "v": vnum}
    except Exception:
        # don't leave a half-populated vNN dir behind if the fork failed
        if new_v is None and ndir is not None:
            shutil.rmtree(ndir, ignore_errors=True)
        raise
    finally:
        db.close()


class AbcDraftIn(BaseModel):
    abc: str
    note: str | None = None


@router.put("/{version_id}/abc")
def save_abc_draft(version_id: str, req: AbcDraftIn):
    v = _get_version(version_id)
    if not req.abc.strip():
        raise HTTPException(400, "abc cannot be empty")
    vdir = _vdir(v)
    if not vdir:
        raise HTTPException(400, "version has no artifact directory")
    edits = vdir / "edits"
    edits.mkdir(parents=True, exist_ok=True)
    import time as _time

    draft = {"abc": req.abc, "note": req.note or "", "updated_at": _time.time()}
    (edits / "draft.json").write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"saved": True, "updated_at": draft["updated_at"]}


@router.get("/{version_id}/transcription")
def version_transcription(version_id: str):
    v = _get_version(version_id)
    vdir = _vdir(v)
    tdir = vdir / "transcription" if vdir else None
    if not tdir or not (tdir / "score.abc").exists():
        raise HTTPException(404, "no transcription for this version")
    files = {}
    for name in TRANSCRIPTION_FILES:
        p = tdir / name
        if p.exists():
            files[name] = "/audio/" + str(p.relative_to(settings.data_dir))
    events = []
    ev_path = tdir / "events.json"
    if ev_path.exists():
        try:
            data = json.loads(ev_path.read_text(encoding="utf-8"))
            events = data.get("events", []) if isinstance(data, dict) else data
        except Exception:
            events = []
    beats = load_beats(v)
    return {
        "abc": (tdir / "score.abc").read_text(encoding="utf-8"),
        "files": files,
        "summary": summarize(events),
        "n_beats": len(beats["beats"]),
        "n_downbeats": len(beats["downbeats"]),
    }


@router.get("/{version_id}/stems")
def version_stems(version_id: str):
    v = _get_version(version_id)
    vdir = _vdir(v)
    sdir = vdir / "stems" if vdir else None
    if not sdir or not (sdir / "vocals.flac").exists():
        raise HTTPException(404, "no stems for this version")
    stems = {}
    for name in ("vocals", "drums", "bass", "other"):
        p = sdir / f"{name}.flac"
        if p.exists():
            stems[name] = "/audio/" + str(p.relative_to(settings.data_dir))
    return {"stems": stems}
