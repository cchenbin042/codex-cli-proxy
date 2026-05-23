"""FastAPI application entry point for cli-proxy."""

import time
import sys
import asyncio
import random
from pathlib import Path
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

import logging
from src.config import load_config, Config
from src import store

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = str(PROJECT_ROOT / "config.yaml")
from src.converter.request import convert_request
from src.converter.response import convert_nonstream, stream_generator
from src.logger import (log_request, log_response, log_error, log_conversation,
                         log_upstream_response, log_downstream_response)
from src.tracer import TraceMiddleware, get_trace_id
from src.circuit import CircuitBreaker
from src.ratelimit import RateLimitMiddleware
from src.providers.deepseek import DeepSeekProvider
from src.providers.qwen import QwenProvider
from src.providers.moonshot import MoonshotProvider
from src.providers.bailian import BailianProvider
from src.providers.siliconflow import SiliconFlowProvider
from src.providers.base import BaseProvider
from src.cache import ResponseCache
from src.audit import AuditWriter

_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(logging.Formatter(
    "%(asctime)s  %(name)-20s  %(levelname)-8s  %(message)s"
))
_handler.setLevel(logging.DEBUG)

for _name in ("cli-proxy", "cli-proxy.debug"):
    _l = logging.getLogger(_name)
    _l.setLevel(logging.DEBUG)
    _l.addHandler(_handler)
    _l.propagate = False

_logger = logging.getLogger("cli-proxy.debug")

