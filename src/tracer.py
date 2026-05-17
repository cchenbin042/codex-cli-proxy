"""Request tracing middleware with trace_id propagation via contextvars."""

import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


_trace_id_ctx: ContextVar[str] = ContextVar("trace_id", default="")


def generate_trace_id() -> str:
    """Generate a trace ID: 'tr_' prefix + 24 lowercase hex chars (27 total)."""
    return f"tr_{uuid.uuid4().hex[:24]}"


def get_trace_id() -> str:
    """Return the current trace_id from the request context, or empty string."""
    return _trace_id_ctx.get()


class TraceMiddleware(BaseHTTPMiddleware):
    """Middleware that ensures every request has a trace_id.

    Reads X-Trace-Id from request headers (if present), otherwise generates
    a new one. Attaches it to request.state.trace_id, sets it in the contextvar
    for logging, and adds it as a response header.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        trace_id = request.headers.get("X-Trace-Id") or generate_trace_id()
        request.state.trace_id = trace_id
        _trace_id_ctx.set(trace_id)

        response = await call_next(request)

        response.headers["X-Trace-Id"] = trace_id
        return response
