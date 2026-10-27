"""Job task implementations. Signature: (params, emit, cancelled) -> result dict."""

import hashlib
import json
import shutil
import random
import threading
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from sqlalchemy import func

from ..core.config import settings
from ..core.db import SessionLocal
from ..models.tables import Project, Version, uid
from .models_mgr import models

# Serializes version-number allocation (max(v)+1 + mkdir + row commit) across
# the job worker thread and request threads (fork), so two writers can never
# share one vNN directory.
VLOCK = threading.Lock()


def _alloc_version_dir(db, project_id: str) -> tuple[int, Path]:
    """Allocate the next free vNN directory for a project.

    Caller must hold VLOCK. Skips dirs left behind by crashed runs instead of
    silently sharing them.
    """
    vnum = (
        db.query(func.max(Version.v)).filter(Version.project_id == project_id).scalar() or 0
    ) + 1
    while True:
        vdir = settings.data_dir / "projects" / project_id / f"v{vnum:02d}"
        try:
            vdir.mkdir(parents=True, exist_ok=False)
            return vnum, vdir
        except FileExistsError:
            vnum += 1


def _src_cache_key(src: str) -> str:
    """Stable cache key for a source file: survives restarts (unlike hash()),
    changes when the file content changes."""
    p = Path(src).resolve()
    st = p.stat()
    h = hashlib.sha1(f"{p}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()[:10]
    return f"{p.stem[:24]}_{h}"


def _token_callback(emit, stage: str):
    state = {"n": 0, "t0": time.time()}

    def cb(_phase, _token):
        state["n"] += 1
        if state["n"] % 50 == 0:
            emit(
                stage=stage,
                tokens=state["n"],
                tps=round(state["n"] / max(time.time() - state["t0"], 0.1), 1),
            )

    return cb


def _version_urls(project_id: str, dirname: str) -> dict:
    base = f"/audio/projects/{project_id}/{dirname}"
    return {
        "audio": f"{base}/song.flac",
        "abc": f"{base}/plan.abc",
        "latents": f"{base}/latents.npy",
        "semantic": f"{base}/semantic.npy",
    }


def run_generate(params: dict, emit, cancelled) -> dict:
    db = SessionLocal()
    version = None
    try:
        project = db.get(Project, params["project_id"])
        if project is None:
            raise ValueError(f"project {params.get('project_id')} not found")
        with VLOCK:
            vnum, vdir = _alloc_version_dir(db, project.id)
            version = Version(
                id=uid("v"),
                project_id=project.id,
                v=vnum,
                source=params.get("source", "generated"),
                parent_version_id=params.get("parent_version_id"),
                note=params.get("note", ""),
                status="running",
            )
            db.add(version)
            db.commit()
        dirname = f"v{vnum:02d}"

        emit(stage="load_model", detail="loading YuE2 pipeline (first run takes a while)")
        pipe = models.pipeline()

        seed = int(params.get("seed") or random.randrange(2**31))
        style = params["style"]
        lyrics = params["lyrics"]
        cot = params.get("cot", project.cot or "full")
        cfg = params.get("cfg_scale")

        emit(stage="plan", detail="planning ABC score")
        abc_text = params.get("abc")
        if abc_text:
            emit(stage="plan", detail="using provided score")
        plan = pipe.plan(
            style=style,
            lyrics=lyrics,
            cot=cot,
            seed=seed,
            cfg_scale=cfg,
            abc=abc_text,
            on_token=_token_callback(emit, "plan"),
            cancelled=cancelled,
        )
        (vdir / "plan.abc").write_text(plan.abc or "", encoding="utf-8")
        version.abc = plan.abc
        db.commit()

        emit(stage="semantic", detail="generating song tokens")
        semantic = pipe.generate_semantic(
            plan, on_token=_token_callback(emit, "semantic"), cancelled=cancelled
        )

        emit(stage="nar", detail="synthesizing audio latents")
        latents = pipe.synthesize(semantic, cancelled=cancelled)

        emit(stage="vae", detail="decoding audio")
        audio = pipe.decode(latents)

        sf.write(vdir / "song.flac", audio, 48000, subtype="PCM_24")
        np.save(vdir / "semantic.npy", np.asarray(semantic.tokens, dtype=np.int32))
        np.save(vdir / "latents.npy", latents.astype(np.float32))
        config = {
            "style": style,
            "lyrics": lyrics,
            "cot": cot,
            "seed": seed,
            "cfg_scale": cfg,
            "abc_provided": bool(abc_text),
        }
        (vdir / "config.json").write_text(
            json.dumps(config, ensure_ascii=False, indent=1), encoding="utf-8"
        )

        duration = round(len(audio) / 48000, 2)
        version.status = "done"
        version.audio_path = str(vdir / "song.flac")
        version.latents_path = str(vdir / "latents.npy")
        version.semantic_path = str(vdir / "semantic.npy")
        version.duration = duration
        version.config_json = config
        version.timing_json = {
            "plan": plan.timing,
            "semantic": semantic.timing,
        }
        db.commit()
        emit(stage="done", detail=f"{duration}s song at {vdir.name}")
        return {
            "version_id": version.id,
            "project_id": project.id,
            "v": vnum,
            "duration": duration,
            "seed": seed,
            "urls": _version_urls(project.id, dirname),
            "truncated": {"abc": plan.truncated, "semantic": semantic.truncated},
        }
    except InterruptedError:
        if version is not None:
            version.status = "cancelled"
            db.commit()
        raise
    except Exception:
        if version is not None:
            version.status = "failed"
            db.commit()
        raise
    finally:
        db.close()


def run_plan(params: dict, emit, cancelled) -> dict:
    emit(stage="load_model", detail="loading YuE2 pipeline")
    pipe = models.pipeline()
    emit(stage="plan", detail="planning ABC score")
    plan = pipe.plan(
        style=params["style"],
        lyrics=params["lyrics"],
        cot=params.get("cot", "full"),
        seed=int(params.get("seed") or random.randrange(2**31)),
        cfg_scale=params.get("cfg_scale"),
        on_token=_token_callback(emit, "plan"),
        cancelled=cancelled,
    )
    return {"abc": plan.abc, "timing": plan.timing, "truncated": plan.truncated}


def run_transcribe(params: dict, emit, cancelled) -> dict:
    from ..models.tables import Version
    from .transcribe_svc import transcribe_file, transcribe_version

    melody_only = bool(params.get("melody_only"))
    if params.get("version_id"):
        db = SessionLocal()
        try:
            version = db.get(Version, params["version_id"])
            if version is None:
                raise ValueError("version not found")
            result = transcribe_version(version, melody_only=melody_only, emit=emit)
        finally:
            db.close()
    else:
        src = params.get("path")
        if not src or not Path(src).exists():
            raise ValueError("provide path or version_id")
        out_dir = settings.data_dir / "transcriptions" / f"t_{_src_cache_key(src)}"
        result = transcribe_file(src, out_dir, melody_only=melody_only, emit=emit)
    return result


def run_stems(params: dict, emit, cancelled) -> dict:
    from ..models.tables import Version
    from .stems_svc import separate_file

    if params.get("version_id"):
        db = SessionLocal()
        try:
            version = db.get(Version, params["version_id"])
            if version is None:
                raise ValueError("version not found")
            if not version.audio_path or not Path(version.audio_path).exists():
                raise ValueError("version has no audio")
            src = version.audio_path
            out_dir = Path(version.audio_path).parent / "stems"
        finally:
            db.close()
    else:
        src = params.get("path")
        if not src or not Path(src).exists():
            raise ValueError("provide path or version_id")
        out_dir = settings.data_dir / "stems" / f"s_{_src_cache_key(src)}"
    return separate_file(src, out_dir, emit=emit)


def run_library_import(params: dict, emit, cancelled) -> dict:
    from .library_svc import import_item

    return import_item(params, emit)


def run_cover_prepare(params: dict, emit, cancelled) -> dict:
    from .cover_svc import prepare_cover

    return prepare_cover(params, emit)


def run_punch(params: dict, emit, cancelled) -> dict:
    import numpy as np
    import soundfile as sf
    from pathlib import Path

    from ..core.db import SessionLocal
    from ..models.tables import Version
    from .punch_svc import make_candidates

    db = SessionLocal()
    try:
        version = db.get(Version, params["version_id"])
        if version is None:
            raise ValueError("version not found")
        result = make_candidates(
            version,
            (params["region"][0], params["region"][1]),
            int(params.get("candidates", 3)),
            params.get("seeds"),
            emit=emit,
            snap_to_beats=bool(params.get("snap_to_beats", True)),
        )
        # keep current audio audible in the candidates dir context
        result["base_audio_url"] = (
            "/audio/" + str(Path(version.audio_path).relative_to(settings.data_dir))
        )
        return result
    finally:
        db.close()


def run_punch_apply(params: dict, emit, cancelled) -> dict:
    import numpy as np
    import soundfile as sf

    from .punch_svc import apply_candidate

    db = SessionLocal()
    version = None
    new_version = None
    vdir = None
    try:
        version = db.get(Version, params["version_id"])
        if version is None:
            raise ValueError("version not found")
        result = apply_candidate(version, params["punch_id"], int(params["idx"]), emit=emit)

        with VLOCK:
            vnum, vdir = _alloc_version_dir(db, version.project_id)
            a, b = result["a"], result["b"]
            note = params.get("note") or f"挖补 {a / 25:.1f}-{b / 25:.1f}s #{result['idx'] + 1}"
            new_version = Version(
                id=uid("v"),
                project_id=version.project_id,
                v=vnum,
                source="punch",
                parent_version_id=version.id,
                note=note,
                status="running",
                abc=version.abc,
            )
            db.add(new_version)
            db.commit()

        sf.write(vdir / "song.flac", result["audio"], 48000, subtype="PCM_24")
        np.save(vdir / "latents.npy", result["latents"])
        shutil.copy(Path(version.audio_path).parent / "semantic.npy", vdir / "semantic.npy")
        shutil.copy(Path(version.audio_path).parent / "plan.abc", vdir / "plan.abc")
        config = dict(version.config_json or {})
        config["punch"] = {"from_version": version.id, "punch_id": params["punch_id"], "idx": result["idx"]}
        (vdir / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=1), encoding="utf-8")

        new_version.status = "done"
        new_version.audio_path = str(vdir / "song.flac")
        new_version.latents_path = str(vdir / "latents.npy")
        new_version.semantic_path = str(vdir / "semantic.npy")
        new_version.duration = round(len(result["audio"]) / 48000, 2)
        new_version.config_json = config
        db.commit()
        return {
            "version_id": new_version.id, "project_id": new_version.project_id, "v": vnum,
            "duration": new_version.duration,
            "urls": {"audio": f"/audio/projects/{new_version.project_id}/v{vnum:02d}/song.flac"},
        }
    except Exception:
        if new_version is not None:
            # the row was already committed as "running": mark it failed and
            # remove the partial artifact dir so no phantom version remains
            try:
                db.rollback()
            except Exception:
                pass
            new_version.status = "failed"
            try:
                db.commit()
            except Exception:
                pass
            if vdir is not None:
                shutil.rmtree(vdir, ignore_errors=True)
        raise
    finally:
        db.close()


