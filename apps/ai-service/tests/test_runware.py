"""Runware fallback provider (API.md §7.27): task request, inline base64 or hosted result, host allow-list."""

import base64
import io

import httpx
import pytest
from PIL import Image

from app.providers import ProviderError, RunwareProvider


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (10, 120, 30)).save(buf, format="JPEG")
    return buf.getvalue()


def handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/v1" and request.method == "POST":
        body = b'{"data": [{"taskType": "imageInference", "imageBase64Data": "%s"}]}' % base64.b64encode(png())
        return httpx.Response(200, content=body)
    return httpx.Response(404)


def hosted(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/v1":
        return httpx.Response(200, json={"data": [{"imageURL": "https://im.runware.ai/result/1.jpg"}]})
    if request.url.host == "im.runware.ai":
        return httpx.Response(200, content=png())
    return httpx.Response(404)


def evil_host(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"data": [{"imageURL": "https://evil.example/x.jpg"}]})


async def gen(transport) -> bytes:
    provider = RunwareProvider("key", "runware:101@1", transport=transport)
    return await provider.generate(png(), "paint the wall sage green", 0, None, 30.0)


async def test_inline_base64_result():
    out = await gen(httpx.MockTransport(handler))
    assert out == png()


async def test_hosted_result_from_runware_cdn():
    out = await gen(httpx.MockTransport(hosted))
    assert out == png()


async def test_untrusted_result_host_is_refused():
    with pytest.raises(ProviderError) as err:
        await gen(httpx.MockTransport(evil_host))
    assert err.value.code == "runware_untrusted_output_host"
    assert not err.value.retryable
