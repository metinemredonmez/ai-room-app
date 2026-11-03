"""API.md §7.4 / §7.2 / §7.5: fallback chain, circuit breaker, time budget, quality gate, no-change
detection, usage ledger, retryable errors and docs exposure."""

import asyncio
import base64
import glob
import io
import os
import random
import time

os.environ.setdefault("INTERNAL_TOKEN", "test-internal-token-0123456789abcdef0123")
os.environ.setdefault("IMAGE_PROVIDER", "mock")
os.environ.pop("ANTHROPIC_API_KEY", None)

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.prompts import clean  # noqa: E402
from app.providers import MockProvider, ProviderError, http_error, status_is_retryable, transport_error  # noqa: E402
from app.quality import assess  # noqa: E402
from app.resilience import CircuitBreaker  # noqa: E402

TOKEN = os.environ["INTERNAL_TOKEN"]
AUTH = {"X-Internal-Token": TOKEN}
SAMPLES = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "../../backend/assets/samples/*.jpg")))


def settings(**overrides) -> Settings:
    return Settings(INTERNAL_TOKEN=TOKEN, IMAGE_PROVIDER="mock", **overrides)  # type: ignore[call-arg]


def jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def room_image(size=(1280, 960)) -> Image.Image:
    """A synthetic 'room': walls, floor, window, furniture blocks and fine texture."""
    rnd = random.Random(7)
    w, h = size
    img = Image.new("RGB", size, (226, 214, 196))
    d = ImageDraw.Draw(img)
    d.polygon([(0, h), (w, h), (int(w * 0.75), int(h * 0.65)), (int(w * 0.25), int(h * 0.65))], fill=(150, 110, 75))
    d.rectangle([int(w * 0.42), int(h * 0.2), int(w * 0.62), int(h * 0.45)], fill=(160, 200, 230), outline=(255, 255, 255), width=8)
    d.rounded_rectangle([int(w * 0.3), int(h * 0.55), int(w * 0.7), int(h * 0.75)], radius=20, fill=(95, 110, 125))
    d.rectangle([int(w * 0.08), int(h * 0.25), int(w * 0.2), int(h * 0.4)], fill=(190, 120, 90), outline=(80, 60, 40), width=5)
    for _ in range(4000):
        x, y = rnd.randrange(w), rnd.randrange(h)
        shade = rnd.randrange(-25, 25)
        r, g, b = img.getpixel((x, y))
        d.point((x, y), fill=(max(0, r + shade), max(0, g + shade), max(0, b + shade)))
    return img


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


ROOM = jpeg(room_image((640, 480)))


class FakeProvider:
    """Behaviour: ok (mock tint), retryable, fatal, same (returns the input), slow."""

    def __init__(self, name: str, behaviour: str, delay: float = 0.0):
        self.name = name
        self.model = f"{name}-test-model"
        self.behaviour = behaviour
        self.delay = delay
        self.calls = 0

    async def generate(self, image, prompt, variant, tint_hex, timeout):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.behaviour == "retryable":
            raise ProviderError(f"{self.name}_http_503", retryable=True)
        if self.behaviour == "fatal":
            raise ProviderError(f"{self.name}_http_400", retryable=False)
        if self.behaviour == "same":
            return image
        return await MockProvider().generate(image, prompt, variant, tint_hex, timeout)


def generate(client: TestClient, variants: int = 1, **body):
    return client.post("/internal/v1/generate", headers=AUTH,
                       json={"tool": "redesign", "image_b64": b64(ROOM), "variants": variants,
                             "style_prompt": "japandi interior", **body})


# ------------------------------------------------------------------------------ classification

def test_retryable_classification():
    for status in (408, 429, 500, 502, 503, 504):
        assert status_is_retryable(status) and http_error("gemini", status).retryable
    for status in (400, 401, 403, 404, 413, 422):
        assert not status_is_retryable(status) and not http_error("gemini", status).retryable
    assert transport_error("gemini", httpx.ReadTimeout("t")).retryable
    assert transport_error("gemini", httpx.ConnectError("c")).code == "gemini_connection"


# ----------------------------------------------------------------------------- circuit breaker

