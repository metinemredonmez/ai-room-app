"""API.md §7.8: region lock (SAM 3 mask + composite) and the fal.ai providers."""

import asyncio
import base64
import io
import json
import os

os.environ.setdefault("INTERNAL_TOKEN", "test-internal-token-0123456789abcdef0123")
os.environ.setdefault("IMAGE_PROVIDER", "mock")
os.environ.pop("ANTHROPIC_API_KEY", None)

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, ImageChops, ImageDraw, ImageStat  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.providers import FalProvider, ProviderError  # noqa: E402
from app.prompts import build_prompt  # noqa: E402
from app.region import (  # noqa: E402
    FalSegmenter, HeuristicSegmenter, RegionMask, composite, create_segmenter, describe_area, masked_mean_abs_diff,
    region_target, selection_points, usable,
)
from app.schemas import GenerateRequest  # noqa: E402

TOKEN = os.environ["INTERNAL_TOKEN"]
AUTH = {"X-Internal-Token": TOKEN}


def settings(**overrides) -> Settings:
    return Settings(INTERNAL_TOKEN=TOKEN, IMAGE_PROVIDER="mock", **overrides)  # type: ignore[call-arg]


def jpeg(img: Image.Image, fmt: str = "JPEG") -> bytes:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def room(size=(640, 480)) -> bytes:
    img = Image.new("RGB", size, (226, 214, 196))
    d = ImageDraw.Draw(img)
    w, h = size
    d.rectangle((0, int(h * 0.7), w, h), fill=(150, 110, 75))
    d.rectangle((int(w * 0.42), int(h * 0.2), int(w * 0.62), int(h * 0.45)), fill=(160, 200, 230))
    return jpeg(img)


