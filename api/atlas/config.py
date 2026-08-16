"""Configuration, read once and validated.

The repo root holds a single `.env.local`, shared with the Next.js frontend, so
there is one place to put a key rather than two that drift.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _repo_root() -> Path:
    """Walk up from this file until a directory holding db/migrations is found."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "db" / "migrations").is_dir():
            return parent
    # Running from a wheel with no repo around it: fall back to the package's
    # grandparent so an explicit DATABASE_URL in the environment still works.
    return here.parents[2]


REPO_ROOT = _repo_root()
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"


class ConfigError(RuntimeError):
    pass


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env.local", REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── database (Supabase) ───────────────────────────────────────────────
    # Use the session pooler on 5432. The transaction pooler on 6543 cannot
    # hold the migrator's advisory lock and breaks the queue's SKIP LOCKED,
    # because it may hand each statement a different backend.
    database_url: str = Field(alias="DATABASE_URL")
    database_pool_min: int = Field(default=1, alias="DATABASE_POOL_MIN")
    database_pool_max: int = Field(default=10, alias="DATABASE_POOL_MAX")

    # ── providers ─────────────────────────────────────────────────────────
    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")

    generation_model: str = Field(
        default="gemini-2.5-flash", alias="ATLAS_GENERATION_MODEL"
    )
    embedding_model: str = Field(
        default="gemini-embedding-001", alias="ATLAS_EMBEDDING_MODEL"
    )
    # MUST equal the vector(N) width in db/migrations/001_core.sql.
    embedding_dim: int = Field(default=768, alias="ATLAS_EMBEDDING_DIM")
    embedding_version: int = Field(default=1, alias="ATLAS_EMBEDDING_VERSION")

    # ── auth ──────────────────────────────────────────────────────────────
    session_secret: str = Field(default="", alias="ATLAS_SESSION_SECRET")
    # Development convenience: authenticates every request as this user with no
    # login. NEVER set in production — it bypasses the permission filter.
    dev_user: str | None = Field(default=None, alias="ATLAS_DEV_USER")

    # ── retrieval defaults ────────────────────────────────────────────────
    top_k: int = Field(default=8, alias="ATLAS_TOP_K")
    candidates: int = Field(default=60, alias="ATLAS_CANDIDATES")
    alpha: float = Field(default=0.5, alias="ATLAS_ALPHA")
    rrf_k: int = Field(default=60, alias="ATLAS_RRF_K")

    # ── agentic loop budget ───────────────────────────────────────────────
    max_rounds: int = Field(default=4, alias="ATLAS_MAX_ROUNDS")
    max_tool_calls: int = Field(default=8, alias="ATLAS_MAX_TOOL_CALLS")
    max_query_tokens: int = Field(default=120_000, alias="ATLAS_MAX_QUERY_TOKENS")
    max_query_cost_usd: float = Field(default=0.25, alias="ATLAS_MAX_QUERY_COST_USD")
    max_query_ms: int = Field(default=90_000, alias="ATLAS_MAX_QUERY_MS")

    # ── worker ────────────────────────────────────────────────────────────
    worker_concurrency: int = Field(default=4, alias="ATLAS_WORKER_CONCURRENCY")
    worker_poll_ms: int = Field(default=1000, alias="ATLAS_WORKER_POLL_MS")
    job_lease_seconds: int = Field(default=300, alias="ATLAS_JOB_LEASE_SECONDS")

    # ── connectors ────────────────────────────────────────────────────────
    github_token: str | None = Field(default=None, alias="GITHUB_TOKEN")
    notion_token: str | None = Field(default=None, alias="NOTION_TOKEN")
    slack_bot_token: str | None = Field(default=None, alias="SLACK_BOT_TOKEN")
    jira_base_url: str | None = Field(default=None, alias="JIRA_BASE_URL")
    jira_email: str | None = Field(default=None, alias="JIRA_EMAIL")
    jira_api_token: str | None = Field(default=None, alias="JIRA_API_TOKEN")

    # Free-form price overrides, so a provider price change needs no deploy.
    # JSON: {"model-id": {"in": 1.23, "out": 4.56}}
    price_overrides: str | None = Field(default=None, alias="ATLAS_PRICE_OVERRIDES")

    @property
    def configured_providers(self) -> dict[str, bool]:
        return {
            "gemini": bool(self.gemini_api_key),
            "openai": bool(self.openai_api_key),
            "anthropic": bool(self.anthropic_api_key),
        }


@lru_cache(maxsize=1)
def settings() -> Settings:
    """Memoised. Call `settings.cache_clear()` in tests after mutating os.environ."""
    return Settings()  # type: ignore[call-arg]


def settings_status() -> dict[str, object]:
    """Non-throwing variant for the health endpoint and the settings screen."""
    try:
        s = settings()
    except Exception as exc:  # noqa: BLE001 — the message is the payload
        return {"ok": False, "error": str(exc)}
    return {
        "ok": True,
        "providers": s.configured_providers,
        "generation_model": s.generation_model,
        "embedding_model": s.embedding_model,
        "embedding_dim": s.embedding_dim,
        "embedding_version": s.embedding_version,
    }
