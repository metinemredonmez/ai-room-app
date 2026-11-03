from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ToolId = Literal[
    "redesign", "furnish", "declutter", "replace", "paint",
    "flooring", "exterior", "garden", "reference", "custom",
]
Locale = Literal["tr", "en"]

B64 = Field(..., min_length=100, max_length=17_000_000)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GenerateRequest(Strict):
    tool: ToolId
    image_b64: str = B64
    variants: int = Field(1, ge=1, le=4)
    style_prompt: str | None = Field(None, max_length=600)
    room: str | None = Field(None, max_length=60)
    floor: str | None = Field(None, max_length=80)
    color_hex: str | None = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    color_name: str | None = Field(None, max_length=40)
    target: str | None = Field(None, max_length=120)
    replacement: str | None = Field(None, max_length=120)
    instructions: str | None = Field(None, max_length=300)
    remove_all: bool = False
    reference_image_b64: str | None = Field(None, max_length=17_000_000)


class GenerateResponse(BaseModel):
    images_b64: list[str]
    prompt: str
    provider: str
    reference_style: str | None = None


class AnalyzeRequest(Strict):
    image_b64: str = B64
    locale: Locale = "tr"
    room: str | None = Field(None, max_length=60)
    style_name: str | None = Field(None, max_length=60)


class AnalyzeItem(BaseModel):
    name: str
    category: str
    material: str
    color: str
    quantity: int = Field(ge=1, le=50)
    price_min_try: float = Field(ge=0)
    price_max_try: float = Field(ge=0)
    search_query: str


class RenovationItem(BaseModel):
    task: str
    unit: str
    quantity: float = Field(ge=0)
    cost_min_try: float = Field(ge=0)
    cost_max_try: float = Field(ge=0)


class AnalyzeResponse(BaseModel):
    summary: str
    palette: list[str]
    items: list[AnalyzeItem]
    renovation: list[RenovationItem]
    disclaimer: str


class CatalogEntry(Strict):
    id: str = Field(max_length=40)
    name: str = Field(max_length=80)


class ChatCatalog(Strict):
    tools: list[CatalogEntry] = Field(default_factory=list, max_length=30)
    styles: list[CatalogEntry] = Field(default_factory=list, max_length=100)
    rooms: list[CatalogEntry] = Field(default_factory=list, max_length=40)


class ChatMessage(Strict):
    role: Literal["user", "assistant"]
    text: str = Field(..., max_length=2000)
    image_b64: str | None = Field(None, max_length=17_000_000)


class ChatRequest(Strict):
    locale: Locale = "tr"
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=20)
    catalog: ChatCatalog = Field(default_factory=ChatCatalog)


class Suggestion(BaseModel):
    label: str
    tool: ToolId
    style_id: str | None = None
    room_id: str | None = None
    instructions: str | None = None


class ChatResponse(BaseModel):
    reply: str
    suggestions: list[Suggestion]
