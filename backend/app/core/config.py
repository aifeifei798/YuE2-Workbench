from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WB_", env_file=str(ROOT / ".env"), extra="ignore")

    data_dir: Path = ROOT / "data"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    device: str = "cuda"
    yue2_repo: str = "m-a-p/YuE2-3B"
    yue2_vae_repo: str = "m-a-p/YuE2-Vae"
    sheetsage_repo: str = "m-a-p/SheetSage2"
    mert_repo: str = "m-a-p/MERT-v2-FullSong"
    asr_repo: str = "Qwen/Qwen3-ASR-0.6B"
    asr_aligner_repo: str = "Qwen/Qwen3-ForcedAligner-0.6B"
    agent_repo: str = "Qwen/Qwen3-0.6B"
    max_queue: int = 10
    admin_password: str = ""   # empty = auth disabled (local mode)
    share_password: str = ""   # optional listen-only role
    auth_secret: str = ""      # cookie signing key; derived from admin_password if unset


settings = Settings()
(settings.data_dir / "projects").mkdir(parents=True, exist_ok=True)
