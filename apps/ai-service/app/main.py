import asyncio
import hmac
import logging
import time
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .assistant import Assistant, AssistantUnavailable
from .config import Settings, get_settings
from .images import ImageInputError, decode_image, to_b64
from .prompts import build_prompt
from .providers import ProviderError, create_provider
from .schemas import (
    AnalyzeRequest, AnalyzeResponse, ChatRequest, ChatResponse, GenerateRequest, GenerateResponse,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("ai-service")

MAX_BODY_BYTES = 40 * 1024 * 1024

settings = get_settings()
provider = create_provider(settings)
assistant = Assistant(settings)
generation_slots = asyncio.Semaphore(settings.max_concurrent_generations)

app = FastAPI(title="AI Room AI Service", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


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


def require_internal(x_internal_token: str | None = Header(default=None), cfg: Settings = Depends(get_settings)) -> None:
    # NET-04: only the backend holds this token; constant-time comparison.
    if not x_internal_token or not hmac.compare_digest(x_internal_token.encode(), cfg.internal_token.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


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
    log.warning('{"event":"provider_error","provider":"%s","reason":"%s"}', provider.name, exc)
    return error(502, "ai_unavailable", "Image provider failed")


@app.exception_handler(AssistantUnavailable)
async def assistant_error(_: Request, exc: AssistantUnavailable):
    log.warning('{"event":"assistant_error","reason":"%s"}', exc)
    return error(502, "ai_unavailable", "Assistant unavailable")


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/internal/v1/health", dependencies=[Depends(require_internal)])
async def health():
    return {"status": "ok", "provider": provider.name, "chat_enabled": settings.chat_enabled}


@app.post("/internal/v1/generate", response_model=GenerateResponse, dependencies=[Depends(require_internal)])
async def generate(req: GenerateRequest) -> GenerateResponse:
    image = decode_image(req.image_b64, settings.max_image_bytes)
    reference_style = None
    if req.tool == "reference":
        if not req.reference_image_b64:
            raise HTTPException(status_code=400, detail="reference_image_required")
        reference_style = await assistant.describe_reference(decode_image(req.reference_image_b64, settings.max_image_bytes, 1024))
    prompt = build_prompt(req, reference_style)
    tint = req.color_hex if req.tool == "paint" else None

    async def one(variant: int) -> bytes:
        async with generation_slots:
            return await provider.generate(image, prompt, variant, tint)

    results = await asyncio.gather(*(one(i) for i in range(req.variants)))
    # Re-validate provider output before it leaves the service.
    images = [to_b64(decode_image(to_b64(r), 25 * 1024 * 1024)) for r in results]
    return GenerateResponse(images_b64=images, prompt=prompt, provider=provider.name, reference_style=reference_style)


@app.post("/internal/v1/analyze", response_model=AnalyzeResponse, dependencies=[Depends(require_internal)])
async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    image = decode_image(req.image_b64, settings.max_image_bytes, 1568)
    return await assistant.analyze(req, image)


@app.post("/internal/v1/chat", response_model=ChatResponse, dependencies=[Depends(require_internal)])
async def chat(req: ChatRequest) -> ChatResponse:
    for m in req.messages:
        if m.image_b64:
            m.image_b64 = to_b64(decode_image(m.image_b64, settings.max_image_bytes, 1568))
    return await assistant.chat(req)
