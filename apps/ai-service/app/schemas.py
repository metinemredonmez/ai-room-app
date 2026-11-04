from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ToolId = Literal[
    "redesign", "furnish", "declutter", "replace", "paint",
    "flooring", "exterior", "garden", "reference", "custom",
]
# The web and app languages (API.md §7.17); the assistant answers in the user's language.
Locale = Literal["tr", "en", "de", "es", "fr", "it", "ru", "nl", "ja", "ko", "zh"]
UsageKind = Literal["generate", "analyze", "chat", "describe", "segment", "marketing"]
QualityIssue = Literal["too_dark", "too_bright", "blurry", "low_res", "low_contrast"]

B64 = Field(..., min_length=100, max_length=17_000_000, description="Base64-encoded JPEG/PNG/WEBP image")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Usage(BaseModel):
    """Cost-ledger entry the backend stores in `AiUsage` (API.md §7.2)."""

    provider: str = Field(description="Provider that produced most of the output; 'demo' for keyless answers")
    model: str
    kind: UsageKind
    images: int = Field(0, ge=0, description="Images billed by the provider (including variants dropped as no_change)")
    input_tokens: int = Field(0, ge=0)
    output_tokens: int = Field(0, ge=0)
    latency_ms: int = Field(0, ge=0)
    cost_usd: float = Field(0.0, ge=0)
    fallback_used: bool = False


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool = Field(description="True when the backend may retry the same request")


class ErrorResponse(BaseModel):
    error: ErrorDetail
    usage: Usage | None = Field(None, description="Present when cost was incurred before the failure (e.g. no_change)")


class Point(Strict):
    """A tap on the photo, 0..1 from the top-left corner. Each point selects one object (API.md §7.15)."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


Points = Field(None, min_length=1, max_length=8, description="Tap selection, one object per point")


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
    points: list[Point] | None = Points


class SegmentRequest(Strict):
    """Selection preview: the mask the region lock would use for these taps (or this object name)."""

    image_b64: str = B64
    target: str | None = Field(None, max_length=120)
    points: list[Point] | None = Points

    @model_validator(mode="after")
    def _something_to_select(self):
        if not self.points and not (self.target or "").strip():
            raise ValueError("points or target required")
        return self


class SegmentResponse(BaseModel):
    mask_b64: str = Field(description="PNG, grayscale, source size: 255 inside the selection, 0 outside")
    coverage: float = Field(ge=0, le=1)
    method: Literal["sam3", "heuristic"]
    usage: Usage


class RegionInfo(BaseModel):
    """Region lock (API.md §7.8): when applied, pixels outside the mask are the input photo's."""

    applied: bool
    target: str = Field(description="What was segmented: wall, floor or the user's target object")
    method: Literal["sam3", "heuristic", "none"]
    coverage: float = Field(ge=0, le=1, description="Share of the image inside the mask")
    reason: Literal["no_segmenter", "segmentation_failed", "mask_unusable"] | None = None


class GenerateResponse(BaseModel):
    images_b64: list[str]
    prompt: str
    provider: str
    reference_style: str | None = None
    region: RegionInfo | None = Field(None, description="Null for whole-scene tools or when REGION_LOCK=off")
    usage: Usage


class QualityRequest(Strict):
    image_b64: str = B64


class QualityMetrics(BaseModel):
    brightness: float = Field(description="Mean luminance 0–255")
    contrast: float = Field(description="Luminance standard deviation")
    sharpness: float = Field(description="Edge strength relative to contrast (×100) on a ≤512 px downscale")
    width: int
    height: int


class QualityResponse(BaseModel):
    score: int = Field(ge=0, le=100)
    issues: list[QualityIssue]
    metrics: QualityMetrics


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
    usage: Usage | None = None


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
    usage: Usage | None = None


class AsoRequest(Strict):
    """Store listing draft for one language (API.md §7.18). `facts` is the backend's fact sheet."""

    locale: Locale
    facts: str = Field(..., min_length=50, max_length=8000)
    brief: str | None = Field(None, max_length=1000, description="Owner's notes: emphasis, audience, campaign")
    whats_new: str | None = Field(None, max_length=1000, description="Changes in this release")


