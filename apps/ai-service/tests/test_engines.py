"""Image engine from the panel (API.md §7.27): the panel picks among providers that have keys and models the server
allows; anything else is ignored and the server's chain is used, so a stale choice never stops generation."""

import base64
import io
import os

os.environ.setdefault("INTERNAL_TOKEN", "test-internal-token-0123456789abcdef0123")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.config import Settings  # noqa: E402
from app.engines import EngineRegistry, catalog, resolve  # noqa: E402
from app.main import create_app  # noqa: E402
from app.providers import GeminiProvider, MockProvider, ProviderError  # noqa: E402

TOKEN = os.environ["INTERNAL_TOKEN"]
AUTH = {"X-Internal-Token": TOKEN}
KEYS = {"GEMINI_API_KEY": "g" * 20, "REPLICATE_API_TOKEN": "r" * 20}
EXTRA = "gemini|gemini-test-pro-image|0.13|Gemini Pro (test);replicate|black-forest-labs/flux-kontext-max|0.08"


def settings(**kw) -> Settings:
    base = {"INTERNAL_TOKEN": TOKEN, "IMAGE_PROVIDER": "gemini", "IMAGE_FALLBACKS": "replicate", **KEYS}
    return Settings(**{**base, **kw})  # type: ignore[arg-type]


class Fake:
    """Answers like a provider; `fail` makes it a retryable outage."""

    def __init__(self, name: str, model: str, fail: bool = False):
        self.name, self.model, self.fail, self.calls = name, model, fail, 0

    async def generate(self, image, prompt, variant, tint_hex, timeout):
        self.calls += 1
        if self.fail:
            raise ProviderError(f"{self.name}_http_503", retryable=True)
        return await MockProvider().generate(image, prompt, variant, tint_hex, timeout)


def room_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), (200, 190, 170)).save(buf, "JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def test_catalog_lists_what_the_server_allows():
    s = settings(IMAGE_MODEL_ALLOWLIST=EXTRA)
    by = {p["name"]: p for p in catalog(s)}
    assert by["gemini"]["usable"] and by["replicate"]["usable"]
    assert not by["falai"]["configured"] and not by["falai"]["usable"]
    assert [m["id"] for m in by["gemini"]["models"]] == ["gemini-3.1-flash-image", "gemini-test-pro-image"]
    assert by["gemini"]["models"][1] == {"id": "gemini-test-pro-image", "label": "Gemini Pro (test)", "cost_usd": 0.13}
    assert by["replicate"]["models"][1]["label"] == "black-forest-labs/flux-kontext-max"  # no label given: the id
    assert by["gemini"]["models"][0]["cost_usd"] == s.gemini_image_cost_usd
    prod = settings(ENV="production")
    assert {p["name"]: p["usable"] for p in catalog(prod)}["mock"] is False


def test_resolve_accepts_only_usable_providers_and_allowed_models():
    s = settings(IMAGE_MODEL_ALLOWLIST=EXTRA)
    assert resolve(s, ["replicate", "gemini"], {"gemini": "gemini-test-pro-image"}) == (
        [("replicate", "black-forest-labs/flux-kontext-pro"), ("gemini", "gemini-test-pro-image")], [])
    assert resolve(s, ["falai"], {})[1] == ["provider_unavailable:falai"]
    assert resolve(s, ["gemini"], {"gemini": "anything/else"})[1] == ["model_not_allowed:gemini"]
    assert resolve(s, ["gemini", "gemini"], {})[1] == ["duplicate_provider"]
    assert "chain_length" in resolve(s, [], {})[1]
    assert resolve(s, ["gemini"], {"replicate": "black-forest-labs/flux-kontext-max"})[1] == ["model_for_unused_provider:replicate"]
    assert resolve(settings(ENV="production"), ["mock"], {})[1] == ["provider_unavailable:mock"]


def test_a_malformed_allowlist_stops_the_service_at_boot():
    for bad, match in [("gemini|x", "provider\\|model\\|usd"), ("dalle|m|0.1", "unknown provider"), ("mock|m|0", "unknown provider"),
                       ("gemini|bad model id|0.1", "invalid model id"), ("gemini|m|9", "price out of range")]:
        with pytest.raises(ValueError, match=match):
            settings(IMAGE_MODEL_ALLOWLIST=bad)


def test_registry_builds_the_chosen_models_and_ignores_a_stale_choice():
    s = settings(IMAGE_MODEL_ALLOWLIST=EXTRA)
    reg = EngineRegistry(s, [])
    chain = reg.chain_for(["gemini"], {"gemini": "gemini-test-pro-image"})
    assert isinstance(chain[0], GeminiProvider) and chain[0].model == "gemini-test-pro-image"
    assert reg.chain_for(["gemini"], {"gemini": "gemini-test-pro-image"})[0] is chain[0]  # reused
    assert reg.chain_for(["falai"], {}) is None
    assert reg.chain_for(None, None) is None
    assert s.model_cost_usd("gemini", "gemini-test-pro-image") == 0.13
    assert s.model_cost_usd("gemini", "gemini-3.1-flash-image") == s.gemini_image_cost_usd


def make_client(**kw):
    s = settings(**kw)
    gemini = Fake("gemini", s.default_model("gemini"))
    replicate = Fake("replicate", s.default_model("replicate"))
    return TestClient(create_app(s, providers=[gemini, replicate])), gemini, replicate


def generate(client, engine=None):
    body = {"tool": "redesign", "image_b64": room_b64(), "variants": 1}
    if engine is not None:
        body["engine"] = engine
    return client.post("/internal/v1/generate", headers=AUTH, json=body)


def test_generation_follows_the_panel_chain_and_falls_back_to_the_server_chain():
    client, gemini, replicate = make_client()
    r = generate(client)
    assert r.status_code == 200 and r.json()["usage"]["provider"] == "gemini"
    r = generate(client, {"chain": ["replicate", "gemini"]})
    assert r.status_code == 200 and r.json()["usage"]["provider"] == "replicate" and replicate.calls == 1
    # A choice the server cannot honour (no fal.ai key) is ignored, not an error.
    r = generate(client, {"chain": ["falai"]})
    assert r.status_code == 200 and r.json()["usage"]["provider"] == "gemini"
    # Only the panel's providers are tried: replicate down, nothing else in the chosen chain.
    replicate.fail = True
    r = generate(client, {"chain": ["replicate"]})
    assert r.status_code == 502 and gemini.calls == 2
    r = generate(client, {"chain": ["replicate", "gemini"]})
    assert r.status_code == 200 and r.json()["usage"]["provider"] == "gemini" and r.json()["usage"]["fallback_used"] is True


def test_engines_endpoint_needs_the_token_and_shows_breakers():
    client, _, _ = make_client(IMAGE_MODEL_ALLOWLIST=EXTRA)
    assert client.get("/internal/v1/engines").status_code == 401
    body = client.get("/internal/v1/engines", headers=AUTH).json()
    assert body["default_chain"] == ["gemini", "replicate"]
    assert {p["name"] for p in body["providers"]} == {"mock", "gemini", "replicate", "falai"}
    assert {b["name"] for b in body["breakers"]} >= {"gemini", "replicate"}
    bad = client.post("/internal/v1/generate", headers=AUTH, json={"tool": "redesign", "image_b64": room_b64(), "engine": {"chain": ["x" * 21]}})
    assert bad.status_code == 400
