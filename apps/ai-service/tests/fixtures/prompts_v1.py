# Frozen copy of app/prompts.py before panel-managed templates (API.md §7.26). The default templates must render
# exactly what this produced; tests/test_prompts.py compares them on many inputs. Do not edit.
import re
import unicodedata

from app.schemas import GenerateRequest

KEEP_STRUCTURE = (
    "Keep the exact same camera angle, perspective, room geometry, walls, windows, doors and ceiling. "
    "Photorealistic, natural light, high detail, professional interior photography."
)
DEFAULT_STYLE = "modern interior: clean lines, neutral palette with warm wood accents, layered lighting"

_UNSAFE = re.compile(r"[\x00-\x1f\x7f<>{}`\"]")
# "k a n e p e" → "kanepe": four or more single letters separated by single spaces.
_SPACED = re.compile(r"(?<!\S)(?:\w ){3,}\w(?!\S)")
_TR_LOWER = str.maketrans({"I": "ı", "İ": "i"})


def normalize_tr(text: str) -> str:
    """Pattern from the yoga guardrail: invisible characters out, Turkish-aware casefold (I→ı, İ→i),
    spaced-out letters joined — so obfuscated text reads the same as plain text. No blocking."""
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Cf")
    text = text.translate(_TR_LOWER).lower()
    return _SPACED.sub(lambda m: m.group(0).replace(" ", ""), text)


def clean(text: str | None, limit: int = 200, user_text: bool = False) -> str:
    """Free text is flattened and quoted as data inside the template, never as instructions.
    `user_text=True` additionally applies the Turkish normalisation (homeowner input only)."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = _UNSAFE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if user_text:
        text = normalize_tr(text)
    return text[:limit]


def build_prompt(req: GenerateRequest, reference_style: str | None = None, area: str = "") -> str:
    """`area` is where a tap selection lies (region.describe_area); empty without one."""
    room = clean(req.room, 60) or "room"
    style = clean(req.style_prompt, 600) or DEFAULT_STYLE
    target = clean(req.target, 120, user_text=True)
    replacement = clean(req.replacement, 120, user_text=True)
    extra = clean(req.instructions, 300, user_text=True)
    extra_line = f' Additional request from the homeowner: "{extra}".' if extra else ""
    where = f" {area}" if area else ""
    selected = (f'"{target}"' if target else "selected object") + where

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
            if area:
                what = f"the {selected}"
            else:
                what = f'the "{target}"' if target else "clutter, cables, personal items and mess"
            return (
                f"Remove {what} from this {room}. Fill the removed areas plausibly so no trace remains. "
                f"Change nothing else. {KEEP_STRUCTURE}"
            )
        case "replace":
            thing = selected if area else f'"{target or "main sofa"}"'
            return (
                f'In this {room}, replace the {thing} with "{replacement or "a modern alternative"}", '
                f"matching the room's lighting, scale and perspective. Change nothing else. {KEEP_STRUCTURE}"
            )
        case "paint":
            color = (
                f"{clean(req.color_name, 40, user_text=True) or 'the chosen colour'} ({req.color_hex})"
                if req.color_hex
                else "a warm off-white"
            )
            walls = f"only the wall{where}" if area else "the walls"
            return (
                f"Repaint {walls} of this {room} in {color} with a matte finish. Keep furniture, floor, "
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
