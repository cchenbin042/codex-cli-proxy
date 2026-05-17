"""FastAPI application entry point for cli-proxy."""

import time
import sys
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
from src.tracer import TraceMiddleware

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
    """Create and cleanup a shared httpx.AsyncClient for connection pooling."""
    application.state.http = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10.0, read=120.0, write=60.0, pool=10.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    )
    _logger.info("Shared httpx.AsyncClient created (max_connections=%d, max_keepalive=%d)", 20, 10)
    yield
    await application.state.http.aclose()
    _logger.info("Shared httpx.AsyncClient closed")


app = FastAPI(title="cli-proxy", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def debug_middleware(request: Request, call_next):
    _logger.info(">>> %s %s  headers=%s", request.method, request.url.path,
                 dict(request.headers))
    response = await call_next(request)
    _logger.info("<<< %s %s  status=%s", request.method, request.url.path, response.status_code)
    return response


# TraceMiddleware added after debug_middleware so it's outermost (runs first)
# This ensures trace_id is set before any logging happens.
app.add_middleware(TraceMiddleware)


@app.post("/v1/responses")
async def proxy_responses(request: Request):
    """Proxy Codex Responses API requests to DeepSeek Chat Completions."""
    try:
        body = await request.json()
    except Exception:
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

    try:
        ds_payload = convert_request(body, config.model_map, session_id,
                                      config.thinking_disabled)
    except Exception as e:
        log_error(f"Request conversion failed: {e}")
        return JSONResponse(
            status_code=400,
            content={
                "type": "error",
                "error": {"code": "conversion_error", "message": str(e)},
            },
        )

    api_key = config.get_api_key()

    if stream:
        return StreamingResponse(
            stream_generator(ds_payload, config.api_base, api_key, session_id,
                             http_client=request.app.state.http),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Non-streaming: use shared connection pool
    try:
        resp = await request.app.state.http.post(
            f"{config.api_base}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=ds_payload,
        )
    except httpx.ConnectError as e:
        elapsed = int((time.time() - start) * 1000)
        log_response(model, elapsed, "upstream_unavailable")
        return JSONResponse(
            status_code=502,
            content={
                "type": "error",
                "error": {"code": "upstream_unavailable", "message": str(e)},
            },
        )

    elapsed = int((time.time() - start) * 1000)

    if resp.status_code >= 400:
        log_response(model, elapsed, f"upstream_{resp.status_code}")
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

    try:
        ds_resp = resp.json()
        log_upstream_response(ds_resp)
        codex_resp = convert_nonstream(ds_resp, session_id)
        log_downstream_response(codex_resp)
    except Exception as e:
        log_error(f"Response conversion failed: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "type": "error",
                "error": {"code": "conversion_error", "message": str(e)},
            },
        )

    log_response(model, elapsed, "completed")
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
