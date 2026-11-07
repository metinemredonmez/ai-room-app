"""The AI coach's voice (API.md §7.54): ElevenLabs, then OpenAI, in the order the backend sends.

The backend decides everything: the text (only the coach's own reply), the voices and the order. This module only
calls the providers, classifies why one failed (billing and key problems need the founder; a busy provider does not)
and reports the cost. Without any key, development and tests get a short demo tone so the product works end to end;
production never invents a voice (EXC-01, fail closed).

Retired models are never defaults here: OpenAI's tts-1 retires on 6 January 2027 (gpt-4o-mini-tts is used instead).
"""

import base64
import io
import math
import time
import wave
from dataclasses import dataclass

import httpx

from .config import Settings
from .schemas import TtsRequest, TtsResponse, Usage, VoiceFailure, VoiceStep

ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_64"
OPENAI_URL = "https://api.openai.com/v1/audio/speech"
PROVIDER_TIMEOUT_S = 25.0
MAX_AUDIO_BYTES = 8 * 1024 * 1024


class VoiceUnavailable(Exception):
    """No step produced audio; `failures` says why for each one."""

    def __init__(self, failures: list[VoiceFailure]):
        super().__init__("voice_unavailable")
        self.failures = failures


@dataclass
class _Failed(Exception):
    reason: str


def _detail(body: object) -> str:
    """The provider's own error code, lower-cased, whatever the shape ({detail:{status}}, {error:{code,type}})."""
    if not isinstance(body, dict):
        return ""
    for key in ("detail", "error"):
        v = body.get(key)
        if isinstance(v, dict):
            return " ".join(str(v.get(k, "")) for k in ("status", "code", "type", "message")).lower()
        if isinstance(v, str):
            return v.lower()
    return ""


def classify(provider: str, status: int, body: object) -> str:
    """Why a provider said no, as one of the reasons the backend alerts on (fal-app ses-hata-sinifi, simplified)."""
    d = _detail(body)
    if any(w in d for w in ("payment", "billing", "insufficient_quota", "insufficient_credits", "subscription")):
        return "billing"
    if "quota_exceeded" in d or (provider == "elevenlabs" and "quota" in d):
        return "quota"
    if status in (401, 403):
        return "auth"
    if status == 402:
        return "billing"
    if "voice" in d and ("not_found" in d or "not found" in d or "invalid" in d or "does not exist" in d):
        return "bad_voice"
    if status == 404:
        return "bad_voice"
    if status == 429:
        return "rate_limited"
    return "unavailable"


def demo_tone(seconds: int) -> bytes:
    """A soft two-note chime as WAV (8 kHz, 8-bit mono): clearly not a voice, small, and plays everywhere."""
    rate, length = 8000, max(0.6, min(float(seconds), 3.0))
    frames = bytearray()
    for i in range(int(rate * length)):
        t = i / rate
        freq = 523.25 if t < length / 2 else 659.25
        fade = min(1.0, t * 8, (length - t) * 8)
        frames.append(int(128 + 40 * fade * math.sin(2 * math.pi * freq * t)))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return buf.getvalue()


class Voice:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    @property
    def configured(self) -> list[str]:
        return [p for p, key in (("elevenlabs", self.settings.elevenlabs_api_key), ("openai", self.settings.openai_api_key)) if key]

    def _key(self, provider: str) -> str | None:
        return self.settings.elevenlabs_api_key if provider == "elevenlabs" else self.settings.openai_api_key

    def _cost(self, provider: str, chars: int) -> float:
        per_1k = self.settings.elevenlabs_usd_per_1k_chars if provider == "elevenlabs" else self.settings.openai_tts_usd_per_1k_chars
        return round(chars / 1000 * per_1k, 6)

    async def _call(self, step: VoiceStep, text: str, key: str) -> bytes:
        if step.provider == "elevenlabs":
            url = ELEVENLABS_URL.format(voice=step.voice)
            headers = {"xi-api-key": key, "accept": "audio/mpeg"}
            payload: dict = {
                "text": text, "model_id": step.model,
                "voice_settings": {"stability": step.stability, "similarity_boost": 0.75, "speed": step.speed},
            }
        else:
            url = OPENAI_URL
            headers = {"authorization": f"Bearer {key}"}
            payload = {"model": step.model, "voice": step.voice, "input": text, "response_format": "mp3"}
            if step.instructions:
                payload["instructions"] = step.instructions
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(PROVIDER_TIMEOUT_S, connect=5.0), transport=self.transport) as client:
                res = await client.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise _Failed("unavailable") from exc
        if res.status_code >= 400:
            try:
                body = res.json()
            except ValueError:
                body = None
            raise _Failed(classify(step.provider, res.status_code, body))
        audio = res.content
        if not audio or len(audio) > MAX_AUDIO_BYTES or "audio" not in res.headers.get("content-type", "audio/mpeg"):
            raise _Failed("unavailable")
        return audio

    async def speak(self, req: TtsRequest) -> TtsResponse:
        failures: list[VoiceFailure] = []
        for step in req.chain:
            key = self._key(step.provider)
            if not key:
                failures.append(VoiceFailure(provider=step.provider, reason="not_configured"))
                continue
            started = time.perf_counter()
            try:
                audio = await self._call(step, req.text, key)
            except _Failed as f:
                failures.append(VoiceFailure(provider=step.provider, reason=f.reason))  # type: ignore[arg-type]
                continue
            usage = Usage(
                provider=step.provider, model=step.model, kind="tts",
                latency_ms=int((time.perf_counter() - started) * 1000), cost_usd=self._cost(step.provider, len(req.text)),
                fallback_used=bool(failures),
            )
            return TtsResponse(audio_b64=base64.b64encode(audio).decode(), mime="audio/mpeg", provider=step.provider,
                               model=step.model, failures=failures, usage=usage)
        # Keyless development: a demo tone instead of a voice, when nothing was really tried.
        if self.settings.env != "production" and all(f.reason == "not_configured" for f in failures):
            seconds = max(1, math.ceil(len(req.text) / 14))
            return TtsResponse(audio_b64=base64.b64encode(demo_tone(seconds)).decode(), mime="audio/wav", provider="demo",
                               model="demo-tone", failures=failures, usage=Usage(provider="demo", model="demo", kind="tts"))
        raise VoiceUnavailable(failures)
