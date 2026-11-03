"""Region lock for local edits (pattern from palemi falai.py + edit_qa.py).

For paint / flooring / replace / targeted declutter the target region is segmented first (fal.ai SAM 3,
or a clearly labelled geometric heuristic in mock/demo mode). Whatever the image model returns, only the
pixels inside that mask are taken from it — windows, doors and everything else keep the user's own pixels
(only JPEG re-encoding noise). This is the main complaint about competitors ("the AI changed my windows").
"""

from __future__ import annotations

import base64
import binascii
import io
from dataclasses import dataclass
from typing import Protocol

import httpx
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

from .prompts import clean
from .providers import ProviderError, http_error, transport_error
from .schemas import GenerateRequest

FAL_RUN = "https://fal.run"
SEG_MIN_SCORE = 0.5
SEG_MAX_MASKS = 4
MIN_COVERAGE = 0.005  # < 0.5 % of the image: segmentation found nothing usable
MAX_COVERAGE = 0.95  # > 95 %: not a local edit any more
FEATHER_PX = 3


def region_target(req: GenerateRequest) -> str | None:
    """The thing to segment, or None when the tool edits the whole scene."""
    if req.tool == "paint":
        return "wall"
    if req.tool == "flooring":
        return "floor"
    if req.tool == "replace":
        return clean(req.target, 60) or "sofa"
    if req.tool == "declutter" and not req.remove_all and req.target:
        return clean(req.target, 60) or None
    return None


@dataclass
class RegionMask:
    mask: Image.Image  # L, 0/255, same size as the source
    method: str  # "sam3" | "heuristic"
    cost_usd: float

    @property
    def coverage(self) -> float:
        return ImageStat.Stat(self.mask).mean[0] / 255.0


class Segmenter(Protocol):
    method: str

    async def segment(self, image: bytes, target: str, timeout: float) -> RegionMask | None: ...


def _data_uri(data: bytes, mime: str = "image/jpeg") -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def _decode_data_uri(value: object) -> bytes:
    if not isinstance(value, str) or not value.startswith("data:") or "," not in value:
        raise ProviderError("falai_bad_output", retryable=False)
    try:
        return base64.b64decode(value.split(",", 1)[1], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ProviderError("falai_bad_output", retryable=False) from exc


def mask_from_image(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Provider mask → binary L mask at source size (alpha used only when it actually varies)."""
    gray = None
    if "A" in img.getbands():
        alpha = img.getchannel("A")
        lo, hi = alpha.getextrema()
        if lo != hi:
            gray = alpha
    if gray is None:
        gray = img.convert("L")
    return gray.point(lambda p: 255 if p >= 128 else 0).resize(size, Image.Resampling.NEAREST)


class FalSegmenter:
    """fal.ai SAM 3: text-prompted segmentation; masks come back inline (sync_mode) — no URL fetching."""

    method = "sam3"

    def __init__(self, key: str, model: str, cost_usd: float, transport: httpx.AsyncBaseTransport | None = None):
        self._headers = {"Authorization": f"Key {key}"}
        self._url = f"{FAL_RUN}/{model}"
        self._cost = cost_usd
        self._transport = transport

    async def segment(self, image: bytes, target: str, timeout: float) -> RegionMask | None:
        body = {
            "image_url": _data_uri(image), "prompt": target, "apply_mask": False, "sync_mode": True,
            "output_format": "png", "return_multiple_masks": True, "max_masks": SEG_MAX_MASKS, "include_scores": True,
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=min(10.0, timeout)), transport=self._transport) as client:
                res = await client.post(self._url, json=body, headers=self._headers)
        except httpx.TransportError as exc:
            raise transport_error("falai", exc) from exc
        if res.status_code != 200:
            raise http_error("falai", res.status_code)
        data = res.json()
        items = data.get("masks")
        if not isinstance(items, list):
            raise ProviderError("falai_bad_output", retryable=False)
        scores = data.get("scores") if isinstance(data.get("scores"), list) else []
        with Image.open(io.BytesIO(image)) as src:
            size = src.size
        union = Image.new("L", size, 0)
        for i, item in enumerate(items[:SEG_MAX_MASKS]):
            score = scores[i] if i < len(scores) and isinstance(scores[i], (int, float)) else None
            if score is not None and score < SEG_MIN_SCORE:
                continue
            raw = _decode_data_uri(item.get("url") if isinstance(item, dict) else None)
            with Image.open(io.BytesIO(raw)) as m:
                union = ImageChops.lighter(union, mask_from_image(m, size))
        return RegionMask(mask=union, method=self.method, cost_usd=self._cost)


class HeuristicSegmenter:
    """Mock/demo only: fixed geometric regions so the region-lock flow works without any key."""

    method = "heuristic"

    async def segment(self, image: bytes, target: str, timeout: float) -> RegionMask | None:
        with Image.open(io.BytesIO(image)) as src:
            w, h = src.size
        mask = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask)
        if target == "floor":
            draw.rectangle((0, int(h * 0.68), w, h), fill=255)
        elif target == "wall":
            draw.rectangle((int(w * 0.24), int(h * 0.18), int(w * 0.76), int(h * 0.66)), fill=255)
        else:
            draw.ellipse((int(w * 0.30), int(h * 0.45), int(w * 0.70), int(h * 0.80)), fill=255)
        return RegionMask(mask=mask, method=self.method, cost_usd=0.0)


def usable(region: RegionMask | None) -> bool:
    return region is not None and MIN_COVERAGE <= region.coverage <= MAX_COVERAGE


def composite(original: bytes, generated: bytes, mask: Image.Image, feather: int = FEATHER_PX) -> bytes:
    """Generated pixels inside the mask, original pixels everywhere else (soft edge of `feather` px)."""
    with Image.open(io.BytesIO(original)) as o, Image.open(io.BytesIO(generated)) as g:
        base = o.convert("RGB")
        top = g.convert("RGB").resize(base.size, Image.Resampling.LANCZOS)
    alpha = mask.resize(base.size, Image.Resampling.NEAREST)
    if feather > 0:
        alpha = alpha.filter(ImageFilter.MaxFilter(feather * 2 + 1)).filter(ImageFilter.GaussianBlur(feather))
    out = io.BytesIO()
    Image.composite(top, base, alpha).save(out, format="JPEG", quality=92)
    return out.getvalue()


def masked_mean_abs_diff(a: bytes, b: bytes, mask: Image.Image, side: int = 256) -> float:
    """Mean absolute grayscale difference inside the mask only (so small local edits aren't 'no change')."""
    with Image.open(io.BytesIO(a)) as ia, Image.open(io.BytesIO(b)) as ib:
        ga = ia.convert("L").resize((side, side))
        gb = ib.convert("L").resize((side, side))
    m = mask.resize((side, side), Image.Resampling.NEAREST)
    diff = ImageChops.difference(ga, gb)
    covered = ImageStat.Stat(m).sum[0] / 255.0
    if covered < 1:
        return 0.0
    return ImageStat.Stat(ImageChops.multiply(diff, m)).sum[0] / covered


def create_segmenter(fal_key: str | None, model: str, cost_usd: float, image_provider: str) -> Segmenter | None:
    if fal_key:
        return FalSegmenter(fal_key, model, cost_usd)
    if image_provider == "mock":
        return HeuristicSegmenter()
    return None  # real provider without SAM: no region lock (never fake it with the heuristic)
