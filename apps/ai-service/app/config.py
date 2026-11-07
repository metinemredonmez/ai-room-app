import re
from functools import lru_cache
from typing import Literal

from pydantic import Field, ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# KEY-01 / KEY-02: secrets come only from the environment; unsafe settings stop the process at boot.

WEAK_TOKENS = {"change-me", "changeme", "secret", "internal", "dev"}
IMAGE_PROVIDERS = ("mock", "gemini", "replicate", "falai")
ProviderName = Literal["mock", "gemini", "replicate", "falai"]
MODEL_ID = re.compile(r"^[A-Za-z0-9._/:-]{1,120}$")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: Literal["development", "test", "production"] = Field("development", alias="ENV")
    internal_token: str = Field(..., alias="INTERNAL_TOKEN", min_length=32)

    image_provider: ProviderName = Field("mock", alias="IMAGE_PROVIDER")
    # Comma-separated fallback chain tried in order after the primary (e.g. "replicate").
    image_fallbacks: str = Field("", alias="IMAGE_FALLBACKS")
    gemini_api_key: str | None = Field(None, alias="GEMINI_API_KEY")
    gemini_image_model: str = Field("gemini-3.1-flash-image", alias="GEMINI_IMAGE_MODEL")
    replicate_api_token: str | None = Field(None, alias="REPLICATE_API_TOKEN")
    replicate_model: str = Field("black-forest-labs/flux-kontext-pro", alias="REPLICATE_MODEL")

    # fal.ai: FLUX.2 [klein] edit as an image provider + SAM 3 segmentation for region lock.
    fal_key: str | None = Field(None, alias="FAL_KEY")
    falai_edit_model: str = Field("fal-ai/flux-2/klein/4b/edit", alias="FALAI_EDIT_MODEL")
    falai_seg_model: str = Field("fal-ai/sam-3/image", alias="FALAI_SEG_MODEL")
    falai_image_cost_usd: float = Field(0.012, alias="FALAI_IMAGE_COST_USD", ge=0)
    falai_seg_cost_usd: float = Field(0.005, alias="FALAI_SEG_COST_USD", ge=0)
    # Extra image models the panel may choose (API.md §7.27), added only after their licence and price are checked:
    # "provider|model|usd_per_image|label;…", e.g. "falai|fal-ai/some/edit|0.02|Some edit". The model each provider
    # is configured with above is always allowed.
    image_model_allowlist: str = Field("", alias="IMAGE_MODEL_ALLOWLIST")
    # Region lock for local edits (paint, flooring, replace, targeted declutter): auto | off.
    region_lock: Literal["auto", "off"] = Field("auto", alias="REGION_LOCK")

    anthropic_api_key: str | None = Field(None, alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field("claude-opus-5-5", alias="ANTHROPIC_MODEL")

    # The coach's voice (API.md §7.54). Voices and models are chosen in the panel; only the keys live here.
    elevenlabs_api_key: str | None = Field(None, alias="ELEVENLABS_API_KEY")
    openai_api_key: str | None = Field(None, alias="OPENAI_API_KEY")
    elevenlabs_usd_per_1k_chars: float = Field(0.22, alias="ELEVENLABS_USD_PER_1K_CHARS", ge=0, le=5)
    openai_tts_usd_per_1k_chars: float = Field(0.018, alias="OPENAI_TTS_USD_PER_1K_CHARS", ge=0, le=5)

    # Cost ledger inputs (USD). Image prices are per generated image; Claude prices per million tokens.
    gemini_image_cost_usd: float = Field(0.067, alias="GEMINI_IMAGE_COST_USD", ge=0)
    replicate_image_cost_usd: float = Field(0.04, alias="REPLICATE_IMAGE_COST_USD", ge=0)
    anthropic_input_usd_per_mtok: float = Field(4.0, alias="ANTHROPIC_INPUT_USD_PER_MTOK", ge=0)
    anthropic_output_usd_per_mtok: float = Field(20.0, alias="ANTHROPIC_OUTPUT_USD_PER_MTOK", ge=0)

    # Resilience: total time budget per /generate, per-call cap, circuit breaker.
    generate_time_budget_s: float = Field(150.0, alias="GENERATE_TIME_BUDGET_S", gt=0, le=600)
    provider_timeout_s: float = Field(120.0, alias="PROVIDER_TIMEOUT_S", gt=0, le=600)
    breaker_failure_threshold: int = Field(5, alias="BREAKER_FAILURE_THRESHOLD", ge=1, le=100)
    breaker_cooldown_s: float = Field(60.0, alias="BREAKER_COOLDOWN_S", gt=0, le=3600)

    max_image_bytes: int = Field(12 * 1024 * 1024, alias="MAX_IMAGE_BYTES")
    max_concurrent_generations: int = Field(4, alias="MAX_CONCURRENT_GENERATIONS", ge=1, le=64)

    # Error reporting (Sentry). Unset = off. Reports carry no personal data (app/monitoring.py).
    sentry_dsn: str | None = Field(None, alias="SENTRY_DSN", pattern=r"^https?://")
    sentry_environment: str | None = Field(None, alias="SENTRY_ENVIRONMENT", max_length=40)
    sentry_release: str | None = Field(None, alias="SENTRY_RELEASE", max_length=80)
    sentry_traces_sample_rate: float = Field(0.0, alias="SENTRY_TRACES_SAMPLE_RATE", ge=0, le=1)

    def default_model(self, provider: str) -> str:
        return {"gemini": self.gemini_image_model, "replicate": self.replicate_model, "falai": self.falai_edit_model}.get(provider, "mock-tint")

    @property
    def extra_models(self) -> list[tuple[str, str, float, str]]:
        """IMAGE_MODEL_ALLOWLIST as (provider, model, usd per image, label); check_safe rejects a malformed entry."""
        out: list[tuple[str, str, float, str]] = []
        for entry in filter(None, (e.strip() for e in self.image_model_allowlist.split(";"))):
            parts = [p.strip() for p in entry.split("|")]
            try:
                provider, model, cost = parts[0], parts[1], float(parts[2])
            except (IndexError, ValueError):
                raise ValueError(f"IMAGE_MODEL_ALLOWLIST entry '{entry[:60]}' must be provider|model|usd|label") from None
            out.append((provider, model, cost, (parts[3] if len(parts) > 3 and parts[3] else model)[:60]))
        return out

    def model_cost_usd(self, provider: str, model: str) -> float:
        for p, m, cost, _ in self.extra_models:
            if p == provider and m == model:
                return cost
        return self.image_cost_usd(provider)

    @property
    def fallback_list(self) -> list[str]:
        return [p.strip() for p in self.image_fallbacks.split(",") if p.strip()]

    @property
    def provider_chain(self) -> list[str]:
        return [self.image_provider, *self.fallback_list]

    @property
    def docs_enabled(self) -> bool:
        return self.env != "production"

    def _has_key(self, provider: str) -> bool:
        return {"mock": True, "gemini": bool(self.gemini_api_key), "replicate": bool(self.replicate_api_token),
                "falai": bool(self.fal_key)}[provider]

    @model_validator(mode="after")
    def check_safe(self) -> "Settings":
        problems: list[str] = []
        if self.internal_token.lower() in WEAK_TOKENS:
            problems.append("INTERNAL_TOKEN is a known default")
        if self.env == "production" and self.image_provider == "mock":
            problems.append("IMAGE_PROVIDER=mock is not allowed in production")
        chain = self.provider_chain
        for name in chain:
            if name not in IMAGE_PROVIDERS:
                problems.append(f"unknown image provider '{name}'")
            elif not self._has_key(name):
                key = {"gemini": "GEMINI_API_KEY", "replicate": "REPLICATE_API_TOKEN", "falai": "FAL_KEY"}[name]
                problems.append(f"{key} is required for provider '{name}'")
        if len(set(chain)) != len(chain):
            problems.append("IMAGE_FALLBACKS must not repeat a provider")
        if self.env == "production" and "mock" in self.fallback_list:
            problems.append("mock is not allowed as a fallback in production")
        try:
            for provider, model, cost, _ in self.extra_models:
                if provider not in IMAGE_PROVIDERS or provider == "mock":
                    problems.append(f"IMAGE_MODEL_ALLOWLIST: unknown provider '{provider}'")
                if not MODEL_ID.fullmatch(model):
                    problems.append(f"IMAGE_MODEL_ALLOWLIST: invalid model id for '{provider}'")
                if not 0 <= cost <= 5:
                    problems.append(f"IMAGE_MODEL_ALLOWLIST: price out of range for '{model[:40]}'")
        except ValueError as exc:
            problems.append(str(exc))
        # fal-app lesson: a key's id was stored instead of the key and the voice silently failed for days. Check the
        # shape only, and never echo the value.
        if self.elevenlabs_api_key and (len(self.elevenlabs_api_key) < 30 or not self.elevenlabs_api_key.isascii()
                                                    or any(c.isspace() for c in self.elevenlabs_api_key)):
            problems.append("ELEVENLABS_API_KEY does not look like an API key")
        if self.openai_api_key and (not self.openai_api_key.startswith("sk-") or len(self.openai_api_key) < 30
                                                or any(c.isspace() for c in self.openai_api_key)):
            problems.append("OPENAI_API_KEY does not look like an API key")
        if problems:
            raise ValueError("Unsafe configuration: " + "; ".join(problems))
        return self

    @property
    def chat_enabled(self) -> bool:
        return bool(self.anthropic_api_key)

    def image_cost_usd(self, provider: str) -> float:
        return {"gemini": self.gemini_image_cost_usd, "replicate": self.replicate_image_cost_usd,
                "falai": self.falai_image_cost_usd}.get(provider, 0.0)

    def claude_cost_usd(self, input_tokens: int, output_tokens: int) -> float:
        return (input_tokens * self.anthropic_input_usd_per_mtok + output_tokens * self.anthropic_output_usd_per_mtok) / 1_000_000


class UnsafeConfiguration(ValueError):
    """Boot refused. Carries only field names and rules, never a value."""


def load_settings(**overrides: object) -> Settings:
    """LOG-02 / KEY-02: pydantic's own error text includes every input value — API keys included — and a boot error
    lands in the process log. Re-raise with field names and rules only, and drop the original from the chain."""
    try:
        return Settings(**overrides)  # type: ignore[arg-type]
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(p) for p in e['loc']) or 'settings'}: {e['msg']}" for e in exc.errors(include_input=False, include_url=False)
        )
    # Raised outside the except block, so the original error is not even kept as the implicit context.
    raise UnsafeConfiguration(problems)


@lru_cache
def get_settings() -> Settings:
    return load_settings()
