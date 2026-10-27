from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

engine = create_engine(
    f"sqlite:///{settings.data_dir / 'workbench.db'}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    from ..models import tables  # noqa: F401

    Base.metadata.create_all(engine)
    _migrate()


def _migrate() -> None:
    """create_all 只建新表不改旧表;老库升级时在这里补列。"""
    from sqlalchemy import text

    with engine.begin() as conn:
        cols = {r[1] for r in conn.execute(text("PRAGMA table_info(uploads)"))}
        if cols and "derived_json" not in cols:
            conn.execute(text("ALTER TABLE uploads ADD COLUMN derived_json JSON"))
