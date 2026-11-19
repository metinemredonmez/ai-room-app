"""Object-name translation for SAM 3 (API.md §7.15): Turkish furniture names → English.

Deterministic dictionary; unknown words pass through so SAM 3 can still try them.
"""

from app.region import region_target
from app.schemas import GenerateRequest
from app.translate import english_target

B64 = "eA" * 50  # long enough for the schema's min_length, never decoded in these tests


def test_single_word_hits():
    assert english_target("yastık") == "pillow"
    assert english_target("KOLTUK") == "sofa"
    assert english_target("avize") == "chandelier"


def test_plural_and_possessive_suffixes():
    assert english_target("yastıklar") == "pillow"
    assert english_target("koltukları") == "sofa"
    assert english_target("halısı") == "rug"


def test_phrases_beat_single_words():
    assert english_target("kahve sehpası") == "coffee table"
    assert english_target("TV Ünitesi") == "tv stand"
    assert english_target("çalışma masası") == "desk"


def test_mixed_sentence_maps_only_known_words():
    assert english_target("kırmızı koltuk") == "kırmızı sofa"


def test_unknown_turkish_word_passes_through_untouched():
    # Not in the dictionary: SAM 3 may still understand it; never invent a mapping.
    assert english_target("böbrek") == "böbrek"


def test_english_and_defaults_pass_through():
    assert english_target("sofa") == "sofa"
    assert english_target("selection") == "selection"
    assert english_target("wall") == "wall"


def test_whitespace_and_dotless_i_are_normalized():
    assert english_target("  Kırmızı   KOLTUK ") == "kırmızı sofa"
    assert english_target("KİLİM") == "kilim"


def test_empty_input_is_returned_as_is():
    assert english_target("") == ""


def test_region_target_translates_replace_target():
    req = GenerateRequest(tool="replace", target="koltuk", image_b64=B64)
    assert region_target(req) == "sofa"


def test_region_target_translates_declutter_target():
    req = GenerateRequest(tool="declutter", target="Yastıklar", remove_all=False, image_b64=B64)
    assert region_target(req) == "pillow"


def test_region_target_keeps_paint_and_flooring_defaults():
    assert region_target(GenerateRequest(tool="paint", image_b64=B64)) == "wall"
    assert region_target(GenerateRequest(tool="flooring", image_b64=B64)) == "floor"


def test_region_target_without_target_keeps_sofa_default():
    assert region_target(GenerateRequest(tool="replace", target="", image_b64=B64)) == "sofa"
