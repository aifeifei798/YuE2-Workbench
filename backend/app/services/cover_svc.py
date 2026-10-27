"""Cover pipeline orchestration: stems -> melody score -> ASR lyrics -> draft project."""

from pathlib import Path

from ..core.config import settings
from ..core.db import SessionLocal
from ..models.tables import Project, UploadAsset, uid
from .asr_svc import transcribe_lyrics
from .stems_svc import separate_file
from .transcribe_svc import transcribe_file


def prepare_cover(params: dict, emit) -> dict:
    src = params["path"]
    if not Path(src).exists():
        raise ValueError(f"file not found: {src}")
    tag = uid("")[:10]
    emit(stage="stems", detail="separating vocals (for ASR)")
    stems = separate_file(src, settings.data_dir / "stems" / f"cover_{tag}", emit=emit)

    emit(stage="transcribe", detail="melody-only transcription")
    tr = transcribe_file(
        src, settings.data_dir / "transcriptions" / f"cover_{tag}", melody_only=True, emit=emit
    )

    emit(stage="asr", detail="transcribing lyrics from vocals")
    asr = transcribe_lyrics(stems["paths"]["vocals"], emit=emit)

    db = SessionLocal()
    try:
        project = Project(
            id=uid("p"),
            title=f"翻唱 · {Path(src).stem}"[:60],
            style="",
            lyrics=asr["text"],
            cot="melody",
        )
        db.add(project)
        db.commit()
        # 素材关联:翻唱准备完成后记到上传素材上,素材页可跳回/下载
        ua = db.query(UploadAsset).filter(UploadAsset.path == src).first()
        if ua is not None:
            d = dict(ua.derived_json or {})
            ids = d.get("cover_project_ids", [])
            ids.append(project.id)
            d["cover_project_ids"] = ids[-10:]
            ua.derived_json = d
            db.commit()
    finally:
        db.close()

    return {
        "project_id": project.id,
        "abc": tr["abc"],
        "abc_files": tr["files"],
        "summary": tr["summary"],
        "lyrics_raw": asr["text"],
        "language": asr["language"],
        "stems": stems["stems"],
        "source_path": src,
    }
