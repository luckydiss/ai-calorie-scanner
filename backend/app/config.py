from dataclasses import dataclass
import os
from pathlib import Path


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class Settings:
    app_env: str
    app_port: int
    access_ttl_seconds: int
    refresh_ttl_seconds: int
    openrouter_api_key: str
    openrouter_model: str
    openrouter_base_url: str
    openrouter_timeout_seconds: float
    app_name: str
    telegram_bot_token: str
    telegram_initdata_ttl_seconds: int
    auth_rate_limit_per_minute: int
    scans_rate_limit_per_minute: int
    database_url: str
    telegram_allow_insecure_dev: bool
    log_level: str
    maintenance_cleanup_interval_minutes: int
    sessions_retention_days: int
    scan_jobs_retention_days: int
    cors_allow_origin_regex: str


def get_settings() -> Settings:
    # Load local env files if present so runtime can read OPENROUTER_* without manual export.
    app_dir = Path(__file__).resolve().parent
    _load_env_file(app_dir.parent / ".env")
    _load_env_file(app_dir.parent.parent / ".env")

    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required. SQLite runtime was removed.")
    return Settings(
        app_env=os.getenv("APP_ENV", "development"),
        app_port=int(os.getenv("APP_PORT", "8080")),
        access_ttl_seconds=int(os.getenv("JWT_ACCESS_TTL_SECONDS", "3600")),
        refresh_ttl_seconds=int(os.getenv("JWT_REFRESH_TTL_SECONDS", "2592000")),
        openrouter_api_key=os.getenv("OPENROUTER_API_KEY", ""),
        openrouter_model=os.getenv("OPENROUTER_MODEL", "google/gemini-3.1-flash-lite-preview"),
        openrouter_base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        openrouter_timeout_seconds=float(os.getenv("OPENROUTER_TIMEOUT_SECONDS", "45")),
        app_name=os.getenv("APP_NAME", "calorie-food-miniapp"),
        telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
        telegram_initdata_ttl_seconds=int(os.getenv("TELEGRAM_INITDATA_TTL_SECONDS", "300")),
        auth_rate_limit_per_minute=int(os.getenv("AUTH_RATE_LIMIT_PER_MINUTE", "30")),
        scans_rate_limit_per_minute=int(os.getenv("SCANS_RATE_LIMIT_PER_MINUTE", "20")),
        database_url=database_url,
        telegram_allow_insecure_dev=os.getenv("TELEGRAM_ALLOW_INSECURE_DEV", "0") in {"1", "true", "True"},
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        maintenance_cleanup_interval_minutes=int(os.getenv("MAINTENANCE_CLEANUP_INTERVAL_MINUTES", "30")),
        sessions_retention_days=int(os.getenv("SESSIONS_RETENTION_DAYS", "30")),
        scan_jobs_retention_days=int(os.getenv("SCAN_JOBS_RETENTION_DAYS", "30")),
        cors_allow_origin_regex=os.getenv(
            "CORS_ALLOW_ORIGIN_REGEX",
            r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://([a-z0-9-]+\.)*telegram\.org$|^https://([a-z0-9-]+\.)*t\.me$",
        ),
    )
