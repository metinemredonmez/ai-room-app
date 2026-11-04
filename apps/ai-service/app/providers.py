import asyncio
import base64
import colorsys
import hashlib
import io
from typing import Protocol
from urllib.parse import urlparse

import httpx
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

from .config import Settings

MAX_RESULT_BYTES = 20 * 1024 * 1024


class ProviderError(RuntimeError):
    """A provider failure. `retryable` decides whether the chain may try the next provider."""

    def __init__(self, code: str, retryable: bool = False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def status_is_retryable(status: int) -> bool:
    """408/429/5xx are transient; every other 4xx means the request itself is wrong."""
    return status in (408, 429) or status >= 500


def http_error(provider: str, status: int) -> ProviderError:
    return ProviderError(f"{provider}_http_{status}", retryable=status_is_retryable(status))


def transport_error(provider: str, exc: Exception) -> ProviderError:
    kind = "timeout" if isinstance(exc, httpx.TimeoutException) else "connection"
    return ProviderError(f"{provider}_{kind}", retryable=True)


def _timeout(seconds: float) -> httpx.Timeout:
    return httpx.Timeout(seconds, connect=min(10.0, seconds))


class ImageProvider(Protocol):
    name: str
    model: str

    async def generate(self, image: bytes, prompt: str, variant: int, tint_hex: str | None, timeout: float) -> bytes: ...


def _tint_from(seed: str) -> tuple[int, int, int]:
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:6], 16) / 0xFFFFFF
    r, g, b = colorsys.hls_to_rgb(h, 0.55, 0.45)
    return int(r * 255), int(g * 255), int(b * 255)


class MockProvider:
    """Offline, deterministic colour-grade so the whole product works without any paid API key."""

    name = "mock"
    model = "mock-tint"

    async def generate(self, image: bytes, prompt: str, variant: int, tint_hex: str | None, timeout: float) -> bytes:
        return await asyncio.to_thread(self._render, image, prompt, variant, tint_hex)

    def _render(self, image: bytes, prompt: str, variant: int, tint_hex: str | None) -> bytes:
        with Image.open(io.BytesIO(image)) as src:
            img = src.convert("RGB")
        if tint_hex:
            tint = tuple(int(tint_hex[i : i + 2], 16) for i in (1, 3, 5))
        else:
            tint = _tint_from(f"{prompt}|{variant}")
        img = ImageEnhance.Color(img).enhance(1.2)
        img = ImageEnhance.Contrast(img).enhance(1.05 + 0.03 * variant)
        img = Image.blend(img, Image.new("RGB", img.size, tint), 0.22 + 0.04 * variant)

        w, h = img.size
        draw = ImageDraw.Draw(img, "RGBA")
        size = max(14, h // 30)
        font = ImageFont.load_default(size=size)
        label = f"CASALUME · DEMO · V{variant + 1}"
        box = draw.textbbox((0, 0), label, font=font)
        pad = size // 2
        draw.rounded_rectangle(
            (w * 0.03, h * 0.03, w * 0.03 + box[2] + pad * 2, h * 0.03 + box[3] + pad * 2),
            radius=pad, fill=(0, 0, 0, 120),
        )
        draw.text((w * 0.03 + pad, h * 0.03 + pad), label, font=font, fill=(255, 255, 255, 235))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=88)
        return out.getvalue()


# Gemini finish/block reasons that mean "this request will never produce an image" (non-retryable).
GEMINI_BLOCK_REASONS = {"SAFETY", "PROHIBITED_CONTENT", "IMAGE_SAFETY", "BLOCKLIST", "SPII", "RECITATION", "OTHER"}


class GeminiProvider:
    """Google Gemini image editing via generateContent (inline image + instruction)."""

    name = "gemini"

    def __init__(self, api_key: str, model: str):
        self._key = api_key
        self.model = model
        self._url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    async def generate(self, image: bytes, prompt: str, variant: int, tint_hex: str | None, timeout: float) -> bytes:
        text = prompt if variant == 0 else f"{prompt} (Alternative variation #{variant + 1}.)"
        body = {
            "contents": [{"role": "user", "parts": [
                {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(image).decode()}},
                {"text": text},
            ]}],
            "generationConfig": {"responseModalities": ["IMAGE"]},
        }
        try:
            async with httpx.AsyncClient(timeout=_timeout(timeout)) as client:
                res = await client.post(self._url, json=body, headers={"x-goog-api-key": self._key})
        except httpx.TransportError as exc:
            raise transport_error(self.name, exc) from exc
        if res.status_code != 200:
            raise http_error(self.name, res.status_code)
        data = res.json()
        if (data.get("promptFeedback") or {}).get("blockReason"):
            raise ProviderError("gemini_safety_blocked", retryable=False)
        candidate = (data.get("candidates") or [{}])[0]
        for part in candidate.get("content", {}).get("parts", []):
            b64 = (part.get("inlineData") or part.get("inline_data") or {}).get("data")
            if b64:
                return base64.b64decode(b64)
        if candidate.get("finishReason") in GEMINI_BLOCK_REASONS:
            raise ProviderError("gemini_safety_blocked", retryable=False)
        raise ProviderError("gemini_no_image", retryable=True)


REPLICATE_RESULT_HOSTS = ("replicate.delivery",)


