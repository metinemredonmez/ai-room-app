import base64
import binascii
import io

from PIL import Image, ImageChops, ImageStat, UnidentifiedImageError

# FIL-02: defence in depth — the backend already re-encoded the upload, but this service still
# refuses anything that is not a bounded raster image before handing it to a model.
Image.MAX_IMAGE_PIXELS = 50_000_000
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

# No-change detection (API.md §7.4): mean absolute difference on 256×256 grayscale thumbnails.
NO_CHANGE_SIDE = 256
NO_CHANGE_BELOW = 3.0


class ImageInputError(ValueError):
    pass


def decode_raw(b64: str, max_bytes: int) -> bytes:
    """Base64 → bytes of a verified JPEG/PNG/WEBP within the size limit (no re-encoding)."""
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImageInputError("invalid_base64") from exc
    if len(raw) > max_bytes:
        raise ImageInputError("image_too_large")
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            if probe.format not in ALLOWED_FORMATS:
                raise ImageInputError("unsupported_format")
            probe.verify()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as exc:
        raise ImageInputError("corrupt_image") from exc
    return raw


def decode_image(b64: str, max_bytes: int, max_side: int = 2048) -> bytes:
    raw = decode_raw(b64, max_bytes)
    try:
        with Image.open(io.BytesIO(raw)) as img:
            img = img.convert("RGB")
            img.thumbnail((max_side, max_side))
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=90)
            return out.getvalue()
    except (Image.DecompressionBombError, OSError, SyntaxError) as exc:
        raise ImageInputError("corrupt_image") from exc


def _thumb(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as img:
        return img.convert("L").resize((NO_CHANGE_SIDE, NO_CHANGE_SIDE))


def mean_abs_diff(a: bytes, b: bytes) -> float:
    """0 = identical. Outputs may change aspect ratio, so both sides are squashed to the same square."""
    return ImageStat.Stat(ImageChops.difference(_thumb(a), _thumb(b))).mean[0]


def is_unchanged(original: bytes, result: bytes) -> bool:
    return mean_abs_diff(original, result) < NO_CHANGE_BELOW


def to_b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")
