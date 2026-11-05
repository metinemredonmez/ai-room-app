"""Image engine from the panel (API.md §7.27): which providers are tried, in which order, with which model.

The server decides what is possible: a provider needs its key in the environment, and a model must be the one the
provider is configured with or an IMAGE_MODEL_ALLOWLIST entry (added after its licence and price were checked). The
panel only chooses among those. A choice that does not fit (a key was removed, a model left the list) is ignored and
the server's own chain is used, so a stale panel setting never stops generation.
"""

import logging

from .config import IMAGE_PROVIDERS, Settings
from .providers import ImageProvider, create_provider

log = logging.getLogger("ai-service")

MAX_CHAIN = 4
LABELS = {
    "gemini-3.1-flash-image": "Gemini 3.1 Flash Image (Nano Banana 2)",
    "black-forest-labs/flux-kontext-pro": "FLUX.1 Kontext Pro",
    "fal-ai/flux-2/klein/4b/edit": "FLUX.2 [klein] 4B edit",
    "mock-tint": "Demo (renk tonu, ücretsiz)",
}


def usable(settings: Settings, provider: str) -> bool:
    """Has its key, and is not the offline demo in production."""
    if provider not in IMAGE_PROVIDERS or not settings._has_key(provider):
        return False
    return not (provider == "mock" and settings.env == "production")


def models(settings: Settings, provider: str) -> list[dict]:
    default = settings.default_model(provider)
    out = [{"id": default, "label": LABELS.get(default, default), "cost_usd": settings.model_cost_usd(provider, default)}]
    for p, model, cost, label in settings.extra_models:
        if p == provider and model != default:
            out.append({"id": model, "label": label, "cost_usd": cost})
    return out


def catalog(settings: Settings) -> list[dict]:
    return [
        {"name": p, "configured": settings._has_key(p), "usable": usable(settings, p),
         "default_model": settings.default_model(p), "models": models(settings, p)}
        for p in IMAGE_PROVIDERS
    ]


def resolve(settings: Settings, chain: list[str], chosen: dict[str, str]) -> tuple[list[tuple[str, str]], list[str]]:
    """The panel's choice as (provider, model) pairs, or the problems that make it unusable (empty pairs then)."""
    problems: list[str] = []
    if not 1 <= len(chain) <= MAX_CHAIN:
        problems.append("chain_length")
    if len(set(chain)) != len(chain):
        problems.append("duplicate_provider")
    pairs: list[tuple[str, str]] = []
    for name in chain:
        if not usable(settings, name):
            problems.append(f"provider_unavailable:{name}")
            continue
        model = chosen.get(name) or settings.default_model(name)
        if model not in {m["id"] for m in models(settings, name)}:
            problems.append(f"model_not_allowed:{name}")
            continue
        pairs.append((name, model))
    problems += [f"model_for_unused_provider:{n}" for n in chosen if n not in chain]
    return ([] if problems else pairs), problems


class EngineRegistry:
    """Provider instances per (provider, model), created once and reused; the default chain's own instances are
    reused as they are (tests inject fakes there)."""

    def __init__(self, settings: Settings, defaults: list[ImageProvider]):
        self.settings = settings
        self._instances: dict[tuple[str, str], ImageProvider] = {(p.name, p.model): p for p in defaults}

    def get(self, name: str, model: str) -> ImageProvider:
        key = (name, model)
        if key not in self._instances:
            self._instances[key] = create_provider(name, self.settings, model)
        return self._instances[key]

    def chain_for(self, chain: list[str] | None, chosen: dict[str, str] | None) -> list[ImageProvider] | None:
        """None means "use the server's chain" (nothing chosen, or the choice no longer fits)."""
        if not chain:
            return None
        pairs, problems = resolve(self.settings, chain, chosen or {})
        if problems:
            log.warning("engine_choice_ignored problems=%s", ",".join(problems))
            return None
        return [self.get(name, model) for name, model in pairs]
