import base64
import binascii
import io

from PIL import Image, UnidentifiedImageError

# FIL-02: defence in depth — the backend already re-encoded the upload, but this service still
# refuses anything that is not a bounded raster image before handing it to a model.
Image.MAX_IMAGE_PIXELS = 50_000_000
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


class ImageInputError(ValueError):
    pass


def decode_image(b64: str, max_bytes: int, max_side: int = 2048) -> bytes:
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
        with Image.open(io.BytesIO(raw)) as img:
            img = img.convert("RGB")
            img.thumbnail((max_side, max_side))
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=90)
            return out.getvalue()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as exc:
        raise ImageInputError("corrupt_image") from exc


def to_b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")