def run_agent_edit(params: dict, emit, cancelled) -> dict:
    from ..core.db import SessionLocal
    from ..models.tables import Version
    from .agent_svc import edit_score

    db = SessionLocal()
    try:
        version = db.get(Version, params["version_id"])
        if version is None:
            raise ValueError("version not found")
        return edit_score(version, params["instruction"], emit=emit)
    finally:
        db.close()


def run_evaluate(params: dict, emit, cancelled) -> dict:
    from ..models.tables import Version
    from .eval_svc import duel, evaluate_version

    db = SessionLocal()
    try:
        ids = params["version_ids"][:4]
        evals = {}
        for vid in ids:
            version = db.get(Version, vid)
            if version is None:
                continue
            emit(stage="evaluate", detail=f"version {version.v}")
            evals[vid] = evaluate_version(version, emit)
        duel_out = None
        labels = params.get("labels") or []
        # labels[i] corresponds to version_ids[i]; duel the first two only if both evaluated
        if len(ids) >= 2 and len(labels) >= 2 and ids[0] in evals and ids[1] in evals:
            duel_out = duel(evals[ids[0]], evals[ids[1]], labels[0], labels[1])
        return {"evals": evals, "duel": duel_out}
    finally:
        db.close()


def run_evaluate_batch(params: dict, emit, cancelled) -> dict:
    from pathlib import Path as _Path

    from ..core.db import SessionLocal
    from ..models.tables import Version
    from .eval_svc import evaluate_version

    db = SessionLocal()
    try:
        rows = (
            db.query(Version)
            .filter(Version.status == "done", Version.audio_path.isnot(None))
            .order_by(Version.created_at.desc())
            .all()
        )
        todo = [v for v in rows if not (_Path(v.audio_path).parent / "eval.json").exists()]
        todo = todo[: int(params.get("limit", 8))]
        done = []
        for i, v in enumerate(todo):
            if cancelled():
                raise InterruptedError()
            emit(stage="evaluate", detail=f"{i + 1}/{len(todo)} · v{v.v} {v.note or v.source}")
            evaluate_version(v, emit)
            done.append(v.id)
        return {"evaluated": done, "remaining": max(0, len(rows) - len(done))}
    finally:
        db.close()
