from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# KEY-01 / KEY-02: secrets come only from the environment; unsafe settings stop the process at boot.

WEAK_TOKENS = {"change-me", "changeme", "secret", "internal", "dev"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["development", "test", "production"] = Field("development", alias="ENV")
    internal_token: str = Field(..., alias="INTERNAL_TOKEN", min_length=32)

    image_provider: Literal["mock", "gemini", "replicate"] = Field("mock", alias="IMAGE_PROVIDER")
    gemini_api_key: str | None = Field(None, alias="GEMINI_API_KEY")
    gemini_image_model: str = Field("gemini-2.5-flash-image", alias="GEMINI_IMAGE_MODEL")
    replicate_api_token: str | None = Field(None, alias="REPLICATE_API_TOKEN")
    replicate_model: str = Field("black-forest-labs/flux-kontext-pro", alias="REPLICATE_MODEL")

    anthropic_api_key: str | None = Field(None, alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field("claude-opus-5-5", alias="ANTHROPIC_MODEL")

    max_image_bytes: int = Field(12 * 1024 * 1024, alias="MAX_IMAGE_BYTES")
    max_concurrent_generations: int = Field(4, alias="MAX_CONCURRENT_GENERATIONS", ge=1, le=64)

    @model_validator(mode="after")
    def check_safe(self) -> "Settings":
        problems: list[str] = []
        if self.internal_token.lower() in WEAK_TOKENS:
            problems.append("INTERNAL_TOKEN is a known default")
        if self.image_provider == "gemini" and not self.gemini_api_key:
            problems.append("GEMINI_API_KEY is required for IMAGE_PROVIDER=gemini")
        if self.image_provider == "replicate" and not self.replicate_api_token:
            problems.append("REPLICATE_API_TOKEN is required for IMAGE_PROVIDER=replicate")
        if self.env == "production" and self.image_provider == "mock":
            problems.append("IMAGE_PROVIDER=mock is not allowed in production")
        if problems:
            raise ValueError("Unsafe configuration: " + "; ".join(problems))
        return self

    @property
    def chat_enabled(self) -> bool:
        return bool(self.anthropic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
