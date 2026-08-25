from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", Path(__file__).resolve().parents[1] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    data_mode: str = "demo"
    contract_version: str = "1.0"
    data_dir: str = ""
    cors_origins: str = "http://localhost:5174,http://127.0.0.1:5174"
    pg_dsn: str = ""
    deepagent_base_url: str = "http://127.0.0.1:8010"
    allow_demo_fallback: bool = False

    @property
    def resolved_data_dir(self) -> Path:
        raw = self.data_dir.strip()
        if not raw:
            return (REPO_ROOT / "data").resolve()
        path = Path(raw).expanduser()
        if not path.is_absolute():
            path = REPO_ROOT / path
        return path.resolve()

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
