"""Capture-quality gate (API.md §7.4): cheap CPU checks so obviously bad photos get a warning before a
paid GPU call. Advisory only — the backend shows the issues, it never blocks the upload."""

import io

from PIL import Image, ImageFilter, ImageStat

from .schemas import QualityMetrics, QualityResponse

ANALYSIS_SIDE = 512
TOO_DARK_BELOW = 55.0        # mean luminance
TOO_BRIGHT_ABOVE = 235.0
LOW_CONTRAST_BELOW = 18.0    # luminance standard deviation
BLURRY_BELOW = 8.0           # 100 × mean edge strength / contrast; heavy blur lands ≈ 6–7.5
LOW_RES_SHORT_SIDE = 512

PENALTY = {"too_dark": 40, "too_bright": 30, "blurry": 35, "low_res": 25, "low_contrast": 20}


def assess(image: bytes) -> QualityResponse:
    with Image.open(io.BytesIO(image)) as src:
        width, height = src.size
        gray = src.convert("L")
    gray.thumbnail((ANALYSIS_SIDE, ANALYSIS_SIDE))
    stat = ImageStat.Stat(gray)
    brightness = stat.mean[0]
    contrast = stat.stddev[0]
    edges = ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).mean[0]
    # Normalising by contrast keeps a dim-but-sharp photo from reading as blurry.
    sharpness = 100.0 * edges / max(contrast, 1.0)

    issues: list[str] = []
    if brightness < TOO_DARK_BELOW:
        issues.append("too_dark")
    elif brightness > TOO_BRIGHT_ABOVE:
        issues.append("too_bright")
    if contrast < LOW_CONTRAST_BELOW:
        issues.append("low_contrast")
    elif sharpness < BLURRY_BELOW:
        issues.append("blurry")
    if min(width, height) < LOW_RES_SHORT_SIDE:
        issues.append("low_res")

    score = max(0, 100 - sum(PENALTY[i] for i in issues))
    return QualityResponse(
        score=score,
        issues=issues,  # type: ignore[arg-type]
        metrics=QualityMetrics(
            brightness=round(brightness, 1), contrast=round(contrast, 1), sharpness=round(sharpness, 2),
            width=width, height=height,
        ),
    )
