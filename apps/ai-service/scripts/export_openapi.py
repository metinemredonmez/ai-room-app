"""Writes the AI service OpenAPI schema to docs/openapi/ai-service.json (API.md §7.5).

Run from apps/ai-service:  uv run python scripts/export_openapi.py
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parents[1] / "docs" / "openapi" / "ai-service.json"

# Schema export needs no real secrets or providers.
os.environ["ENV"] = "development"
os.environ["IMAGE_PROVIDER"] = "mock"
os.environ["IMAGE_FALLBACKS"] = ""
os.environ["INTERNAL_TOKEN"] = "schema-export-only-" + "x" * 32
sys.path.insert(0, str(ROOT))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

schema = create_app(Settings()).openapi()  # type: ignore[call-arg]
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT.parents[1])} ({len(schema['paths'])} paths)")
