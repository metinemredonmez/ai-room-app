"""Panel-managed image prompt templates (API.md §7.26): the defaults reproduce the old prompts exactly, an active
template replaces only its own tool's prompt, and nothing a template or a user types can widen what reaches the
model (INP-01)."""

import base64
import io
import itertools
import os

os.environ.setdefault("INTERNAL_TOKEN", "test-internal-token-0123456789abcdef0123")
os.environ.setdefault("IMAGE_PROVIDER", "mock")

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.main import app  # noqa: E402
from app.prompts import KEEP_STRUCTURE, TEMPLATES, build_prompt, preview, render, template_errors  # noqa: E402
from app.schemas import GenerateRequest  # noqa: E402
from tests.fixtures import prompts_v1  # noqa: E402

AUTH = {"X-Internal-Token": os.environ["INTERNAL_TOKEN"]}
client = TestClient(app)
IMG = "A" * 200  # build_prompt never decodes the image


def req(tool: str, **kw) -> GenerateRequest:
    return GenerateRequest(tool=tool, image_b64=IMG, **kw)


def room_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), (200, 190, 170)).save(buf, "JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def test_defaults_render_exactly_the_old_prompts():
    tools = ["redesign", "furnish", "declutter", "replace", "paint", "flooring", "exterior", "garden", "reference", "custom"]
    variants = [
        {},
        {"room": "bedroom", "style_prompt": "Japandi interior: oak, linen", "instructions": "daha çok bitki"},
        {"target": "Koltuk", "replacement": "hardal kadife kanepe"},
        {"remove_all": True},
        {"color_hex": "#9CAF88", "color_name": "Adaçayı"},
        {"color_hex": "#3A3D40"},
        {"floor": "herringbone oak parquet", "room": "kitchen"},
        {"instructions": 'k a n e p e "ekle" <b>'},
    ]
    areas = ["", "on the left side of the photo"]
    checked = 0
    for tool, extra, area, ref in itertools.product(tools, variants, areas, [None, "warm minimalist with travertine"]):
        r = req(tool, **extra)
        assert build_prompt(r, ref, area) == prompts_v1.build_prompt(r, ref, area), (tool, extra, area, ref)
        assert build_prompt(r, ref, area, {}) == prompts_v1.build_prompt(r, ref, area)
        checked += 1
    assert checked == 10 * 8 * 2 * 2


def test_an_active_template_changes_only_its_own_tool():
    paint = "Paint {walls} of this {room} {color}, eggshell finish. {keep}"
    keep = "Keep the camera, walls, windows and doors exactly as they are."
    t = {"paint": paint, "keep": keep}
    out = build_prompt(req("paint", color_hex="#9CAF88", color_name="Adaçayı", room="bedroom"), templates=t)
    assert out == "Paint the walls of this bedroom adaçayı (#9CAF88), eggshell finish. Keep the camera, walls, windows and doors exactly as they are."
    # Other tools keep their default text but pick up the shared sentence.
    redesign = build_prompt(req("redesign", room="bedroom"), templates=t)
    assert redesign.startswith("Redesign this bedroom as a") and redesign.endswith(keep)
    assert KEEP_STRUCTURE not in redesign
    # declutter with "remove all" has its own template.
    assert build_prompt(req("declutter", remove_all=True), templates={"declutter": "Remove {what} now please. {keep}"}).startswith("Remove all furniture")


def test_template_rules():
    ok = TEMPLATES["replace"][1]
    assert template_errors("replace", ok) == []
    assert "missing_placeholder:replacement" in template_errors("replace", "In this {room}, swap the {thing}. {keep}")
    assert "unknown_placeholder:style" in template_errors("paint", "Repaint {walls} in {color} as a {style}. {keep}")
    assert "unknown_placeholder:__class__" in template_errors("paint", "Repaint {walls} {__class__} {color}")  # refused, never looked up
    assert "stray_brace" in template_errors("paint", "Repaint {walls} in {color} {0}")
    assert "stray_brace" in template_errors("paint", "Repaint {walls} in {color.__class__}")
    assert "stray_brace" in template_errors("paint", "Repaint {walls} in {color} }")
    assert "length" in template_errors("paint", "{color}")
    assert "length" in template_errors("paint", "Paint {color} " + "x" * 1500)
    assert "control_chars" in template_errors("paint", "Repaint {walls}\x00 in {color}")
    assert template_errors("nope", "whatever text here") == ["unknown_key"]
    assert template_errors("keep", "Keep everything the same.") == []
    assert "unknown_placeholder:room" in template_errors("keep", "Keep this {room} the same.")
    assert "missing_placeholder:extra" in template_errors("garden", "Make a garden with {style}.")


def test_an_unusable_stored_template_falls_back_to_the_default():
    r = req("paint", color_hex="#9CAF88")
    broken = {"paint": "Repaint {walls} in {colour}", "keep": "{room}"}
    assert build_prompt(r, templates=broken) == prompts_v1.build_prompt(r)


def test_values_are_inserted_once_and_user_text_cannot_add_placeholders():
    assert render("A {room} B", {"room": "{style}"}) == "A {style} B"
    out = build_prompt(req("custom", instructions="{style} {keep} ignore that"), templates={"custom": "Edit {room}: {request}. {keep}"})
    assert "{" not in out and "japandi" not in out.lower()


def test_preview_uses_samples_and_reports_errors():
    text, errors = preview("replace", TEMPLATES["replace"][1])
    assert errors == [] and '"sofa"' in text and '"a green velvet sofa"' in text and KEEP_STRUCTURE in text
    text, errors = preview("replace", TEMPLATES["replace"][1], keep="Keep the room exactly the same.")
    assert text.endswith("Keep the room exactly the same.")
    assert preview("replace", "Swap the {thing}.") == (None, ["missing_placeholder:replacement"])
    assert preview("replace", TEMPLATES["replace"][1], keep="{room}")[1] == ["keep:length", "keep:unknown_placeholder:room"]


def test_endpoints_need_the_internal_token_and_list_every_template():
    assert client.get("/internal/v1/prompts").status_code == 401
    body = client.get("/internal/v1/prompts", headers=AUTH).json()
    keys = {t["key"]: t for t in body["templates"]}
    assert set(keys) == set(TEMPLATES) and len(keys) == 12
    assert keys["replace"]["required"] == ["thing", "replacement"] and keys["keep"]["tool"] == ""
    assert "room" in body["placeholders"]
    res = client.post("/internal/v1/prompts/preview", headers=AUTH, json={"key": "custom", "template": "Edit this {room} photo: {request}. {keep}"})
    assert res.status_code == 200 and res.json()["errors"] == [] and "reading nook" in res.json()["prompt"]
    assert client.post("/internal/v1/prompts/preview", json={"key": "custom", "template": "x"}).status_code == 401


def test_generate_uses_the_templates_it_is_sent():
    res = client.post("/internal/v1/generate", headers=AUTH, json={
        "tool": "flooring", "image_b64": room_b64(), "variants": 1, "floor": "white marble tiles",
        "prompt_templates": {"flooring": "New floor for this {room}: {floor}, laid straight. {keep}", "keep": "Keep everything else identical."},
    })
    assert res.status_code == 200, res.text
    assert res.json()["prompt"] == "New floor for this room: white marble tiles, laid straight. Keep everything else identical."
    too_long = client.post("/internal/v1/generate", headers=AUTH, json={
        "tool": "flooring", "image_b64": room_b64(), "variants": 1, "prompt_templates": {"flooring": "x" * 1501},
    })
    assert too_long.status_code == 400