def run_lyrics(params: dict, emit, cancelled) -> dict:
    from ..models.tables import Project, Version
    from .asr_svc import align_reference_lines, build_lrc, transcribe_lyrics

    src = None
    version = None
    if not src and params.get("version_id"):
        db = SessionLocal()
        try:
            version = db.get(Version, params["version_id"])
            if version is None or not version.audio_path:
                raise ValueError("version not found or has no audio")
            src = version.audio_path
        finally:
            db.close()
    src = src or params.get("path")
    if not src or not Path(src).exists():
        raise ValueError("provide path or version_id")
    res = transcribe_lyrics(src, emit=emit, language=params.get("language"), with_timestamps=True)

    if version is not None:
        # prefer the user's own lyrics, timed by fuzzy alignment onto the ASR timeline
        ref_lyrics = (version.config_json or {}).get("lyrics") or ""
        ref_lines = align_reference_lines(ref_lyrics, res.get("items") or []) if ref_lyrics.strip() else []
        if ref_lines:
            res["segments"] = ref_lines
            res["lyrics_source"] = "reference"
        else:
            res["lyrics_source"] = "asr"

    if params.get("version_id") and version is not None and res.get("segments"):
        from ..core.db import SessionLocal as _SL

        db = _SL()
        try:
            p = db.get(Project, version.project_id)
            title = p.title if p else ""
            vdir = Path(version.audio_path).parent
            (vdir / "lyrics.lrc").write_text(
                build_lrc(res["segments"], title=title), encoding="utf-8"
            )
            (vdir / "lyrics.json").write_text(
                json.dumps({"text": res.get("text", ""), "segments": res["segments"]}, ensure_ascii=False, indent=1),
                encoding="utf-8",
            )
            res["saved"] = True
        finally:
            db.close()
    if not res.get("segments"):
        res["note"] = "对齐器不可用(未下载或未缓存),仅返回整段文本"
    return res


