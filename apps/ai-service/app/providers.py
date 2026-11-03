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

TIMEOUT = httpx.Timeout(120.0, connect=10.0)
MAX_RESULT_BYTES = 20 * 1024 * 1024


class ProviderError(RuntimeError):
    pass


class ImageProvider(Protocol):
    name: str

    async def generate(self, image: bytes, prompt: str, variant: int, tint_hex: str | None) -> bytes: ...


def _tint_from(seed: str) -> tuple[int, int, int]:
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:6], 16) / 0xFFFFFF
    r, g, b = colorsys.hls_to_rgb(h, 0.55, 0.45)
    return int(r * 255), int(g * 255), int(b * 255)


class MockProvider:
    """Offline, deterministic colour-grade so the whole product works without any paid API key."""

    name = "mock"

    async def generate(self, image: bytes, prompt: str, variant: int, tint_hex: str | None) -> bytes:
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
        label = f"AI ROOM · DEMO · V{variant + 1}"
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


class GeminiProvider:
    """Google Gemini image editing via generateContent (inline image + instruction)."""

    name = "gemini"

    def __init__(self, api_key: str, model: str):
        self._key = api_key
        self._url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    async def generate(self, image: bytes, prompt: str, variant: int, tint_hex: str | None) -> bytes:
        text = prompt if variant == 0 else f"{prompt} (Alternative variation #{variant + 1}.)"
        body = {
            "contents": [{"role": "user", "parts": [
                {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(image).decode()}},
                {"text": text},
            ]}],
            "generationConfig": {"responseModalities": ["IMAGE"]},
        }
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.post(self._url, json=body, headers={"x-goog-api-key": self._key})
        if res.status_code != 200:
            raise ProviderError(f"gemini_http_{res.status_code}")
        parts = (res.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        for part in parts:
            data = (part.get("inlineData") or part.get("inline_data") or {}).get("data")
            if data:
                return base64.b64decode(data)
        raise ProviderError("gemini_no_image")


REPLICATE_RESULT_HOSTS = ("replicate.delivery",)


class ReplicateProvider:
    """Replicate predictions API (default model: FLUX.1 Kontext Pro instruction editing)."""

    name = "replicate"

    def __init__(self, token: str, model: str):
        self._headers = {"Authorization": f"Bearer {token}"}
        self._url = f"https://api.replicate.com/v1/models/{model}/predictions"

    async def generate(self, image: bytes, prompt: str, variant: int, tint_hex: str | None) -> bytes:
        payload = {"input": {
            "prompt": prompt,
            "input_image": "data:image/jpeg;base64," + base64.b64encode(image).decode(),
            "aspect_ratio": "match_input_image",
            "output_format": "jpg",
            "seed": 1000 + variant,
        }}
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.post(self._url, json=payload, headers={**self._headers, "Prefer": "wait=60"})
            if res.status_code not in (200, 201):
                raise ProviderError(f"replicate_http_{res.status_code}")
            pred = res.json()
            for _ in range(80):
                if pred.get("status") in ("succeeded", "failed", "canceled"):
                    break
                await asyncio.sleep(1.5)
                poll = await client.get(pred["urls"]["get"], headers=self._headers)
                if poll.status_code != 200:
                    raise ProviderError(f"replicate_poll_{poll.status_code}")
                pred = poll.json()
            output = pred.get("output")
            if pred.get("status") != "succeeded" or not output:
                raise ProviderError(f"replicate_{pred.get('status')}")
            url = output[0] if isinstance(output, list) else output
            return await self._download(client, url)

    @staticmethod
    async def _download(client: httpx.AsyncClient, url: str) -> bytes:
        # EXT: never follow an arbitrary URL from a provider response — https + delivery CDN only.
        parsed = urlparse(url)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or not any(host == h or host.endswith("." + h) for h in REPLICATE_RESULT_HOSTS):
            raise ProviderError("replicate_untrusted_output_host")
        res = await client.get(url, follow_redirects=False)
        if res.status_code != 200 or len(res.content) > MAX_RESULT_BYTES:
            raise ProviderError("replicate_download_failed")
        return res.content


def create_provider(settings: Settings) -> ImageProvider:
    if settings.image_provider == "gemini":
        return GeminiProvider(settings.gemini_api_key or "", settings.gemini_image_model)
    if settings.image_provider == "replicate":
        return ReplicateProvider(settings.replicate_api_token or "", settings.replicate_model)
    return MockProvider()