class ReplicateProvider:
    """Replicate predictions API (default model: FLUX.1 Kontext Pro instruction editing)."""

    name = "replicate"

    def __init__(self, token: str, model: str):
        self._headers = {"Authorization": f"Bearer {token}"}
        self.model = model
        self._url = f"https://api.replicate.com/v1/models/{model}/predictions"

    async def generate(self, image: bytes, prompt: str, variant: int, tint_hex: str | None, timeout: float) -> bytes:
        payload = {"input": {
            "prompt": prompt,
            "input_image": "data:image/jpeg;base64," + base64.b64encode(image).decode(),
            "aspect_ratio": "match_input_image",
            "output_format": "jpg",
            "seed": 1000 + variant,
        }}
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        try:
            async with httpx.AsyncClient(timeout=_timeout(timeout)) as client:
                wait = max(1, min(60, int(timeout) - 5))
                res = await client.post(self._url, json=payload, headers={**self._headers, "Prefer": f"wait={wait}"})
                if res.status_code not in (200, 201):
                    raise http_error(self.name, res.status_code)
                pred = res.json()
                while pred.get("status") not in ("succeeded", "failed", "canceled"):
                    if loop.time() + 1.5 >= deadline:
                        raise ProviderError("replicate_timeout", retryable=True)
                    await asyncio.sleep(1.5)
                    poll = await client.get(pred["urls"]["get"], headers=self._headers)
                    if poll.status_code != 200:
                        raise http_error(self.name, poll.status_code)
                    pred = poll.json()
                status = pred.get("status")
                output = pred.get("output")
                if status == "canceled":
                    raise ProviderError("replicate_canceled", retryable=False)
                if status != "succeeded" or not output:
                    # Model-side failures (OOM, cold start) are usually transient.
                    raise ProviderError("replicate_failed", retryable=True)
                url = output[0] if isinstance(output, list) else output
                return await self._download(client, url)
        except httpx.TransportError as exc:
            raise transport_error(self.name, exc) from exc

    @staticmethod
    async def _download(client: httpx.AsyncClient, url: str) -> bytes:
        # EXT: never follow an arbitrary URL from a provider response — https + delivery CDN only.
        parsed = urlparse(url)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or not any(host == h or host.endswith("." + h) for h in REPLICATE_RESULT_HOSTS):
            raise ProviderError("replicate_untrusted_output_host", retryable=False)
        res = await client.get(url, follow_redirects=False)
        if res.status_code != 200:
            raise http_error("replicate_download", res.status_code)
        if len(res.content) > MAX_RESULT_BYTES:
            raise ProviderError("replicate_result_too_large", retryable=False)
        return res.content


FAL_RESULT_HOSTS = ("fal.media", "fal.run", "fal.ai")


class FalProvider:
    """fal.ai FLUX.2 [klein] instruction edit (input and output inline as data URIs with sync_mode)."""

    name = "falai"

    def __init__(self, key: str, model: str, transport: httpx.AsyncBaseTransport | None = None):
        self._headers = {"Authorization": f"Key {key}"}
        self.model = model
        self._url = f"https://fal.run/{model}"
        self._transport = transport

    async def generate(self, image: bytes, prompt: str, variant: int, tint_hex: str | None, timeout: float) -> bytes:
        with Image.open(io.BytesIO(image)) as src:
            w, h = src.size
        body = {
            "prompt": prompt,
            "image_urls": ["data:image/jpeg;base64," + base64.b64encode(image).decode()],
            "image_size": {"width": max(16, w // 16 * 16), "height": max(16, h // 16 * 16)},
            "num_images": 1,
            "seed": 1000 + variant,
            "output_format": "jpeg",
            "sync_mode": True,
            "enable_safety_checker": True,
        }
        try:
            async with httpx.AsyncClient(timeout=_timeout(timeout), transport=self._transport) as client:
                res = await client.post(self._url, json=body, headers=self._headers)
                if res.status_code != 200:
                    raise http_error(self.name, res.status_code)
                data = res.json()
                nsfw = data.get("has_nsfw_concepts")
                if isinstance(nsfw, list) and nsfw and nsfw[0]:
                    raise ProviderError("falai_safety_blocked", retryable=False)
                images = data.get("images")
                if not isinstance(images, list) or not images or not isinstance(images[0], dict):
                    raise ProviderError("falai_bad_output", retryable=False)
                url = images[0].get("url")
                if isinstance(url, str) and url.startswith("data:"):
                    return base64.b64decode(url.split(",", 1)[1])
                return await self._download(client, url)
        except httpx.TransportError as exc:
            raise transport_error(self.name, exc) from exc

    @staticmethod
    async def _download(client: httpx.AsyncClient, url: object) -> bytes:
        # EXT: only https results from fal's own CDN, never an arbitrary URL from the response.
        parsed = urlparse(url if isinstance(url, str) else "")
        host = parsed.hostname or ""
        if parsed.scheme != "https" or not any(host == h or host.endswith("." + h) for h in FAL_RESULT_HOSTS):
            raise ProviderError("falai_untrusted_output_host", retryable=False)
        res = await client.get(parsed.geturl(), follow_redirects=False)
        if res.status_code != 200 or len(res.content) > MAX_RESULT_BYTES:
            raise ProviderError("falai_download_failed", retryable=True)
        return res.content


def create_provider(name: str, settings: Settings) -> ImageProvider:
    if name == "gemini":
        return GeminiProvider(settings.gemini_api_key or "", settings.gemini_image_model)
    if name == "replicate":
        return ReplicateProvider(settings.replicate_api_token or "", settings.replicate_model)
    if name == "falai":
        return FalProvider(settings.fal_key or "", settings.falai_edit_model)
    return MockProvider()


def create_providers(settings: Settings) -> list[ImageProvider]:
    """Primary first, then IMAGE_FALLBACKS in order."""
    return [create_provider(name, settings) for name in settings.provider_chain]