def run_analyze(params: dict, emit, cancelled) -> dict:
    import json as _json
    from pathlib import Path

    from ..core.db import SessionLocal
    from ..models.tables import Version
    from .library_svc import compute_tags
    from .mert_svc import analyze_file, segment_structure

    db = SessionLocal()
    try:
        v = db.get(Version, params["version_id"]) if params.get("version_id") else None
        if v is not None and (not v.audio_path or not Path(v.audio_path).exists()):
            raise ValueError("version has no audio")
        src = params.get("path") or v.audio_path
        result = analyze_file(src, emit)
        segments = segment_structure(result["frames_25hz"])
        out = {
            "duration": result["duration"],
            "segments": segments,
            "tags": compute_tags(src),
            "embedding_shape": list(result["embedding"].shape),
        }
        if v is not None:
            (Path(v.audio_path).parent / "analysis.json").write_text(
                _json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8"
            )
            out["saved"] = True
        return out
    finally:
        db.close()


def run_master(params: dict, emit, cancelled) -> dict:
    """整曲母带:渲染 → (默认)落成 source=master 的新版本,乐谱/隐变量原样继承。"""
    import json as _json
    import time as _time
    from pathlib import Path as _Path

    from ..core.db import SessionLocal
    from ..models.tables import Version, uid
    from .master_svc import master_to_file, resolve_params, src_cache_key

    preset = params.get("preset")
    overrides = params.get("overrides") or {}
    mparams = resolve_params(preset, overrides)

    db = SessionLocal()
    version = None
    new_version = None
    vdir = None
    tmp_out = None
    try:
        if params.get("version_id"):
            version = db.get(Version, params["version_id"])
            if version is None:
                raise ValueError("version not found")
            if not version.audio_path or not _Path(version.audio_path).exists():
                raise ValueError("version has no audio")
            src_path = version.audio_path
            stems_dir = _Path(src_path).parent / "stems"
            project_id = version.project_id
        else:
            src_path = params.get("path")
            if not src_path or not _Path(src_path).exists():
                raise ValueError("provide path or version_id")
            stems_dir = settings.data_dir / "stems" / f"s_{src_cache_key(src_path)}"
            project_id = params.get("project_id")

        tmp_out = settings.data_dir / "cache" / f"master_tmp_{uid('t')}.flac"
        stats = master_to_file(src_path, stems_dir, mparams, tmp_out, emit=emit, cancelled=cancelled)

        master_meta = {
            "preset": preset,
            "overrides": overrides,
            "params": mparams.to_dict(),
            "stats": stats,
            "source_version_id": version.id if version else None,
            "source_version": version.v if version else None,
        }

        if params.get("create_version", True):
            with VLOCK:
                vnum, vdir = _alloc_version_dir(db, project_id)
                note = (params.get("note") or f"母带 ({preset or '自定义'})")[:60]
                new_version = Version(
                    id=uid("v"),
                    project_id=project_id,
                    v=vnum,
                    source="master",
                    parent_version_id=version.id if version else None,
                    note=note,
                    status="running",
                    abc=version.abc if version else None,
                )
                db.add(new_version)
                db.commit()

            _Path(tmp_out).replace(vdir / "song.flac")
            vparent = _Path(version.audio_path).parent if version else None
            for name in ("plan.abc", "semantic.npy", "latents.npy"):
                if vparent and (vparent / name).exists():
                    shutil.copy(vparent / name, vdir / name)
            config = dict(version.config_json or {}) if version else {}
            config["master"] = master_meta
            (vdir / "config.json").write_text(
                _json.dumps(config, ensure_ascii=False, indent=1), encoding="utf-8"
            )
            (vdir / "master.json").write_text(
                _json.dumps(master_meta, ensure_ascii=False, indent=1), encoding="utf-8"
            )

            new_version.status = "done"
            new_version.audio_path = str(vdir / "song.flac")
            new_version.duration = stats["duration"]
            new_version.config_json = config
            db.commit()
            emit(stage="done", detail=f"母带完成 → v{vnum:02d}")
            return {
                "version_id": new_version.id,
                "project_id": project_id,
                "v": vnum,
                "urls": {"audio": f"/audio/projects/{project_id}/v{vnum:02d}/song.flac"},
                "stats": stats,
                "preset": preset,
            }

        out = settings.data_dir / "masters" / f"m_{src_cache_key(src_path)}_{int(_time.time())}.flac"
        _Path(tmp_out).replace(out)
        url = None
        try:
            url = "/audio/" + str(out.relative_to(settings.data_dir))
        except ValueError:
            pass
        emit(stage="done", detail=f"母带完成 → {out.name}")
        return {"path": str(out), "url": url, "stats": stats, "preset": preset}
    except Exception:
        if new_version is not None:
            try:
                db.rollback()
            except Exception:
                pass
            new_version.status = "failed"
            try:
                db.commit()
            except Exception:
                pass
            if vdir is not None:
                shutil.rmtree(vdir, ignore_errors=True)
        raise
    finally:
        if tmp_out is not None:
            Path(tmp_out).unlink(missing_ok=True)
        db.close()


def run_model_load(params: dict, emit, cancelled) -> dict:
    name = params["name"]
    emit(stage="load_model", detail=f"loading {name}")
    if name == "yue2":
        models.pipeline()
    elif name == "sheetsage2":
        models.sheetsage()
    elif name == "mert":
        models.mert()
    elif name == "htdemucs":
        models.demucs()
    elif name == "asr":
        models.asr()
    elif name == "agent":
        models.agent_llm()
    elif name == "vae":
        models.vae()
    else:
        raise ValueError(f"unknown model: {name}")
    emit(stage="done", detail=f"{name} loaded")
    return {"model": name, "loaded": True}


TASKS = {
    "generate": run_generate,
    "plan": run_plan,
    "transcribe": run_transcribe,
    "stems": run_stems,
    "library_import": run_library_import,
    "cover_prepare": run_cover_prepare,
    "punch": run_punch,
    "punch_apply": run_punch_apply,
    "agent_edit": run_agent_edit,
    "evaluate": run_evaluate,
    "evaluate_batch": run_evaluate_batch,
    "lyrics": run_lyrics,
    "analyze": run_analyze,
    "master": run_master,
    "model_load": run_model_load,
}
