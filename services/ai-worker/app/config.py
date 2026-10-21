"""Worker settings, read from the environment and services/ai-worker/.env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

WORKER_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=WORKER_ROOT / ".env", extra="ignore")

    worker_host: str = "127.0.0.1"
    worker_port: int = 8000
    ai_worker_token: str = ""
    worker_data_dir: Path = Path("./data")
    model_cache_dir: Path = Path("./model-cache")

    enable_sking: bool = False
    sking_dir: Path = Path("./models/Sking/SKING_DDJ_v101c")
    sking_parser_python: str = ""
    sking_foreground_python: str = ""
    sking_timeout_s: int = 600

    enable_triposr: bool = False
    triposr_dir: Path = Path("./models/TripoSR")
    triposr_python: str = ""
    # HF model id or a local directory with config.yaml + model.ckpt
    triposr_model: str = "./models/TripoSR-weights"
    triposr_device: str = "auto"
    triposr_timeout_s: int = 1800

    max_concurrent_gpu_jobs: int = 1
    max_upload_mb: int = 40
    job_ttl_s: int = 6 * 3600

    @field_validator("worker_data_dir", "model_cache_dir", "sking_dir", "triposr_dir")
    @classmethod
    def _resolve(cls, v: Path) -> Path:
        return v if v.is_absolute() else (WORKER_ROOT / v).resolve()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
