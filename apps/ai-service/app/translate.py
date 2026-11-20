"""Translate the user's object name into English for SAM 3 (API.md §7.15).

SAM 3's text prompt is English-first, so a Turkish name ("yastık") can be missed
(4 Nov 2026 finding). A deterministic furniture dictionary covers the common room
objects at zero cost and works offline; unknown words pass through untouched —
SAM 3 may still understand them, and the cost ledger never sees an extra call.
"""

from __future__ import annotations

import re

_WS = re.compile(r"\s+")

# Multi-word phrases first (greedy, longest match wins over single words).
PHRASES: dict[str, str] = {
    "kahve sehpası": "coffee table",
    "yan sehpa": "side table",
    "tv ünitesi": "tv stand",
    "televizyon ünitesi": "tv stand",
    "tv sehpası": "tv stand",
    "kitaplık rafı": "bookshelf",
    "çalışma masası": "desk",
    "ofis sandalyesi": "office chair",
    "yemek masası": "dining table",
    "yemek sandalyesi": "dining chair",
    "bar sandalyesi": "bar stool",
    "mutfak dolabı": "kitchen cabinet",
    "banyo dolabı": "bathroom cabinet",
    "bulaşık makinesi": "dishwasher",
    "çamaşır makinesi": "washing machine",
    "elbise dolabı": "wardrobe",
    "giyinme dolabı": "walk-in closet",
    "yatak odası takımı": "bedroom set",
    "duş kabini": "shower cabin",
    "duşakabin": "shower cabin",
    "tuvalet klozeti": "toilet bowl",
    "mutfak tezgahı": "kitchen counter",
    "mutfak adası": "kitchen island",
    "bahçe salıncağı": "garden swing",
    "saksı bitkisi": "potted plant",
    "dekoratif yastık": "throw pillow",
    "yastık kırlent": "throw pillow",
    "kırlent": "throw pillow",
    "göbek avize": "chandelier",
    "yer lambası": "floor lamp",
    "tavan lambası": "ceiling lamp",
    "duvar rafı": "wall shelf",
    "aski askı": "coat rack",
    "portmanto": "coat rack",
    "giyim askısı": "clothes rack",
}

# Single words; plural/possessive suffixes are stripped only when the base hits.
WORDS: dict[str, str] = {
    # seating & living room
    "koltuk": "sofa", "kanape": "sofa", "çekyat": "sofa bed", "kanepe": "sofa",
    "yastık": "pillow", "puf": "pouf", "berjer": "armchair", "koltuklar": "sofa",
    "sehpa": "table", "konsol": "console table", "şömine": "fireplace",
    "tv": "tv", "televizyon": "tv", "halı": "rug", "kilim": "kilim",
    "perde": "curtain", "tül": "sheer curtain", "avize": "chandelier",
    "lamba": "lamp", "abajur": "table lamp", "vazo": "vase", "tablo": "painting",
    "ayna": "mirror", "raf": "shelf", "kitaplık": "bookcase", "duvar saati": "wall clock",
    # bedroom
    "yatak": "bed", "başlık": "headboard", "komodin": "nightstand",
    "gardırop": "wardrobe", "şifonyer": "dresser", "baza": "bed base",
    # kitchen & dining
    "masa": "table", "sandalye": "chair", "buzdolabı": "refrigerator",
    "fırın": "oven", "ocak": "stove", "davlumbaz": "range hood",
    "tezgah": "counter", "ada": "kitchen island", "mikrodalga": "microwave",
    # office
    "bilgisayar": "computer", "monitör": "monitor", "yazıcı": "printer",
    # bathroom
    "lavabo": "sink", "küvet": "bathtub", "wc": "toilet", "tuvalet": "toilet",
    "klozet": "toilet", "duş": "shower",
    # architecture & surfaces
    "kapı": "door", "pencere": "window", "duvar": "wall", "zemin": "floor",
    "tavan": "ceiling", "merdiven": "stairs", "kolon": "column", "kemer": "arch",
    # decor & plants
    "saksı": "plant pot", "bitki": "plant", "çiçek": "flower",
    "şamdan": "candlestick", "dekor": "decor", "heykel": "sculpture",
    # outdoor
    "salıncak": "swing", "mangal": "grill",
}

# Conservative suffix strip: only what clearly marks Turkish plural/possessive.
_SUFFIX = re.compile(r"(?:lar|ler|ları|leri|sı|si|su|sü|ı|i|u|ü)$")


def _normalize(text: str) -> str:
    return _WS.sub(" ", text.strip().lower().replace("i̇", "i"))


def _word(word: str) -> str | None:
    if word in WORDS:
        return WORDS[word]
    base = _SUFFIX.sub("", word)
    if base != word and base in WORDS:
        return WORDS[base]
    return None


def english_target(name: str) -> str:
    """Best-effort English object name for SAM 3; the input is returned when nothing maps."""
    text = _normalize(name)
    if not text:
        return name
    tokens = text.split()
    out: list[str] = []
    changed = False
    i = 0
    while i < len(tokens):
        hit: str | None = None
        step = 1
        for n in (3, 2):
            if i + n <= len(tokens):
                phrase = " ".join(tokens[i : i + n])
                if phrase in PHRASES:
                    hit, step = PHRASES[phrase], n
                    break
        if hit is not None:
            out.append(hit)
            changed = True
        else:
            mapped = _word(tokens[i])
            out.append(mapped if mapped is not None else tokens[i])
            changed = changed or mapped is not None
        i += step
    return " ".join(out) if changed else name