def left_half_mask(size=(640, 480)) -> Image.Image:
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rectangle((0, 0, size[0] // 2 - 1, size[1]), fill=255)
    return m


def region_diff(a: bytes, b: bytes, box) -> float:
    with Image.open(io.BytesIO(a)) as ia, Image.open(io.BytesIO(b)) as ib:
        return ImageStat.Stat(ImageChops.difference(ia.convert("L").crop(box), ib.convert("L").crop(box))).mean[0]


def req(tool: str, **kw) -> GenerateRequest:
    return GenerateRequest(tool=tool, image_b64="x" * 100, **kw)  # type: ignore[arg-type]


def test_region_target_only_for_local_edits():
    assert region_target(req("paint")) == "wall"
    assert region_target(req("flooring")) == "floor"
    assert region_target(req("replace", target="koltuk")) == "koltuk"
    assert region_target(req("replace")) == "sofa"
    assert region_target(req("declutter", target="lamp")) == "lamp"
    assert region_target(req("declutter", remove_all=True, target="lamp")) is None
    assert region_target(req("declutter")) is None
    for tool in ("redesign", "furnish", "exterior", "garden", "custom"):
        assert region_target(req(tool)) is None


def test_composite_keeps_pixels_outside_the_mask():
    original = room()
    generated = jpeg(Image.new("RGB", (640, 480), (20, 120, 60)))
    out = composite(original, generated, left_half_mask(), feather=0)
    assert Image.open(io.BytesIO(out)).size == (640, 480)
    assert region_diff(original, out, (330, 0, 640, 480)) < 2  # right half: the user's photo (JPEG noise only)
    assert region_diff(original, out, (0, 0, 310, 480)) > 40  # left half: the model's pixels


def test_composite_resizes_a_different_sized_output():
    out = composite(room(), jpeg(Image.new("RGB", (512, 512), (0, 0, 0))), left_half_mask())
    assert Image.open(io.BytesIO(out)).size == (640, 480)


def test_masked_diff_sees_small_local_edits():
    original = room()
    untouched = composite(original, jpeg(Image.new("RGB", (640, 480), (20, 120, 60))), Image.new("L", (640, 480), 0), 0)
    small = Image.new("L", (640, 480), 0)
    ImageDraw.Draw(small).rectangle((0, 0, 80, 80), fill=255)  # ~2 % of the image
    changed = composite(original, jpeg(Image.new("RGB", (640, 480), (20, 120, 60))), small, 0)
    assert masked_mean_abs_diff(original, untouched, small) < 3
    assert masked_mean_abs_diff(original, changed, small) > 40
    assert masked_mean_abs_diff(original, changed, Image.new("L", (640, 480), 0)) == 0.0


def test_heuristic_masks_are_usable_and_labelled():
    async def run():
        seg = HeuristicSegmenter()
        return [await seg.segment(room(), t, 5) for t in ("wall", "floor", "sofa")]

    for mask in asyncio.run(run()):
        assert mask.method == "heuristic" and mask.cost_usd == 0 and usable(mask)
    assert not usable(None)
    assert not usable(RegionMask(Image.new("L", (100, 100), 0), "sam3", 0))
    assert not usable(RegionMask(Image.new("L", (100, 100), 255), "sam3", 0))


def test_create_segmenter_never_fakes_a_mask_for_real_providers():
    assert isinstance(create_segmenter("k" * 20, "fal-ai/sam-3/image", 0.005, "gemini"), FalSegmenter)
    assert isinstance(create_segmenter(None, "m", 0, "mock"), HeuristicSegmenter)
    assert create_segmenter(None, "m", 0, "gemini") is None


def data_uri(data: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def test_fal_segmenter_unions_confident_masks():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["auth"], seen["body"] = str(request.url), request.headers["authorization"], json.loads(request.content)
        top = Image.new("L", (320, 240), 0)
        ImageDraw.Draw(top).rectangle((0, 0, 319, 59), fill=255)
        low = Image.new("L", (320, 240), 0)
        ImageDraw.Draw(low).rectangle((0, 180, 319, 239), fill=255)
        return httpx.Response(200, json={
            "masks": [{"url": data_uri(jpeg(top, "PNG"), "image/png")}, {"url": data_uri(jpeg(low, "PNG"), "image/png")}],
            "scores": [0.91, 0.2],  # second mask below SEG_MIN_SCORE: ignored
        })

    seg = FalSegmenter("fal-test-key", "fal-ai/sam-3/image", 0.005, transport=httpx.MockTransport(handler))
    mask = asyncio.run(seg.segment(room(), "wall", 10))
    assert seen["url"] == "https://fal.run/fal-ai/sam-3/image" and seen["auth"] == "Key fal-test-key"
    assert seen["body"]["prompt"] == "wall" and seen["body"]["sync_mode"] is True
    assert seen["body"]["image_url"].startswith("data:image/jpeg;base64,")
    assert mask is not None and mask.mask.size == (640, 480) and mask.method == "sam3" and mask.cost_usd == 0.005
    assert 0.2 < mask.coverage < 0.3  # top quarter only, upscaled to the source size


@pytest.mark.parametrize("status,body,retryable", [(503, {}, True), (200, {"masks": "nope"}, False),
                                                   (200, {"masks": [{"url": "https://evil.example/m.png"}]}, False)])
def test_fal_segmenter_errors(status, body, retryable):
    seg = FalSegmenter("k", "m", 0, transport=httpx.MockTransport(lambda _: httpx.Response(status, json=body)))
    with pytest.raises(ProviderError) as err:
        asyncio.run(seg.segment(room(), "wall", 5))
    assert err.value.retryable is retryable


def test_fal_provider_edit_request_and_output():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"images": [{"url": data_uri(jpeg(Image.new("RGB", (640, 480), (9, 9, 9))), "image/jpeg")}],
                                         "has_nsfw_concepts": [False]})

    provider = FalProvider("k", "fal-ai/flux-2/klein/4b/edit", transport=httpx.MockTransport(handler))
    out = asyncio.run(provider.generate(jpeg(Image.new("RGB", (650, 490))), "paint the walls", 2, None, 10))
    assert Image.open(io.BytesIO(out)).size == (640, 480)
    body = seen["body"]
    assert body["image_size"] == {"width": 640, "height": 480} and body["seed"] == 1002
    assert body["enable_safety_checker"] is True and body["image_urls"][0].startswith("data:image/jpeg;base64,")


def test_fal_provider_safety_block_and_untrusted_hosts_are_final():
    for payload, code in [({"images": [{"url": "data:image/jpeg;base64,AAAA"}], "has_nsfw_concepts": [True]}, "falai_safety_blocked"),
                          ({"images": [{"url": "https://169.254.169.254/latest"}]}, "falai_untrusted_output_host"),
                          ({"images": [{"url": "http://v3.fal.media/x.jpg"}]}, "falai_untrusted_output_host"),
                          ({"images": []}, "falai_bad_output")]:
        provider = FalProvider("k", "m", transport=httpx.MockTransport(lambda _, p=payload: httpx.Response(200, json=p)))
        with pytest.raises(ProviderError) as err:
            asyncio.run(provider.generate(room(), "x", 0, None, 5))
        assert err.value.code == code and err.value.retryable is False


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def test_paint_is_region_locked_in_mock_mode():
    client = TestClient(create_app(settings()))
    original = room()
    res = client.post("/internal/v1/generate", headers=AUTH,
                      json={"tool": "paint", "image_b64": b64(original), "color_hex": "#3A6B4F", "variants": 1})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["region"] == {"applied": True, "target": "wall", "method": "heuristic",
                              "coverage": pytest.approx(0.252, abs=0.01), "reason": None}
    out = base64.b64decode(body["images_b64"][0])
    assert region_diff(original, out, (0, 340, 640, 480)) < 3  # floor untouched (outside the wall mask)
    assert region_diff(original, out, (170, 100, 470, 300)) > 10  # wall repainted


def test_whole_scene_tools_and_lock_off_have_no_region():
    original = b64(room())
    on = TestClient(create_app(settings()))
    assert on.post("/internal/v1/generate", headers=AUTH, json={"tool": "redesign", "image_b64": original}).json()["region"] is None
    off = TestClient(create_app(settings(REGION_LOCK="off")))
    assert off.post("/internal/v1/generate", headers=AUTH, json={"tool": "paint", "image_b64": original}).json()["region"] is None


class FixedSegmenter:
    method = "sam3"

    def __init__(self, mask: Image.Image | None = None, error: Exception | None = None, cost: float = 0.005):
        self.mask, self.error, self.cost = mask, error, cost

    async def segment(self, image, target, timeout, points=None):
        self.points = points
        if self.error:
            raise self.error
        return RegionMask(self.mask, self.method, self.cost)


def test_segmenter_cost_is_billed_and_failures_do_not_fail_the_design():
    original = b64(room())
    ok = TestClient(create_app(settings(), segmenter=FixedSegmenter(left_half_mask())))
    body = ok.post("/internal/v1/generate", headers=AUTH, json={"tool": "flooring", "image_b64": original}).json()
    assert body["region"]["applied"] and body["region"]["method"] == "sam3"
    assert body["usage"]["cost_usd"] == pytest.approx(0.005)  # mock image is free, the mask is not

    broken = TestClient(create_app(settings(), segmenter=FixedSegmenter(error=ProviderError("falai_http_503", True))))
    res = broken.post("/internal/v1/generate", headers=AUTH, json={"tool": "flooring", "image_b64": original})
    assert res.status_code == 200
    assert res.json()["region"] == {"applied": False, "target": "floor", "method": "none", "coverage": 0.0,
                                    "reason": "segmentation_failed"}
    assert res.json()["usage"]["cost_usd"] == 0

    empty = TestClient(create_app(settings(), segmenter=FixedSegmenter(Image.new("L", (640, 480), 0))))
    region = empty.post("/internal/v1/generate", headers=AUTH, json={"tool": "flooring", "image_b64": original}).json()["region"]
    assert region["applied"] is False and region["reason"] == "mask_unusable"


# --- §7.15 tap selection ---------------------------------------------------------------------------------------

TAP = [{"x": 0.25, "y": 0.6}]


def test_tap_selection_targets_and_area():
    assert region_target(req("replace", points=TAP)) == "selection"
    assert region_target(req("replace", points=TAP, target="yastık")) == "yastık"
    assert region_target(req("paint", points=TAP)) == "selection"
    assert selection_points(req("declutter", points=TAP)) == [(0.25, 0.6)]
    assert selection_points(req("replace")) is None
    m = Image.new("L", (200, 100), 0)
    ImageDraw.Draw(m).rectangle((50, 40, 99, 79), fill=255)
    assert describe_area(m) == "in the area 25–50 % from the left and 40–80 % from the top of the photo"
    assert describe_area(Image.new("L", (10, 10), 0)) == ""


def test_prompt_names_the_selected_area():
    area = "in the area 25–50 % from the left and 40–80 % from the top of the photo"
    p = build_prompt(req("replace", points=TAP, replacement="hardal kadife yastık"), area=area)
    assert f"replace the selected object {area}" in p and '"hardal kadife yastık"' in p
    assert f'replace the "koltuk" {area}' in build_prompt(req("replace", points=TAP, target="koltuk"), area=area)
    assert f"Remove the selected object {area}" in build_prompt(req("declutter", points=TAP), area=area)
    assert f"Repaint only the wall {area}" in build_prompt(req("paint", points=TAP, color_hex="#3A6B4F"), area=area)
    assert "Repaint the walls" in build_prompt(req("paint"))  # no selection: unchanged


def test_fal_segmenter_sends_one_point_prompt_per_tap():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        m = Image.new("L", (640, 480), 0)
        ImageDraw.Draw(m).rectangle((100, 250, 220, 330), fill=255)
        return httpx.Response(200, json={"masks": [{"url": data_uri(jpeg(m, "PNG"), "image/png")}], "scores": [0.9]})

    seg = FalSegmenter("k", "fal-ai/sam-3/image", 0.005, transport=httpx.MockTransport(handler))
    mask = asyncio.run(seg.segment(room(), "selection", 10, [(0.25, 0.6), (0.75, 0.5)]))
    body = seen["body"]
    assert "prompt" not in body and body["max_masks"] == 2
    assert body["point_prompts"] == [{"x": 160, "y": 287, "label": 1, "object_id": 1},
                                     {"x": 479, "y": 240, "label": 1, "object_id": 2}]
    assert mask is not None and 0.02 < mask.coverage < 0.04


def test_heuristic_selection_is_drawn_around_the_taps():
    mask = asyncio.run(HeuristicSegmenter().segment(room(), "selection", 5, [(0.25, 0.6)]))
    assert mask is not None and usable(mask)
    assert mask.mask.getpixel((160, 288)) == 255 and mask.mask.getpixel((600, 40)) == 0


def test_tap_selection_changes_only_the_selected_object():
    client = TestClient(create_app(settings()))
    original = room()
    res = client.post("/internal/v1/generate", headers=AUTH, json={
        "tool": "replace", "image_b64": b64(original), "variants": 1, "points": TAP, "replacement": "rattan koltuk"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["region"]["applied"] and body["region"]["target"] == "selection" and body["region"]["method"] == "heuristic"
    assert "selected object in the area" in body["prompt"]
    out = base64.b64decode(body["images_b64"][0])
    assert region_diff(original, out, (420, 0, 640, 200)) < 3  # far from the tap: the user's own pixels


def test_tap_selection_fails_before_any_image_when_nothing_is_selected():
    seg = FixedSegmenter(Image.new("L", (640, 480), 0))
    client = TestClient(create_app(settings(), segmenter=seg))
    res = client.post("/internal/v1/generate", headers=AUTH, json={"tool": "declutter", "image_b64": b64(room()), "points": TAP})
    assert res.status_code == 422 and res.json()["error"]["code"] == "selection_failed"
    assert res.json()["usage"]["kind"] == "segment" and res.json()["usage"]["images"] == 0
    assert seg.points == [(0.25, 0.6)]


def test_tap_selection_unavailable_and_unsupported():
    off = TestClient(create_app(settings(REGION_LOCK="off")))
    res = off.post("/internal/v1/generate", headers=AUTH, json={"tool": "replace", "image_b64": b64(room()), "points": TAP})
    assert res.status_code == 503 and res.json()["error"]["code"] == "selection_unavailable"
    client = TestClient(create_app(settings()))
    for body in ({"tool": "redesign", "points": TAP}, {"tool": "declutter", "remove_all": True, "points": TAP}):
        res = client.post("/internal/v1/generate", headers=AUTH, json={**body, "image_b64": b64(room())})
        assert res.status_code == 400 and res.json()["error"]["code"] == "selection_not_supported"
    too_many = [{"x": 0.1, "y": 0.1}] * 9
    res = client.post("/internal/v1/generate", headers=AUTH, json={"tool": "replace", "image_b64": b64(room()), "points": too_many})
    assert res.status_code == 400


def test_segment_preview_returns_the_mask():
    client = TestClient(create_app(settings()))
    res = client.post("/internal/v1/segment", headers=AUTH, json={"image_b64": b64(room()), "points": TAP})
    assert res.status_code == 200, res.text
    body = res.json()
    mask = Image.open(io.BytesIO(base64.b64decode(body["mask_b64"])))
    assert mask.format == "PNG" and mask.size == (640, 480) and mask.getpixel((160, 288)) == 255
    assert body["method"] == "heuristic" and 0.05 < body["coverage"] < 0.2
    assert body["usage"]["kind"] == "segment" and body["usage"]["cost_usd"] == 0
    by_name = client.post("/internal/v1/segment", headers=AUTH, json={"image_b64": b64(room()), "target": "koltuk"})
    assert by_name.status_code == 200
    assert client.post("/internal/v1/segment", headers=AUTH, json={"image_b64": b64(room())}).status_code == 400
    assert client.post("/internal/v1/segment", json={"image_b64": b64(room()), "points": TAP}).status_code == 401
    paid = TestClient(create_app(settings(), segmenter=FixedSegmenter(left_half_mask())))
    usage = paid.post("/internal/v1/segment", headers=AUTH, json={"image_b64": b64(room()), "points": TAP}).json()["usage"]
    assert (usage["provider"], usage["model"], usage["cost_usd"]) == ("falai", "fal-ai/sam-3/image", 0.005)
