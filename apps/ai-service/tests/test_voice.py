"""The coach's voice (API.md §7.54): providers in the backend's order, failures classified for the founder's alerts,
a demo tone only without keys outside production, never an invented voice in production."""

import base64
import io
import json
import os
import wave

os.environ.setdefault("INTERNAL_TOKEN", "test-internal-token-0123456789abcdef0123")
os.environ.setdefault("IMAGE_PROVIDER", "mock")

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings, load_settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.schemas import TtsRequest  # noqa: E402
from app.voice import Voice, VoiceUnavailable, classify  # noqa: E402

TOKEN = os.environ["INTERNAL_TOKEN"]
AUTH = {"X-Internal-Token": TOKEN}
ELEVEN_KEY = "sk_" + "a" * 48
OPENAI_KEY = "sk-proj-" + "b" * 40
ELEVEN = {"provider": "elevenlabs", "model": "eleven_multilingual_v2", "voice": "VoiceIdAbc123", "stability": 0.5, "speed": 1.0}
OPENAI = {"provider": "openai", "model": "gpt-4o-mini-tts", "voice": "coral", "instructions": "Warm."}
MP3 = b"ID3" + b"\x00" * 200


def settings(**over) -> Settings:
    base = {"INTERNAL_TOKEN": TOKEN, "IMAGE_PROVIDER": "mock", "ENV": "development"}
    base.update(over)
    return load_settings(**base)


class Recorder(httpx.AsyncBaseTransport):
    """Answers per host; remembers every request (to check headers and bodies)."""

    def __init__(self, answers: dict[str, httpx.Response]):
        self.answers = answers
        self.seen: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        return self.answers[request.url.host]


def ok_audio() -> httpx.Response:
    return httpx.Response(200, content=MP3, headers={"content-type": "audio/mpeg"})


async def test_first_provider_answers_with_its_own_voice_and_cost():
    t = Recorder({"api.elevenlabs.io": ok_audio()})
    v = Voice(settings(ELEVENLABS_API_KEY=ELEVEN_KEY, OPENAI_API_KEY=OPENAI_KEY), transport=t)
    out = await v.speak(TtsRequest.model_validate({"text": "Merhaba, salonuna bakalım.", "lang": "tr", "chain": [ELEVEN, OPENAI]}))
    assert out.provider == "elevenlabs" and out.mime == "audio/mpeg" and base64.b64decode(out.audio_b64) == MP3
    assert out.failures == [] and out.usage.kind == "tts" and out.usage.cost_usd > 0 and not out.usage.fallback_used
    req = t.seen[0]
    assert req.url.path == "/v1/text-to-speech/VoiceIdAbc123" and req.headers["xi-api-key"] == ELEVEN_KEY
    assert json.loads(req.content)["model_id"] == "eleven_multilingual_v2"
    assert len(t.seen) == 1  # the fallback was not called


async def test_billing_problem_falls_back_and_is_reported():
    t = Recorder({
        "api.elevenlabs.io": httpx.Response(401, json={"detail": {"status": "payment_issue", "message": "x"}}),
        "api.openai.com": ok_audio(),
    })
    v = Voice(settings(ELEVENLABS_API_KEY=ELEVEN_KEY, OPENAI_API_KEY=OPENAI_KEY), transport=t)
    out = await v.speak(TtsRequest.model_validate({"text": "Hi", "lang": "en", "chain": [ELEVEN, OPENAI]}))
    assert out.provider == "openai" and out.usage.fallback_used
    assert [f.model_dump() for f in out.failures] == [{"provider": "elevenlabs", "reason": "billing"}]
    body = json.loads(t.seen[1].content)
    assert body == {"model": "gpt-4o-mini-tts", "voice": "coral", "input": "Hi", "response_format": "mp3", "instructions": "Warm."}
    assert t.seen[1].headers["authorization"] == f"Bearer {OPENAI_KEY}"


@pytest.mark.parametrize(("provider", "status", "body", "reason"), [
    ("elevenlabs", 401, {"detail": {"status": "invalid_api_key"}}, "auth"),
    ("elevenlabs", 401, {"detail": {"status": "quota_exceeded"}}, "quota"),
    ("elevenlabs", 402, None, "billing"),
    ("elevenlabs", 400, {"detail": {"status": "voice_not_found"}}, "bad_voice"),
    ("elevenlabs", 429, {"detail": {"status": "too_many_concurrent_requests"}}, "rate_limited"),
    ("openai", 429, {"error": {"code": "insufficient_quota", "type": "insufficient_quota"}}, "billing"),
    ("openai", 429, {"error": {"code": "rate_limit_exceeded"}}, "rate_limited"),
    ("openai", 401, {"error": {"code": "invalid_api_key"}}, "auth"),
    ("openai", 503, None, "unavailable"),
])
def test_classify(provider, status, body, reason):
    assert classify(provider, status, body) == reason


