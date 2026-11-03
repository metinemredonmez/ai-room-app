"""Error reporting (Sentry) without personal data — LOG-02 / KVKK.

Reports leave the country, so they never carry request bodies (photos, prompts, chat), headers
(the internal token), query strings, local variables or user data, and every string is masked
before it is sent. Only unhandled errors become events; the request id links them to our logs.
"""

import json
import re
from typing import Any

import sentry_sdk

MASKS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+"), "[data-uri]"),
    (re.compile(r"\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*"), "[jwt]"),
    (re.compile(r"\b(Bearer|Basic|Key)\s+[\w.~+/=:-]{8,}", re.I), r"\1 [token]"),
    (re.compile(r"\b(sk-ant-|AIza|r8_)[\w-]{8,}"), "[api-key]"),
    (re.compile(r"([?&#](?:sig|token|code|key|signature|access_token)=)[^&\s\"']+", re.I), r"\1[redacted]"),
    (re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I), "[email]"),
    (re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "[ip]"),
    (re.compile(r"[A-Za-z0-9+/_-]{100,}={0,2}"), "[blob]"),
]

SECRET_KEY = re.compile(
    r"^(authorization|cookie|x-internal-token|internal_token|api_key|token|secret|password|image|images|"
    r"image_b64|mask|data|text|prompt|messages|instructions|email|ip)$",
    re.I,
)

HEADER_ALLOW = {"user-agent", "content-type", "x-request-id"}


def mask_text(s: str) -> str:
    for pattern, repl in MASKS:
        s = pattern.sub(repl, s)
    return s if len(s) <= 1000 else s[:1000] + "…"


def mask_deep(value: Any, depth: int = 0) -> Any:
    if depth > 5:
        return "[depth]"
    if isinstance(value, str):
        return mask_text(value)
    if isinstance(value, (list, tuple)):
        return [mask_deep(v, depth + 1) for v in list(value)[:30]]
    if isinstance(value, dict):
        return {k: "[redacted]" if SECRET_KEY.match(str(k)) else mask_deep(v, depth + 1) for k, v in value.items()}
    return value


def _strip_query(url: Any) -> Any:
    return mask_text(re.split(r"[?#]", url, maxsplit=1)[0]) if isinstance(url, str) else url


def scrub_breadcrumb(crumb: dict, _hint: dict | None = None) -> dict | None:
    # Our JSON log lines: only the event name travels.
    if crumb.get("category") not in (None, "httplib", "http"):
        message = crumb.get("message") or ""
        try:
            event = str(json.loads(message).get("event", "log"))
        except (ValueError, AttributeError, TypeError):
            event = "log"
        return {"category": "log", "level": crumb.get("level"), "timestamp": crumb.get("timestamp"), "message": mask_text(event)[:80]}
    data = crumb.get("data") or {}
    return {**crumb, "message": mask_text(crumb["message"]) if isinstance(crumb.get("message"), str) else crumb.get("message"),
            "data": {"method": data.get("method"), "status_code": data.get("status_code"), "url": _strip_query(data.get("url"))}}


def scrub_event(event: dict, _hint: dict | None = None) -> dict:
    event.pop("user", None)
    request = event.get("request")
    if isinstance(request, dict):
        headers = {k: v for k, v in (request.get("headers") or {}).items() if k.lower() in HEADER_ALLOW}
        event["request"] = {"method": request.get("method"), "url": _strip_query(request.get("url")), "headers": headers}
    if isinstance(event.get("message"), str):
        event["message"] = mask_text(event["message"])
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        event["logentry"] = {"message": mask_text(str(logentry.get("message", ""))), "params": mask_deep(logentry.get("params") or [])}
    for ex in (event.get("exception") or {}).get("values") or []:
        if isinstance(ex.get("value"), str):
            ex["value"] = mask_text(ex["value"])
        for frame in (ex.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
            # Source lines are our own code, masked anyway in case a literal ever slips into it.
            if isinstance(frame.get("context_line"), str):
                frame["context_line"] = mask_text(frame["context_line"])
            for key in ("pre_context", "post_context"):
                if isinstance(frame.get(key), list):
                    frame[key] = [mask_text(line) for line in frame[key]]
    crumbs = event.get("breadcrumbs")
    if isinstance(crumbs, dict) and isinstance(crumbs.get("values"), list):
        crumbs["values"] = [c for c in (scrub_breadcrumb(b) for b in crumbs["values"]) if c is not None]
    for key in ("extra", "contexts", "tags"):
        if key in event:
            event[key] = mask_deep(event[key])
    return event


_enabled = False


def init_monitoring(dsn: str | None, environment: str, release: str | None, traces_sample_rate: float) -> bool:
    """Sentry stays off without a DSN. Called once from create_app."""
    global _enabled
    if not dsn or _enabled:
        return _enabled
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        traces_sample_rate=traces_sample_rate or None,
        # No auto-instrumentation: the Anthropic / httpx integrations would record prompts and provider URLs.
        auto_enabling_integrations=False,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        max_breadcrumbs=30,
        data_collection={
            "user_info": False,
            "cookies": {"mode": "off"},
            "http_headers": {"request": {"mode": "allowlist", "terms": sorted(HEADER_ALLOW)}},
            "http_bodies": [],
            "url_query_params": {"mode": "off"},
            "gen_ai": {"inputs": False, "outputs": False},
            "database_query_data": False,
            "queues": False,
            "stack_frame_variables": False,
        },
        before_send=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
    )
    _enabled = True
    return _enabled