config: Config = load_config(DEFAULT_CONFIG_PATH)
store.init(str(PROJECT_ROOT / "reasoning_stores.json"))


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Create shared httpx.AsyncClient and initialize reliability components."""
    application.state.http = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10.0, read=120.0, write=60.0, pool=10.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    )
    _logger.info("Shared httpx.AsyncClient created (max_connections=%d, max_keepalive=%d)", 20, 10)

    application.state.semaphore = asyncio.Semaphore(
        config.reliability.concurrency.max_concurrent
    )
    _logger.info("Semaphore initialized (max_concurrent=%d)",
                 config.reliability.concurrency.max_concurrent)

    application.state.circuit_breaker = CircuitBreaker(
        failure_threshold=config.reliability.circuit_breaker.failure_threshold,
        cooldown_seconds=config.reliability.circuit_breaker.cooldown_seconds,
    )
    _logger.info("CircuitBreaker initialized (threshold=%d, cooldown=%.1fs)",
                 config.reliability.circuit_breaker.failure_threshold,
                 config.reliability.circuit_breaker.cooldown_seconds)

    application.state.rate_limiter = RateLimitMiddleware(
        rate=config.reliability.rate_limit.requests_per_minute,
        capacity=config.reliability.rate_limit.burst_size,
    )
    _logger.info("RateLimiter initialized (rate=%d/min, burst=%d)",
                 config.reliability.rate_limit.requests_per_minute,
                 config.reliability.rate_limit.burst_size)

    # Initialize providers from config
    application.state.providers: dict[str, BaseProvider] = {}
    _provider_classes = {
        "deepseek": DeepSeekProvider,
        "qwen": QwenProvider,
        "moonshot": MoonshotProvider,
        "bailian": BailianProvider,
        "siliconflow": SiliconFlowProvider,
    }
    for pname, pcfg in config.providers.items():
        pcls = _provider_classes.get(pname)
        if pcls and pcfg.api_keys:
            application.state.providers[pname] = pcls(pcfg.api_base, pcfg.api_keys)
            _logger.info("Provider '%s' initialized (api_base=%s, keys=%d)",
                         pname, pcfg.api_base, len(pcfg.api_keys))

    # Always ensure a default deepseek provider from top-level config
    if "deepseek" not in application.state.providers:
        application.state.providers["deepseek"] = DeepSeekProvider(
            config.api_base, config.api_keys
        )
        _logger.info("Default DeepSeek provider initialized (api_base=%s)", config.api_base)

    # Initialize response cache (LRU + TTL)
    application.state.cache = ResponseCache(max_size=100, ttl_seconds=300.0)
    _logger.info("ResponseCache initialized (max_size=%d, ttl=%.0fs)", 100, 300.0)

    # Initialize audit writer (JSONL daily rotation)
    audit_dir = str(PROJECT_ROOT / "audit_logs")
    application.state.audit = AuditWriter(audit_dir)
    _logger.info("AuditWriter initialized (dir=%s)", audit_dir)

    yield

    await application.state.http.aclose()
    _logger.info("Shared httpx.AsyncClient closed")

    application.state.audit.close()
    _logger.info("AuditWriter closed")

    store.flush()
    _logger.info("Reasoning store flushed")


app = FastAPI(title="cli-proxy", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def debug_middleware(request: Request, call_next):
    safe_headers = {
        k: ("***" if k.lower() == "authorization" else v)
        for k, v in request.headers.items()
    }
    _logger.info(">>> %s %s  headers=%s", request.method, request.url.path, safe_headers)
    response = await call_next(request)
    _logger.info("<<< %s %s  status=%s", request.method, request.url.path, response.status_code)
    return response


# TraceMiddleware added after debug_middleware so it's outermost (runs first)
# This ensures trace_id is set before any logging happens.
app.add_middleware(TraceMiddleware)


def _resolve_provider_for_request(
    model: str, providers: dict[str, BaseProvider]
) -> tuple[BaseProvider, str]:
    """Resolve provider and vendor model name for a request model.

    Uses config.model_map with 'provider:model' format for routing.
    Falls back to deepseek provider.
    """
    provider_name = config.get_provider_name(model)
    vendor_model = config.get_provider_model(model)
    provider = providers.get(provider_name, providers.get("deepseek"))
    return provider, vendor_model


def _write_audit(
    audit_writer, model: str, vendor_model: str, msg_count: int,
    elapsed_ms: int, status: str, stream: bool = False,
) -> None:
    """Write an audit entry, swallowing any exceptions.

    Audit logging is best-effort; failures must never affect the response.
    """
    try:
        audit_writer.write({
            "trace_id": get_trace_id(),
            "model": model,
            "vendor_model": vendor_model,
            "provider": config.get_provider_name(model),
            "stream": stream,
            "elapsed_ms": elapsed_ms,
            "status": status,
            "msg_count": msg_count,
        })
    except Exception:
        pass


async def _call_with_retry(
    provider: "BaseProvider",
    payload: dict,
    http_client: httpx.AsyncClient,
    max_retries: int = 3,
    backoff_base: float = 2.0,
) -> httpx.Response:
    """Call upstream via provider with exponential backoff retry.

    Only retries on 5xx status codes, httpx.ConnectError, and httpx.ReadError.
    4xx errors (including 401) are returned immediately without retry.
    """
    last_response: httpx.Response | None = None
    for attempt in range(max_retries):
        try:
            response = await provider.chat_completions(payload, http_client)
            if response.status_code < 500:
                return response
            # 5xx: will retry
            last_response = response
            _logger.warning("Upstream 5xx (attempt %d/%d): %s",
                          attempt + 1, max_retries, response.status_code)
        except (httpx.ConnectError, httpx.ReadError) as e:
            _logger.warning("Upstream error (attempt %d/%d): %s",
                          attempt + 1, max_retries, e)
            if attempt == max_retries - 1:
                raise
        except httpx.TimeoutException as e:
            _logger.warning("Upstream timeout (attempt %d/%d): %s",
                          attempt + 1, max_retries, e)
            if attempt == max_retries - 1:
                raise

        if attempt < max_retries - 1:
            wait = backoff_base ** attempt + random.random()
            _logger.info("Retrying in %.2fs...", wait)
            await asyncio.sleep(wait)

    return last_response


@app.post("/v1/responses")
async def proxy_responses(request: Request):
    """Proxy Codex Responses API requests to DeepSeek Chat Completions.

    Reliability layers (configured in config.yaml):
      1. Rate Limiter  -- token bucket per client IP
      2. Circuit Breaker -- blocks requests when upstream is failing
      3. Semaphore -- limits concurrent upstream calls
      4. Retry -- exponential backoff on 5xx/connection errors
    """
    # --- Rate Limit check ---
    xff = request.headers.get("X-Forwarded-For")
    client_ip = request.client.host if request.client else "unknown"
    allowed, retry_after = request.app.state.rate_limiter.allow_request(
        RateLimitMiddleware._get_client_ip(client_ip, xff)
    )
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={
                "type": "error",
                "error": {"code": "rate_limit_exceeded", "message": "Too many requests"},
            },
            headers={"Retry-After": str(retry_after)},
        )

    # --- Circuit Breaker check ---
    cb: CircuitBreaker = request.app.state.circuit_breaker
    if not cb.allow_request():
        return JSONResponse(
            status_code=503,
            content={
                "type": "error",
                "error": {"code": "circuit_open", "message": "Circuit breaker is open. Upstream is unavailable."},
            },
        )

    # --- Semaphore acquisition with timeout ---
    try:
        await asyncio.wait_for(
            request.app.state.semaphore.acquire(),
            timeout=config.reliability.concurrency.queue_timeout,
        )
    except asyncio.TimeoutError:
        return JSONResponse(
            status_code=503,
            content={
                "type": "error",
                "error": {"code": "concurrency_limit", "message": "Too many concurrent requests"},
            },
        )

    try:
        body = await request.json()
    except Exception:
        request.app.state.semaphore.release()
        return JSONResponse(
            status_code=400,
            content={
                "type": "error",
                "error": {"code": "invalid_request", "message": "Request body is not valid JSON"},
            },
        )

    model = body.get("model", "unknown")
    msg_count = len(body.get("input", []))
    stream = body.get("stream", False)
    session_id = request.headers.get("session_id", "")

    log_request(model, msg_count, stream)
    log_conversation(body)
    start = time.time()

    # Resolve provider and vendor model
    provider, vendor_model = _resolve_provider_for_request(
        model, request.app.state.providers
    )

    try:
        ds_payload = convert_request(body, config.model_map, session_id,
                                      config.thinking_disabled)
    except Exception as e:
        request.app.state.semaphore.release()
        cb.record_failure()
        log_error(f"Request conversion failed: {e}")
        return JSONResponse(
            status_code=400,
            content={
                "type": "error",
                "error": {"code": "conversion_error", "message": str(e)},
            },
        )

    # Use vendor model name in the payload sent upstream
    ds_payload["model"] = vendor_model

    if stream:
        # Stream path: semaphore released after stream completes
        async def stream_with_retry():
            max_retries = config.reliability.retry.max_retries
            backoff = config.reliability.retry.backoff_base
            last_exception = None
            try:
                for attempt in range(max_retries):
                    try:
                        async for event in stream_generator(
                            ds_payload, session_id=session_id,
                            http_client=request.app.state.http,
                            provider=provider,
                        ):
                            yield event
                        # Stream completed successfully
                        cb.record_success()
                        _write_audit(request.app.state.audit, model, vendor_model,
                                     msg_count, int((time.time() - start) * 1000),
                                     "completed", stream=True)
                        return
                    except (httpx.ConnectError, httpx.ReadError) as e:
                        last_exception = e
                        _logger.warning("Stream error (attempt %d/%d): %s",
                                      attempt + 1, max_retries, e)
                        if attempt < max_retries - 1:
                            wait = backoff ** attempt + random.random()
                            _logger.info("Retrying stream in %.2fs...", wait)
                            await asyncio.sleep(wait)
                    except Exception as e:
                        # Non-retryable error in stream
                        log_error(f"Stream failed: {e}")
                        cb.record_failure()
                        _write_audit(request.app.state.audit, model, vendor_model,
                                     msg_count, int((time.time() - start) * 1000),
                                     "stream_error", stream=True)
                        return

                # All retries exhausted
                cb.record_failure()
                _write_audit(request.app.state.audit, model, vendor_model,
                             msg_count, int((time.time() - start) * 1000),
                             "upstream_unavailable", stream=True)
                yield f"event: error\ndata: {{\"type\":\"error\",\"error\":{{\"code\":\"upstream_unavailable\",\"message\":\"{str(last_exception)}\"}}}}\n\n"
            finally:
                request.app.state.semaphore.release()

        return StreamingResponse(
            stream_with_retry(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Non-streaming path
    # Check response cache first (X-No-Cache header bypasses cache)
    no_cache = request.headers.get("X-No-Cache", "").lower() == "true"
    cache: ResponseCache = request.app.state.cache
    if not no_cache:
        cached_response = cache.get(ds_payload)
        if cached_response is not None:
            elapsed = int((time.time() - start) * 1000)
            log_response(model, elapsed, "cache_hit")
            _write_audit(request.app.state.audit, model, vendor_model,
                         msg_count, elapsed, "cache_hit", stream=False)
            request.app.state.semaphore.release()
            return cached_response

    try:
        resp = await _call_with_retry(
            provider=provider,
            payload=ds_payload,
            http_client=request.app.state.http,
            max_retries=config.reliability.retry.max_retries,
            backoff_base=config.reliability.retry.backoff_base,
        )
    except (httpx.ConnectError, httpx.ReadError, httpx.TimeoutException) as e:
        elapsed = int((time.time() - start) * 1000)
        log_response(model, elapsed, "upstream_unavailable")
        cb.record_failure()
        request.app.state.semaphore.release()
        _write_audit(request.app.state.audit, model, vendor_model,
                     msg_count, elapsed, "upstream_unavailable", stream=False)
        return JSONResponse(
            status_code=502,
            content={
                "type": "error",
                "error": {"code": "upstream_unavailable", "message": str(e)},
            },
        )
    except Exception as e:
        log_error(f"Unexpected error in non-streaming path: {e}")
        cb.record_failure()
        request.app.state.semaphore.release()
        return JSONResponse(
            status_code=500,
            content={
                "type": "error",
                "error": {"code": "internal_error", "message": "Internal server error"},
            },
        )

    elapsed = int((time.time() - start) * 1000)

    if resp.status_code >= 500:
        log_response(model, elapsed, f"upstream_{resp.status_code}")
        cb.record_failure()
        request.app.state.semaphore.release()
        _write_audit(request.app.state.audit, model, vendor_model,
                     msg_count, elapsed, f"upstream_{resp.status_code}", stream=False)
        return JSONResponse(
            status_code=resp.status_code,
            content={
                "type": "error",
                "error": {
                    "code": f"upstream_{resp.status_code}",
                    "message": resp.text[:500],
                },
            },
        )

    if resp.status_code >= 400:
        log_response(model, elapsed, f"upstream_{resp.status_code}")
        request.app.state.semaphore.release()
        _write_audit(request.app.state.audit, model, vendor_model,
                     msg_count, elapsed, f"upstream_{resp.status_code}", stream=False)
        return JSONResponse(
            status_code=resp.status_code,
            content={
                "type": "error",
                "error": {
                    "code": f"upstream_{resp.status_code}",
                    "message": resp.text[:500],
                },
            },
        )

    # Successful response
    cb.record_success()

    try:
        ds_resp = resp.json()
        log_upstream_response(ds_resp)
        codex_resp = convert_nonstream(ds_resp, session_id)
        log_downstream_response(codex_resp)
    except Exception as e:
        log_error(f"Response conversion failed: {e}")
        request.app.state.semaphore.release()
        return JSONResponse(
            status_code=500,
            content={
                "type": "error",
                "error": {"code": "conversion_error", "message": str(e)},
            },
        )

    # Cache the successful response
    cache.set(ds_payload, codex_resp)

    log_response(model, elapsed, "completed")
    _write_audit(request.app.state.audit, model, vendor_model,
                 msg_count, elapsed, "completed", stream=False)
    request.app.state.semaphore.release()
    return codex_resp


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=config.server_host,
        port=config.server_port,
        log_config=None,
    )
    print(f"Server running at http://{config.server_host}:{config.server_port}")