async def test_every_provider_failing_is_unavailable_with_reasons():
    t = Recorder({
        "api.elevenlabs.io": httpx.Response(503, text="busy"),
        "api.openai.com": httpx.Response(401, json={"error": {"code": "invalid_api_key"}}),
    })
    v = Voice(settings(ELEVENLABS_API_KEY=ELEVEN_KEY, OPENAI_API_KEY=OPENAI_KEY), transport=t)
    with pytest.raises(VoiceUnavailable) as e:
        await v.speak(TtsRequest.model_validate({"text": "Merhaba", "chain": [ELEVEN, OPENAI]}))
    assert [(f.provider, f.reason) for f in e.value.failures] == [("elevenlabs", "unavailable"), ("openai", "auth")]


async def test_not_audio_is_a_failure():
    t = Recorder({"api.openai.com": httpx.Response(200, json={"oops": True})})
    v = Voice(settings(OPENAI_API_KEY=OPENAI_KEY, ENV="production", IMAGE_PROVIDER="falai", FAL_KEY="x" * 40), transport=t)
    with pytest.raises(VoiceUnavailable):
        await v.speak(TtsRequest.model_validate({"text": "Merhaba", "chain": [OPENAI]}))


async def test_keyless_development_gets_a_demo_tone_not_a_voice():
    v = Voice(settings(), transport=Recorder({}))
    out = await v.speak(TtsRequest.model_validate({"text": "Merhaba " * 10, "chain": [ELEVEN]}))
    assert out.provider == "demo" and out.mime == "audio/wav"
    with wave.open(io.BytesIO(base64.b64decode(out.audio_b64))) as w:
        assert 0.5 < w.getnframes() / w.getframerate() <= 3.0
    assert [f.reason for f in out.failures] == ["not_configured"]


async def test_production_never_invents_a_voice():
    prod = settings(ENV="production", IMAGE_PROVIDER="falai", FAL_KEY="x" * 40)
    v = Voice(prod, transport=Recorder({}))
    with pytest.raises(VoiceUnavailable) as e:
        await v.speak(TtsRequest.model_validate({"text": "Merhaba", "chain": [ELEVEN]}))
    assert [f.reason for f in e.value.failures] == ["not_configured"]
    with pytest.raises(VoiceUnavailable):
        await v.speak(TtsRequest.model_validate({"text": "Merhaba", "chain": []}))


def test_a_key_id_instead_of_a_key_stops_the_service_at_boot():
    with pytest.raises(ValueError, match="ELEVENLABS_API_KEY does not look like an API key"):
        settings(ELEVENLABS_API_KEY="key_id_123")
    with pytest.raises(ValueError, match="OPENAI_API_KEY does not look like an API key"):
        settings(OPENAI_API_KEY="proj_" + "c" * 40)
    with pytest.raises(ValueError) as e:
        settings(OPENAI_API_KEY="sk-short")
    assert "sk-short" not in str(e.value)  # the value is never echoed
    assert settings(ELEVENLABS_API_KEY="", OPENAI_API_KEY="").elevenlabs_api_key == ""  # empty = not set


def test_endpoint_requires_token_and_validates_steps():
    client = TestClient(create_app(settings()))
    assert client.post("/internal/v1/tts", json={"text": "x"}).status_code == 401
    bad_voice = {**ELEVEN, "voice": "../../etc"}
    assert client.post("/internal/v1/tts", headers=AUTH, json={"text": "x", "chain": [bad_voice]}).status_code == 400
    assert client.post("/internal/v1/tts", headers=AUTH, json={"text": "x" * 3001}).status_code == 400
    unknown = {**OPENAI, "provider": "acme"}
    assert client.post("/internal/v1/tts", headers=AUTH, json={"text": "x", "chain": [unknown]}).status_code == 400
    r = client.post("/internal/v1/tts", headers=AUTH, json={"text": "Merhaba", "chain": [ELEVEN]})
    assert r.status_code == 200 and r.json()["provider"] == "demo"


def test_endpoint_reports_failures_on_502():
    prod = settings(ENV="production", IMAGE_PROVIDER="falai", FAL_KEY="x" * 40)
    client = TestClient(create_app(prod))
    r = client.post("/internal/v1/tts", headers=AUTH, json={"text": "Merhaba", "chain": [OPENAI]})
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "voice_unavailable" and r.json()["failures"] == [{"provider": "openai", "reason": "not_configured"}]


def test_health_lists_voice_providers_with_a_key():
    client = TestClient(create_app(settings(OPENAI_API_KEY=OPENAI_KEY)))
    assert client.get("/internal/v1/health", headers=AUTH).json()["voice_providers"] == ["openai"]


def test_boot_error_never_carries_other_secrets():
    with pytest.raises(ValueError) as e:
        settings(ANTHROPIC_API_KEY="sk-ant-" + "s" * 40, OPENAI_API_KEY="wrong-value-xyz")
    text = str(e.value) + repr(e.value.__cause__) + repr(e.value.__context__)
    assert "sk-ant-" not in text and "wrong-value-xyz" not in text and "OPENAI_API_KEY" in text