def test_breaker_opens_then_allows_a_single_half_open_probe():
    now = [0.0]
    br = CircuitBreaker(threshold=3, cooldown=10, clock=lambda: now[0])
    for _ in range(3):
        assert br.allow()
        br.record_failure()
    assert br.state == "open" and not br.allow()
    now[0] = 10.0
    assert br.state == "half_open"
    assert br.allow()          # the probe
    assert not br.allow()      # nobody else while it is in flight
    br.record_failure()        # failed probe re-opens
    assert br.state == "open" and not br.allow()
    now[0] = 20.0
    assert br.allow()
    br.record_success()
    assert br.state == "closed" and br.consecutive_failures == 0 and br.allow()


def test_non_retryable_answer_closes_a_half_open_breaker():
    now = [0.0]
    br = CircuitBreaker(threshold=1, cooldown=5, clock=lambda: now[0])
    br.record_failure()
    now[0] = 5.0
    assert br.allow()
    br.record_neutral()
    assert br.state == "closed"


# ------------------------------------------------------------------------------ fallback chain

def test_fallback_used_when_primary_fails_retryably():
    primary, backup = FakeProvider("gemini", "retryable"), FakeProvider("replicate", "ok")
    client = TestClient(create_app(settings(), providers=[primary, backup]))
    res = generate(client, variants=2)
    assert res.status_code == 200, res.text
    usage = res.json()["usage"]
    assert usage["fallback_used"] is True and usage["provider"] == "replicate"
    assert usage["model"] == "replicate-test-model" and usage["images"] == 2
    assert usage["cost_usd"] == pytest.approx(2 * 0.04)
    assert len(res.json()["images_b64"]) == 2 and primary.calls == 2


def test_non_retryable_error_stops_the_chain():
    primary, backup = FakeProvider("gemini", "fatal"), FakeProvider("replicate", "ok")
    client = TestClient(create_app(settings(), providers=[primary, backup]))
    res = generate(client)
    assert res.status_code == 502
    assert res.json()["error"] == {"code": "ai_unavailable", "message": "Image provider failed (gemini_http_400)", "retryable": False}
    assert backup.calls == 0


def test_all_providers_failing_is_retryable_502():
    client = TestClient(create_app(settings(), providers=[FakeProvider("gemini", "retryable"), FakeProvider("replicate", "retryable")]))
    res = generate(client)
    assert res.status_code == 502 and res.json()["error"]["retryable"] is True


def test_open_circuit_skips_the_primary_and_shows_in_health():
    primary, backup = FakeProvider("gemini", "retryable"), FakeProvider("replicate", "ok")
    client = TestClient(create_app(settings(BREAKER_FAILURE_THRESHOLD=2), providers=[primary, backup]))
    for _ in range(3):
        assert generate(client).status_code == 200
    assert primary.calls == 2  # third request skipped the open circuit
    health = client.get("/internal/v1/health", headers=AUTH).json()
    states = {p["name"]: p for p in health["providers"]}
    assert states["gemini"]["state"] == "open" and states["gemini"]["consecutive_failures"] == 2
    assert states["replicate"]["state"] == "closed"


def test_time_budget_caps_the_whole_request():
    slow = FakeProvider("gemini", "ok", delay=3.0)
    client = TestClient(create_app(settings(GENERATE_TIME_BUDGET_S=0.3), providers=[slow]))
    started = time.perf_counter()
    res = generate(client)
    assert time.perf_counter() - started < 2.0
    assert res.status_code == 502
    body = res.json()["error"]
    assert body["retryable"] is True
    assert "time_budget_exceeded" in body["message"] or "timeout" in body["message"]


# --------------------------------------------------------------------------- no-change + usage

def test_unchanged_output_is_422_no_change_with_usage():
    client = TestClient(create_app(settings(), providers=[FakeProvider("gemini", "same")]))
    res = generate(client, variants=2)
    assert res.status_code == 422
    body = res.json()
    assert body["error"]["code"] == "no_change" and body["error"]["retryable"] is False
    assert body["usage"]["images"] == 2 and body["usage"]["cost_usd"] == pytest.approx(2 * 0.039)


def test_mock_generation_reports_zero_cost_usage():
    client = TestClient(create_app(settings()))
    res = generate(client, variants=2)
    assert res.status_code == 200
    usage = res.json()["usage"]
    assert usage["provider"] == "mock" and usage["kind"] == "generate" and usage["cost_usd"] == 0
    assert usage["images"] == 2 and usage["fallback_used"] is False and usage["latency_ms"] >= 0


