import re
import unicodedata

from .schemas import GenerateRequest

# Image prompts (API.md §7.26). Each tool's prompt is a template with named placeholders; the defaults below are the
# prompts the service always used, and the admin can publish a new version of any template from the panel (the backend
# sends the active ones with each request). The code still decides every value: user text is cleaned and quoted here,
# a template only places it, so a template cannot read anything the request did not already allow.

KEEP_STRUCTURE = (
    "Keep the exact same camera angle, perspective, room geometry, walls, windows, doors and ceiling. "
    "Photorealistic, natural light, high detail, professional interior photography."
)
DEFAULT_STYLE = "modern interior: clean lines, neutral palette with warm wood accents, layered lighting"

# key → (tool, default template, allowed placeholders, required placeholders). `keep` is the shared
# "keep the room as it is" sentence other templates insert with {keep}.
TEMPLATES: dict[str, tuple[str, str, tuple[str, ...], tuple[str, ...]]] = {
    "keep": ("", KEEP_STRUCTURE, (), ()),
    "redesign": (
        "redesign",
        "Redesign this {room} as a {style}. Replace furniture, decor, textiles, lighting and finishes "
        "to match the style. {keep}{extra}",
        ("room", "style", "keep", "extra"), ("style", "extra"),
    ),
    "furnish": (
        "furnish",
        "This is an empty or nearly empty {room}. Virtually stage it as a fully furnished {style}, "
        "with realistic scale furniture placed sensibly for the space. {keep}{extra}",
        ("room", "style", "keep", "extra"), ("style", "extra"),
    ),
    "declutter_all": (
        "declutter",
        "Remove all furniture, decor and objects from this {room}, leaving a clean empty room with "
        "bare walls and floor. Reconstruct hidden areas plausibly. {keep}",
        ("room", "keep"), (),
    ),
    "declutter": (
        "declutter",
        "Remove {what} from this {room}. Fill the removed areas plausibly so no trace remains. "
        "Change nothing else. {keep}",
        ("room", "what", "keep"), ("what",),
    ),
    "replace": (
        "replace",
        "In this {room}, replace the {thing} with {replacement}, "
        "matching the room's lighting, scale and perspective. Change nothing else. {keep}",
        ("room", "thing", "replacement", "keep"), ("thing", "replacement"),
    ),
    "paint": (
        "paint",
        "Repaint {walls} of this {room} in {color} with a matte finish. Keep furniture, floor, "
        "ceiling and everything else unchanged. {keep}",
        ("room", "walls", "color", "keep"), ("color",),
    ),
    "flooring": (
        "flooring",
        "Replace the floor of this {room} with {floor}, with correct perspective, reflections and "
        "shadows. Keep everything else unchanged. {keep}",
        ("room", "floor", "keep"), ("floor",),
    ),
    "exterior": (
        "exterior",
        "Redesign the exterior facade of this house inspired by this style: {style}. Update cladding, "
        "colours, window frames, lighting and entrance; keep the building's shape, size and camera angle. "
        "Photorealistic architectural photography.{extra}",
        ("style", "extra"), ("style", "extra"),
    ),
    "garden": (
        "garden",
        "Redesign this garden or outdoor space as a beautifully landscaped area with this mood: {style}. "
        "Add planting beds, paths, outdoor seating and lighting. Keep the property boundaries, house and "
        "camera angle. Photorealistic landscape photography.{extra}",
        ("style", "extra"), ("style", "extra"),
    ),
    "reference": (
        "reference",
        "Redesign this {room} to match this reference style: {reference}. {keep}{extra}",
        ("room", "reference", "keep", "extra"), ("reference", "extra"),
    ),
    "custom": (
        "custom",
        "Edit this {room} photo. Requested change: {request}. {keep}",
        ("room", "request", "keep"), ("request",),
    ),
}
TEMPLATE_KEYS = tuple(TEMPLATES)
MAX_TEMPLATE = 1500

