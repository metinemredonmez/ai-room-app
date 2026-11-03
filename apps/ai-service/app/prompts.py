import re
import unicodedata

from .schemas import GenerateRequest

KEEP_STRUCTURE = (
    "Keep the exact same camera angle, perspective, room geometry, walls, windows, doors and ceiling. "
    "Photorealistic, natural light, high detail, professional interior photography."
)
DEFAULT_STYLE = "modern interior: clean lines, neutral palette with warm wood accents, layered lighting"

_UNSAFE = re.compile(r"[\x00-\x1f\x7f<>{}`\"]")


def clean(text: str | None, limit: int = 200) -> str:
    """User free text is flattened and quoted as data inside the template, never as instructions."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = _UNSAFE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def build_prompt(req: GenerateRequest, reference_style: str | None = None) -> str:
    room = clean(req.room, 60) or "room"
    style = clean(req.style_prompt, 600) or DEFAULT_STYLE
    target = clean(req.target, 120)
    replacement = clean(req.replacement, 120)
    extra = clean(req.instructions, 300)
    extra_line = f' Additional request from the homeowner: "{extra}".' if extra else ""

    match req.tool:
        case "redesign":
            return (
                f"Redesign this {room} as a {style}. Replace furniture, decor, textiles, lighting and finishes "
                f"to match the style. {KEEP_STRUCTURE}{extra_line}"
            )
        case "furnish":
            return (
                f"This is an empty or nearly empty {room}. Virtually stage it as a fully furnished {style}, "
                f"with realistic scale furniture placed sensibly for the space. {KEEP_STRUCTURE}{extra_line}"
            )
        case "declutter":
            if req.remove_all:
                return (
                    f"Remove all furniture, decor and objects from this {room}, leaving a clean empty room with "
                    f"bare walls and floor. Reconstruct hidden areas plausibly. {KEEP_STRUCTURE}"
                )
            what = f'the "{target}"' if target else "clutter, cables, personal items and mess"
            return (
                f"Remove {what} from this {room}. Fill the removed areas plausibly so no trace remains. "
                f"Change nothing else. {KEEP_STRUCTURE}"
            )
        case "replace":
            return (
                f'In this {room}, replace the "{target or "main sofa"}" with "{replacement or "a modern alternative"}", '
                f"matching the room's lighting, scale and perspective. Change nothing else. {KEEP_STRUCTURE}"
            )
        case "paint":
            color = (
                f"{clean(req.color_name, 40) or 'the chosen colour'} ({req.color_hex})"
                if req.color_hex
                else "a warm off-white"
            )
            return (
                f"Repaint the walls of this {room} in {color} with a matte finish. Keep furniture, floor, "
                f"ceiling and everything else unchanged. {KEEP_STRUCTURE}"
            )
        case "flooring":
            floor = clean(req.floor, 80) or "natural oak plank parquet"
            return (
                f"Replace the floor of this {room} with {floor}, with correct perspective, reflections and "
                f"shadows. Keep everything else unchanged. {KEEP_STRUCTURE}"
            )
        case "exterior":
            return (
                f"Redesign the exterior facade of this house inspired by this style: {style}. Update cladding, "
                "colours, window frames, lighting and entrance; keep the building's shape, size and camera angle. "
                f"Photorealistic architectural photography.{extra_line}"
            )
        case "garden":
            return (
                f"Redesign this garden or outdoor space as a beautifully landscaped area with this mood: {style}. "
                "Add planting beds, paths, outdoor seating and lighting. Keep the property boundaries, house and "
                f"camera angle. Photorealistic landscape photography.{extra_line}"
            )
        case "reference":
            ref = clean(reference_style, 600) or style
            return f"Redesign this {room} to match this reference style: {ref}. {KEEP_STRUCTURE}{extra_line}"
        case "custom":
            return f'Edit this {room} photo. Requested change: "{extra or "refresh the decor"}". {KEEP_STRUCTURE}'
    raise ValueError("unknown tool")
