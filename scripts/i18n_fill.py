"""Fill missing web translations from Turkish with Claude (maeyja translation-fill pattern).

Turkish (apps/web/src/messages/tr.json) is the source of truth, English is reference only. For every other language
the script finds keys that are missing, empty or whose {placeholders} differ, sends only those to Claude with a
JSON schema (one string per key), checks the placeholders again and writes the file in Turkish key order.
Re-run it whenever Turkish text changes; untouched keys are never re-translated.

    ANTHROPIC_API_KEY=… python scripts/i18n_fill.py [--locales de,fr] [--dir apps/web/src/messages]

Uses the AI service's environment (anthropic SDK), e.g. `apps/ai-service/.venv/bin/python scripts/i18n_fill.py`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import anthropic

MODEL = os.environ.get("I18N_MODEL", "claude-opus-5-5")
CHUNK = 90  # keys per request: keeps each answer well inside the output budget

LANGUAGES = {
    "de": "German (use informal 'du')",
    "es": "Spanish (Spain/LatAm neutral, informal 'tú')",
    "fr": "French (use 'vous')",
    "it": "Italian (informal 'tu')",
    "ru": "Russian (use 'вы')",
    "nl": "Dutch (informal 'je')",
    "ja": "Japanese (polite です/ます style)",
    "ko": "Korean (polite 해요체)",
    "zh": "Simplified Chinese (mainland)",
}

SYSTEM = """You translate the user interface of Casalume, an AI interior / exterior / garden design app from Türkiye,
from Turkish into one target language. English is given as a reference for meaning only.

Rules:
- Natural, warm, concise product copy as a native speaker would write it for a consumer app; buttons stay short.
- Keep every {placeholder} exactly as written (same names, same braces). Keep line breaks.
- Do not translate: Casalume, PRO, AI (may be localised only if the language normally does), KVKK, TL, TRY, App Store,
  Google Play, e-mail addresses, URLs.
- Turkish and Anatolian style names and places (e.g. Kapadokya, Ege) may be rendered in the target language's usual form.
- Legal labels (KVKK notice, terms, privacy) are names of documents: translate the words, keep "KVKK".
- Return exactly the given keys, each with its translation as a string."""

PLACEHOLDER = re.compile(r"\{(\w+)\}")


def flatten(obj, prefix=""):
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(flatten(v, f"{prefix}{k}."))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.update(flatten(v, f"{prefix}{i}."))
    else:
        out[prefix[:-1]] = obj
    return out


_MISSING = object()


def rebuild(source, flat, prefix=""):
    """Turkish shape and key order with the translated values only. A missing key is left out (the web fills it
    from English); a list is written only when complete, because the web replaces lists as a whole."""
    if isinstance(source, dict):
        out = {}
        for k, v in source.items():
            sub = rebuild(v, flat, f"{prefix}{k}.")
            if sub is not _MISSING:
                out[k] = sub
        return out if out else _MISSING
    if isinstance(source, list):
        items = [rebuild(v, flat, f"{prefix}{i}.") for i, v in enumerate(source)]
        return _MISSING if any(x is _MISSING for x in items) else items
    return flat.get(prefix[:-1], _MISSING)


def same_placeholders(a: str, b: str) -> bool:
    return sorted(PLACEHOLDER.findall(a)) == sorted(PLACEHOLDER.findall(b))


def translate(client: anthropic.Anthropic, language: str, items: dict[str, tuple[str, str]]) -> dict[str, str]:
    # One small fixed schema (a per-key schema compiles to a grammar the API rejects as too large); the caller checks
    # that every key came back with its placeholders.
    schema = {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"key": {"type": "string"}, "text": {"type": "string"}},
                    "required": ["key", "text"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["items"],
        "additionalProperties": False,
    }
    payload = {k: {"tr": tr, "en": en} for k, (tr, en) in items.items()}
    with client.messages.stream(
        model=MODEL,
        max_tokens=32000,
        system=SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        messages=[{
            "role": "user",
            "content": f"Target language: {language}.\nTranslate the Turkish value of each key; answer one item per key:\n"
                       + json.dumps(payload, ensure_ascii=False, indent=1),
        }],
    ) as stream:
        message = stream.get_final_message()
    if message.stop_reason not in ("end_turn", "stop_sequence"):
        raise RuntimeError(f"stopped: {message.stop_reason}")
    text = next(b.text for b in message.content if b.type == "text")
    return {i["key"]: i["text"] for i in json.loads(text)["items"]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="apps/web/src/messages")
    ap.add_argument("--locales", default=",".join(LANGUAGES))
    args = ap.parse_args()
    root = Path(args.dir)
    tr_src = json.loads((root / "tr.json").read_text())
    tr, en = flatten(tr_src), flatten(json.loads((root / "en.json").read_text()))
    client = anthropic.Anthropic()

    for code in [c.strip() for c in args.locales.split(",") if c.strip()]:
        if code not in LANGUAGES:
            print(f"{code}: unknown language, skipped", file=sys.stderr)
            continue
        path = root / f"{code}.json"
        current = flatten(json.loads(path.read_text())) if path.exists() else {}
        todo = {
            k: (v, en.get(k, v)) for k, v in tr.items()
            if isinstance(v, str) and (not isinstance(current.get(k), str) or not current[k].strip() or not same_placeholders(v, current[k]))
        }
        keys = list(todo)
        done, rejected = 0, []
        for i in range(0, len(keys), CHUNK):
            chunk = {k: todo[k] for k in keys[i:i + CHUNK]}
            out = translate(client, LANGUAGES[code], chunk)
            for k, (source, _) in chunk.items():
                value = out.get(k)
                if isinstance(value, str) and value.strip() and same_placeholders(source, value):
                    current[k] = value
                    done += 1
                else:
                    rejected.append(k)
            tree = rebuild(tr_src, current)
            path.write_text(json.dumps({} if tree is _MISSING else tree, ensure_ascii=False, indent=2) + "\n")
        print(f"{code}: {done} translated, {len(rejected)} rejected{' ' + ', '.join(rejected[:5]) if rejected else ''}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