def test_demo_assistant_answers_report_demo_usage():
    client = TestClient(create_app(settings()))
    a = client.post("/internal/v1/analyze", headers=AUTH, json={"image_b64": b64(ROOM), "locale": "tr"})
    c = client.post("/internal/v1/chat", headers=AUTH, json={"messages": [{"role": "user", "text": "Salonum küçük"}]})
    assert a.json()["usage"]["provider"] == "demo" and a.json()["usage"]["kind"] == "analyze"
    assert c.json()["usage"] == {"provider": "demo", "model": "demo", "kind": "chat", "images": 0, "input_tokens": 0,
                                 "output_tokens": 0, "latency_ms": 0, "cost_usd": 0.0, "fallback_used": False}


def test_claude_cost_formula():
    s = settings()
    assert s.claude_cost_usd(1_000_000, 0) == pytest.approx(4.0)
    assert s.claude_cost_usd(1000, 500) == pytest.approx(0.004 + 0.01)


# ------------------------------------------------------------------------------- quality gate

def test_quality_accepts_a_clean_room_and_flags_bad_captures():
    good = assess(jpeg(room_image()))
    assert good.score >= 70 and good.issues == []
    dark = assess(jpeg(ImageEnhance.Brightness(room_image()).enhance(0.15)))
    assert "too_dark" in dark.issues and dark.score < 70
    blurry = assess(jpeg(room_image().filter(ImageFilter.GaussianBlur(12))))
    assert "blurry" in blurry.issues
    small = assess(jpeg(room_image((320, 240))))
    assert "low_res" in small.issues and small.metrics.width == 320


@pytest.mark.skipif(not SAMPLES, reason="backend sample photos (apps/backend/assets/samples) not found")
def test_quality_built_in_samples_pass():
    for path in SAMPLES:
        with open(path, "rb") as f:
            report = assess(f.read())
        assert report.score >= 70 and report.issues == [], (path, report)


def test_quality_endpoint():
    client = TestClient(create_app(settings()))
    res = client.post("/internal/v1/quality", headers=AUTH, json={"image_b64": b64(jpeg(room_image()))})
    assert res.status_code == 200 and set(res.json()) == {"score", "issues", "metrics"}
    assert client.post("/internal/v1/quality", json={"image_b64": b64(ROOM)}).status_code == 401


# ------------------------------------------------------------------------- config & free text

def test_fallback_configuration_is_validated(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("REPLICATE_API_TOKEN", raising=False)
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        settings(IMAGE_FALLBACKS="gemini")
    with pytest.raises(ValueError, match="unknown"):
        settings(IMAGE_FALLBACKS="dalle")
    with pytest.raises(ValueError, match="repeat"):
        settings(IMAGE_FALLBACKS="mock")
    with pytest.raises(ValueError, match="fallback in production"):
        Settings(INTERNAL_TOKEN=TOKEN, ENV="production", IMAGE_PROVIDER="gemini", GEMINI_API_KEY="k" * 20,  # type: ignore[call-arg]
                 IMAGE_FALLBACKS="mock")
    ok = settings(IMAGE_FALLBACKS=" gemini , replicate ", GEMINI_API_KEY="k" * 20, REPLICATE_API_TOKEN="r" * 20)
    assert ok.provider_chain == ["mock", "gemini", "replicate"]


def test_turkish_free_text_normalisation():
    assert clean("K A N E P E  ve İSTANBUL​ ISPARTA", user_text=True) == "kanepe ve istanbul ısparta"
    assert clean("Japandi Style", 40) == "Japandi Style"  # system text keeps its case


# -------------------------------------------------------------------------------- docs + errors

def test_docs_only_outside_production():
    dev = TestClient(create_app(settings()))
    assert dev.get("/docs").status_code == 200
    schema = dev.get("/openapi.json").json()
    assert "APIKeyHeader" in schema["components"]["securitySchemes"]
    assert "/internal/v1/quality" in schema["paths"]
    prod = TestClient(create_app(
        Settings(INTERNAL_TOKEN=TOKEN, ENV="production", IMAGE_PROVIDER="gemini", GEMINI_API_KEY="k" * 20),  # type: ignore[call-arg]
        providers=[FakeProvider("gemini", "ok")]))
    assert prod.get("/docs").status_code == 404 and prod.get("/openapi.json").status_code == 404


def test_error_bodies_carry_retryable():
    client = TestClient(create_app(settings()))
    body = client.get("/internal/v1/health").json()
    assert body["error"] == {"code": "unauthorized", "message": "unauthorized", "retryable": False}
