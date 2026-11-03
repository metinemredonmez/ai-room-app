import asyncio
import hmac
import logging
import time
import uuid
from collections import Counter

from fastapi import Depends, FastAPI, HTTPException, Request, Security
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader

from .assistant import Assistant, AssistantUnavailable, CallUsage
from .config import Settings, get_settings
from .images import NO_CHANGE_BELOW, ImageInputError, decode_image, decode_raw, is_unchanged, to_b64
from .monitoring import init_monitoring
from .prompts import build_prompt
from .providers import ImageProvider, ProviderError, create_providers
from .quality import assess
from .region import RegionMask, Segmenter, composite, create_segmenter, masked_mean_abs_diff, region_target, usable
from .resilience import ChainResult, ProviderChain
from .schemas import (
    AnalyzeRequest, AnalyzeResponse, ChatRequest, ChatResponse, ErrorResponse, GenerateRequest, GenerateResponse,
    HealthResponse, QualityRequest, QualityResponse, RegionInfo, Usage,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("ai-service")

MAX_BODY_BYTES = 40 * 1024 * 1024
OUTPUT_MAX_BYTES = 25 * 1024 * 1024

DESCRIPTION = """Internal AI service of AI Room. Only the backend calls it (header `X-Internal-Token`).

* image generation with a provider fallback chain, circuit breakers and a 150 s time budget
* region lock for paint / flooring / replace / targeted declutter: SAM 3 mask, pixels outside it stay the user's
* capture-quality gate, no-change detection
* Claude design chat and shopping/budget analysis
* every AI answer carries a `usage` cost-ledger entry (API.md §7.2)

Errors: `{"error": {"code", "message", "retryable"}}` — the backend retries only when `retryable` is true."""

TAGS = [
    {"name": "generation", "description": "Image editing / restyling"},
    {"name": "quality", "description": "Advisory capture-quality check"},
    {"name": "assistant", "description": "Claude chat and analysis (demo answers without a key)"},
    {"name": "health", "description": "Liveness and provider state"},
]

ERRORS = {
    400: {"model": ErrorResponse, "description": "Invalid input"},
    401: {"model": ErrorResponse, "description": "Missing or wrong X-Internal-Token"},
    413: {"model": ErrorResponse, "description": "Body larger than 40 MB"},
    415: {"model": ErrorResponse, "description": "Not a JPEG/PNG/WEBP image"},
}


class NoChangeError(Exception):
    """Every variant came back (almost) identical to the input; cost was still incurred."""

    def __init__(self, usage: Usage):
        super().__init__("no_change")
        self.usage = usage


def error(status: int, code: str, message: str, retryable: bool = False, usage: Usage | None = None) -> JSONResponse:
    body: dict = {"error": {"code": code, "message": message, "retryable": retryable}}
    if usage is not None:
        body["usage"] = usage.model_dump()
    return JSONResponse(status_code=status, content=body)


def create_app(settings: Settings, providers: list[ImageProvider] | None = None,
               assistant: Assistant | None = None, segmenter: Segmenter | None = None) -> FastAPI:
    chain = ProviderChain(
        providers or create_providers(settings),
        threshold=settings.breaker_failure_threshold,
        cooldown=settings.breaker_cooldown_s,
        provider_timeout=settings.provider_timeout_s,
    )
    assistant = assistant or Assistant(settings)
    segmenter = segmenter or create_segmenter(settings.fal_key, settings.falai_seg_model, settings.falai_seg_cost_usd,
                                              settings.image_provider)
    generation_slots = asyncio.Semaphore(settings.max_concurrent_generations)
    init_monitoring(settings.sentry_dsn, settings.sentry_environment or settings.env, settings.sentry_release,
                    settings.sentry_traces_sample_rate)

    app = FastAPI(
        title="AI Room AI Service",
        version="1.1.0",
        description=DESCRIPTION,
        openapi_tags=TAGS,
        # §7.5: interactive docs only outside production.
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )
    app.state.chain = chain
    token_header = APIKeyHeader(name="X-Internal-Token", auto_error=False,
                                description="Shared secret held only by the backend (NET-04)")

    def require_internal(token: str | None = Security(token_header)) -> None:
        # NET-04: constant-time comparison.
        if not token or not hmac.compare_digest(token.encode(), settings.internal_token.encode()):
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.middleware("http")
    async def guard(request: Request, call_next):
        # RES-01 / FIL-02: refuse oversized bodies before parsing; LOG-01: one structured line per request.
        started = time.perf_counter()
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
            return error(413, "payload_too_large", "Request body too large")
        try:
            response = await call_next(request)
        except Exception:  # EXC-01: fail closed, no internals in the response
            log.exception('{"event":"unhandled","request_id":"%s"}', rid)
            response = error(500, "internal", "Internal error")
        log.info('{"event":"request","request_id":"%s","method":"%s","path":"%s","status":%d,"ms":%d}',
                 rid, request.method, request.url.path, response.status_code, (time.perf_counter() - started) * 1000)
        response.headers["x-request-id"] = rid
        return response

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        code = exc.detail if isinstance(exc.detail, str) else "error"
        return error(exc.status_code, code, code.replace("_", " "))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        fields = sorted({".".join(str(p) for p in e["loc"][1:]) for e in exc.errors()})
        return error(400, "validation_failed", "Invalid fields: " + ", ".join(fields))

    @app.exception_handler(ImageInputError)
    async def image_error(_: Request, exc: ImageInputError):
        return error(415 if str(exc) == "unsupported_format" else 400, str(exc), "Invalid image")

    @app.exception_handler(ProviderError)
    async def provider_error(_: Request, exc: ProviderError):
        log.warning('{"event":"provider_error","reason":"%s","retryable":%s}', exc.code, str(exc.retryable).lower())
        return error(502, "ai_unavailable", f"Image provider failed ({exc.code})", retryable=exc.retryable)

    @app.exception_handler(NoChangeError)
    async def no_change_error(_: Request, exc: NoChangeError):
        log.warning('{"event":"no_change","images":%d}', exc.usage.images)
        return error(422, "no_change", "The result is identical to the input photo", usage=exc.usage)

    @app.exception_handler(AssistantUnavailable)
    async def assistant_error(_: Request, exc: AssistantUnavailable):
        log.warning('{"event":"assistant_error","reason":"%s"}', exc.reason)
        return error(502, "ai_unavailable", "Assistant unavailable", retryable=exc.retryable)

    @app.get("/healthz", tags=["health"], summary="Liveness (no auth)")
    async def healthz():
        return {"status": "ok"}

    @app.get("/internal/v1/health", tags=["health"], response_model=HealthResponse,
             dependencies=[Depends(require_internal)], responses={401: ERRORS[401]},
             summary="Provider chain and circuit-breaker state")
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok", provider=settings.image_provider, chat_enabled=settings.chat_enabled,
            fallbacks=settings.fallback_list, providers=chain.snapshot(),  # type: ignore[arg-type]
        )

    def generation_usage(results: list[ChainResult], describe: CallUsage | None, started: float,
                         extra_cost: float = 0.0) -> Usage:
        counts = Counter((r.provider, r.model) for r in results)
        (provider, model), _ = counts.most_common(1)[0] if counts else ((chain.primary.name, chain.primary.model), 0)
        cost = extra_cost + sum(settings.image_cost_usd(r.provider) for r in results)
        input_tokens = output_tokens = 0
        if describe is not None and describe.model != "demo":
            input_tokens, output_tokens = describe.input_tokens, describe.output_tokens
            cost += settings.claude_cost_usd(input_tokens, output_tokens)
        return Usage(
            provider=provider, model=model, kind="generate", images=len(results),
            input_tokens=input_tokens, output_tokens=output_tokens,
            latency_ms=int((time.perf_counter() - started) * 1000), cost_usd=round(cost, 6),
            fallback_used=any(r.fallback_used for r in results),
        )

    async def segment(image: bytes, target: str, timeout: float) -> RegionMask | Exception:
        assert segmenter is not None
        try:
            return await asyncio.wait_for(segmenter.segment(image, target, timeout), timeout=timeout)
        except (ProviderError, TimeoutError, asyncio.TimeoutError, OSError, ValueError) as exc:
            # A failed mask never fails the design: the edit continues without the lock (and says so).
            log.warning('{"event":"segmentation_failed","reason":"%s"}', getattr(exc, "code", type(exc).__name__))
            return exc

    @app.post("/internal/v1/generate", tags=["generation"], response_model=GenerateResponse,
              dependencies=[Depends(require_internal)],
              responses={**ERRORS,
                         422: {"model": ErrorResponse, "description": "`no_change`: every variant matched the input (usage included)"},
                         502: {"model": ErrorResponse, "description": "`ai_unavailable`: providers failed or the 150 s budget ran out"}},
              summary="Restyle / edit a room photo (1–4 variants)")
    async def generate(req: GenerateRequest) -> GenerateResponse:
        started = time.perf_counter()
        loop = asyncio.get_running_loop()
        deadline = loop.time() + settings.generate_time_budget_s
        remaining = lambda: max(0.05, deadline - loop.time())  # noqa: E731
        image = decode_image(req.image_b64, settings.max_image_bytes)

        reference_style: str | None = None
        describe: CallUsage | None = None
        if req.tool == "reference":
            if not req.reference_image_b64:
                raise HTTPException(status_code=400, detail="reference_image_required")
            ref = decode_image(req.reference_image_b64, settings.max_image_bytes, 1024)
            try:
                reference_style, describe = await asyncio.wait_for(assistant.describe_reference(ref), timeout=remaining())
            except (TimeoutError, asyncio.TimeoutError) as exc:
                raise ProviderError("time_budget_exceeded", retryable=True) from exc
        prompt = build_prompt(req, reference_style)
        tint = req.color_hex if req.tool == "paint" else None

        target = region_target(req) if settings.region_lock == "auto" else None
        # The mask is computed while the variants render, so the lock adds no latency of its own.
        seg_task = asyncio.create_task(segment(image, target, remaining())) if target and segmenter else None

        async def one(variant: int) -> ChainResult:
            async with generation_slots:
                return await chain.generate(image, prompt, variant, tint, deadline)

        try:
            outcomes = await asyncio.wait_for(
                asyncio.gather(*(one(i) for i in range(req.variants)), return_exceptions=True), timeout=remaining())
        except (TimeoutError, asyncio.TimeoutError) as exc:
            if seg_task:
                seg_task.cancel()
            raise ProviderError("time_budget_exceeded", retryable=True) from exc

        region: RegionInfo | None = None
        mask: RegionMask | None = None
        if target:
            seg = await seg_task if seg_task else None
            if isinstance(seg, RegionMask):
                mask = seg if usable(seg) else None
                region = RegionInfo(applied=mask is not None, target=target, method=seg.method,  # type: ignore[arg-type]
                                    coverage=round(seg.coverage, 4), reason=None if mask else "mask_unusable")
            else:
                region = RegionInfo(applied=False, target=target, method="none", coverage=0.0,
                                    reason="segmentation_failed" if seg_task else "no_segmenter")

        billed = [o for o in outcomes if isinstance(o, ChainResult)]
        failures = [o for o in outcomes if isinstance(o, BaseException)]
        for f in failures:
            if not isinstance(f, ProviderError):
                raise f
        if not billed:
            # Prefer a non-retryable reason: retrying cannot fix it.
            raise next((f for f in failures if not f.retryable), failures[0])  # type: ignore[union-attr]

        images: list[str] = []
        for result in billed:
            try:
                output = decode_image(to_b64(result.image), OUTPUT_MAX_BYTES)  # re-validate provider output
            except ImageInputError:
                log.warning('{"event":"corrupt_output","provider":"%s"}', result.provider)
                continue
            if mask is not None:
                output = await asyncio.to_thread(composite, image, output, mask.mask)
                unchanged = await asyncio.to_thread(masked_mean_abs_diff, image, output, mask.mask) < NO_CHANGE_BELOW
            else:
                unchanged = is_unchanged(image, output)
            if unchanged:
                log.warning('{"event":"variant_unchanged","provider":"%s"}', result.provider)
                continue
            images.append(to_b64(output))

        seg_cost = seg.cost_usd if target and isinstance(seg, RegionMask) else 0.0
        usage = generation_usage(billed, describe, started, seg_cost)
        if not images:
            raise NoChangeError(usage)
        return GenerateResponse(images_b64=images, prompt=prompt, provider=usage.provider,
                                reference_style=reference_style, region=region, usage=usage)

    @app.post("/internal/v1/quality", tags=["quality"], response_model=QualityResponse,
              dependencies=[Depends(require_internal)], responses=ERRORS,
              summary="Advisory capture-quality score (never blocks)")
    async def quality(req: QualityRequest) -> QualityResponse:
        raw = decode_raw(req.image_b64, settings.max_image_bytes)
        return await asyncio.to_thread(assess, raw)

    @app.post("/internal/v1/analyze", tags=["assistant"], response_model=AnalyzeResponse,
              dependencies=[Depends(require_internal)],
              responses={**ERRORS, 502: {"model": ErrorResponse, "description": "Assistant unavailable"}},
              summary="Shopping list, TL price ranges and renovation lines for a room image")
    async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
        image = decode_image(req.image_b64, settings.max_image_bytes, 1568)
        return await assistant.analyze(req, image)

    @app.post("/internal/v1/chat", tags=["assistant"], response_model=ChatResponse,
              dependencies=[Depends(require_internal)],
              responses={**ERRORS, 502: {"model": ErrorResponse, "description": "Assistant unavailable"}},
              summary="Design chat; suggestions limited to catalog ids")
    async def chat(req: ChatRequest) -> ChatResponse:
        for m in req.messages:
            if m.image_b64:
                m.image_b64 = to_b64(decode_image(m.image_b64, settings.max_image_bytes, 1568))
        return await assistant.chat(req)

    return app


app = create_app(get_settings())
