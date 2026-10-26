import time
import uuid

from sqlalchemy import JSON, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    title: Mapped[str] = mapped_column(Text, default="")
    style: Mapped[str] = mapped_column(Text, default="")
    lyrics: Mapped[str] = mapped_column(Text, default="")
    cot: Mapped[str] = mapped_column(String(16), default="full")
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Version(Base):
    __tablename__ = "versions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id"), index=True)
    v: Mapped[int] = mapped_column(Integer, default=1)
    source: Mapped[str] = mapped_column(String(16), default="generated")
    parent_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="running")
    abc: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    latents_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    semantic_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    config_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    timing_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class LibraryItem(Base):
    __tablename__ = "library"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    path: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, default="")
    artist: Mapped[str] = mapped_column(Text, default="")
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    tempo: Mapped[float | None] = mapped_column(Float, nullable=True)
    structure_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    embedding_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcription_dir: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    type: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    started_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    finished_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class BlindTest(Base):
    """One human A/B listening vote (blind: labels are just 'A'/'B')."""

    __tablename__ = "blind_tests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    a_version_id: Mapped[str] = mapped_column(String(32), ForeignKey("versions.id"))
    b_version_id: Mapped[str] = mapped_column(String(32), ForeignKey("versions.id"))
    winner: Mapped[str] = mapped_column(String(8))  # 'a' | 'b' | 'tie'
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
