"""FastAPI application entry point for cli-proxy."""

import time
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from .config import load_config, Config
from .converter.request import convert_request
from .converter.response import convert_nonstream, stream_generator
from .logger import log_request, log_response, log_error

config: Config = load_config()
app = FastAPI(title="cli-proxy", version="0.1.0")


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

    log_request(model, msg_count, stream)
    start = time.time()

    try:
        ds_payload = convert_request(body, config.model_map)
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
            stream_generator(ds_payload, config.api_base, api_key),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Non-streaming
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=60.0, pool=10.0)
        ) as client:
            resp = await client.post(
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
        codex_resp = convert_nonstream(resp.json())
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