# What each placeholder holds, with the value the panel preview uses.
PLACEHOLDERS: dict[str, tuple[str, str]] = {
    "room": ("Room type words from the catalog", "living room"),
    "style": ("Style prompt from the catalog", "japandi interior: light oak, linen, low furniture, calm neutral tones"),
    "keep": ("The shared 'keep the room as it is' sentence", ""),
    "extra": ("The homeowner's extra request as a sentence, or empty", ' Additional request from the homeowner: "more plants".'),
    "what": ("What to remove, quoted", 'the "coffee table"'),
    "thing": ("The object to replace, quoted", '"sofa"'),
    "replacement": ("What replaces it, quoted", '"a green velvet sofa"'),
    "walls": ("Which walls: all or the selected one", "the walls"),
    "color": ("Colour name and code", "Sage Green (#9CAF88)"),
    "floor": ("Floor words from the catalog", "herringbone oak parquet"),
    "reference": ("Style read from the reference photo", "warm minimalist interior with travertine, walnut and soft linen"),
    "request": ("The homeowner's request, quoted", '"add a reading nook by the window"'),
}

_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")

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


def template_errors(key: str, text: str) -> list[str]:
    """Why a template cannot be used (empty list = fine). Codes the backend translates for the panel (INP-01):
    only the key's placeholders, every required one present, no stray braces or control characters."""
    if key not in TEMPLATES:
        return ["unknown_key"]
    _, _, allowed, required = TEMPLATES[key]
    errors: list[str] = []
    if not 10 <= len(text.strip()) <= (600 if key == "keep" else MAX_TEMPLATE):
        errors.append("length")
    if _CONTROL.search(text):
        errors.append("control_chars")
    names = _PLACEHOLDER.findall(text)
    if "{" in _PLACEHOLDER.sub("", text) or "}" in _PLACEHOLDER.sub("", text):
        errors.append("stray_brace")
    errors += [f"unknown_placeholder:{n}" for n in dict.fromkeys(names) if n not in allowed]
    errors += [f"missing_placeholder:{n}" for n in required if n not in names]
    return errors


def render(template: str, values: dict[str, str]) -> str:
    """One pass: inserted values are never scanned again, so a value containing braces stays text."""
    return _PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)), template)


def template_key(req: GenerateRequest) -> str:
    return "declutter_all" if req.tool == "declutter" and req.remove_all else req.tool


def build_prompt(req: GenerateRequest, reference_style: str | None = None, area: str = "",
                 templates: dict[str, str] | None = None) -> str:
    """`area` is where a tap selection lies (region.describe_area); empty without one. `templates` are the
    panel's active versions (key → text); a key without one uses the default above."""
    # A stored template the code no longer accepts (e.g. a placeholder was renamed in a deploy) falls back to the
    # default instead of failing the user's design; the backend validated it when it was published.
    templates = {k: v for k, v in (templates or {}).items() if k in TEMPLATES and not template_errors(k, v)}
    room = clean(req.room, 60) or "room"
    style = clean(req.style_prompt, 600) or DEFAULT_STYLE
    target = clean(req.target, 120, user_text=True)
    replacement = clean(req.replacement, 120, user_text=True)
    extra = clean(req.instructions, 300, user_text=True)
    where = f" {area}" if area else ""
    selected = (f'"{target}"' if target else "selected object") + where

    if area:
        what = f"the {selected}"
    else:
        what = f'the "{target}"' if target else "clutter, cables, personal items and mess"
    color = (
        f"{clean(req.color_name, 40, user_text=True) or 'the chosen colour'} ({req.color_hex})"
        if req.color_hex
        else "a warm off-white"
    )
    values = {
        "room": room,
        "style": style,
        "keep": templates.get("keep") or KEEP_STRUCTURE,
        "extra": f' Additional request from the homeowner: "{extra}".' if extra else "",
        "what": what,
        "thing": selected if area else f'"{target or "main sofa"}"',
        "replacement": f'"{replacement or "a modern alternative"}"',
        "walls": f"only the wall{where}" if area else "the walls",
        "color": color,
        "floor": clean(req.floor, 80) or "natural oak plank parquet",
        "reference": clean(reference_style, 600) or style,
        "request": f'"{extra or "refresh the decor"}"',
    }
    key = template_key(req)
    if key not in TEMPLATES:
        raise ValueError("unknown tool")
    return render(templates.get(key) or TEMPLATES[key][1], values)


def preview(key: str, template: str, keep: str | None = None) -> tuple[str | None, list[str]]:
    """The panel's preview: the template with sample values (API.md §7.26)."""
    errors = template_errors(key, template)
    if keep is not None and key != "keep":
        errors += [f"keep:{e}" for e in template_errors("keep", keep)]
    if errors:
        return None, errors
    values = {name: sample for name, (_, sample) in PLACEHOLDERS.items()}
    values["keep"] = template if key == "keep" else (keep or KEEP_STRUCTURE)
    return render(template if key != "keep" else "{keep}", values), []