class AsoListing(BaseModel):
    app_name: str
    app_subtitle: str
    app_keywords: str
    app_promo: str
    app_description: str
    app_whats_new: str
    play_title: str
    play_short: str
    play_description: str


class AsoResponse(BaseModel):
    listing: AsoListing
    violations: list[str] = Field(description="Fields still over the store limit after one rewrite")
    usage: Usage


Platform = Literal["instagram", "tiktok", "pinterest"]


class SocialRequest(Strict):
    """Caption for a before/after post of one style (API.md §7.18)."""

    locale: Locale
    platform: Platform
    style_name: str = Field(..., min_length=2, max_length=80)
    style_description: str = Field("", max_length=300)
    facts: str = Field(..., min_length=50, max_length=8000)
    brief: str | None = Field(None, max_length=1000)


class SocialPost(BaseModel):
    title: str = Field(description="Pinterest pin title; the opening hook elsewhere")
    caption: str
    hashtags: list[str]
    alt_text: str


class SocialResponse(BaseModel):
    post: SocialPost
    violations: list[str]
    usage: Usage


class CampaignRequest(Strict):
    """Text of a Toplu Gönderim message (push or e-mail) for one language (API.md §7.18)."""

    locale: Locale
    channel: Literal["PUSH", "EMAIL"]
    kind: Literal["SERVICE", "MARKETING"]
    goal: str = Field(..., min_length=5, max_length=1000)
    facts: str = Field(..., min_length=50, max_length=8000)
    links: list[str] = Field(default_factory=list, max_length=30, description="In-app paths the message may open")


class CampaignText(BaseModel):
    title: str
    body: str
    link: str | None = None


class CampaignResponse(BaseModel):
    message: CampaignText
    violations: list[str]
    usage: Usage


class ReportRequest(Strict):
    """Owner's weekly report: the backend's numbers, Claude's short reading of them (Turkish)."""

    metrics: str = Field(..., min_length=20, max_length=12000, description="JSON of this week's and last week's numbers")


class ReportText(BaseModel):
    summary: str
    highlights: list[str]
    actions: list[str]


class ReportResponse(BaseModel):
    report: ReportText
    usage: Usage


class BlogSource(Strict):
    title: str = Field(..., max_length=200)
    description: str = Field(..., max_length=400)
    body: str = Field(..., max_length=40000)


class BlogRequest(Strict):
    """Blog article (API.md §7.18): written from a topic, or translated from a published article."""

    locale: Locale
    facts: str = Field(..., min_length=50, max_length=8000)
    topic: str | None = Field(None, max_length=300)
    keywords: str | None = Field(None, max_length=300)
    source: BlogSource | None = None
    links: list[str] = Field(default_factory=list, max_length=30, description="In-site paths the article may link to")

    @model_validator(mode="after")
    def _topic_or_source(self):
        if not self.source and not (self.topic or "").strip():
            raise ValueError("topic or source required")
        return self


class BlogArticle(BaseModel):
    title: str
    description: str
    slug: str
    body: str


class BlogResponse(BaseModel):
    article: BlogArticle
    violations: list[str]
    usage: Usage


class SeoPage(Strict):
    key: str = Field(..., max_length=40)
    path: str = Field(..., max_length=80)
    purpose: str = Field(..., max_length=300)


class SeoRequest(Strict):
    locale: Locale
    facts: str = Field(..., min_length=50, max_length=8000)
    pages: list[SeoPage] = Field(..., min_length=1, max_length=12)


class SeoMeta(BaseModel):
    key: str
    title: str
    description: str


class SeoResponse(BaseModel):
    pages: list[SeoMeta]
    violations: list[str]
    usage: Usage


class ProviderState(BaseModel):
    name: str
    state: Literal["closed", "open", "half_open"]
    consecutive_failures: int


class HealthResponse(BaseModel):
    status: Literal["ok"]
    provider: str = Field(description="Primary image provider")
    chat_enabled: bool
    fallbacks: list[str]
    providers: list[ProviderState]
