"""Structured logging for cli-proxy."""

import logging

from src.tracer import get_trace_id


class _TraceAdapter(logging.LoggerAdapter):
    """LoggerAdapter that prepends [trace_id] to all log messages."""

    def process(self, msg, kwargs):
        trace_id = get_trace_id()
        if trace_id:
            return f"[{trace_id}] {msg}", kwargs
        return msg, kwargs


_logger = _TraceAdapter(logging.getLogger("cli-proxy"), {})


def _log_with_trace(logger: logging.Logger, msg: str, *args, **kwargs) -> None:
    """Log a message with the current trace_id prepended.

    Used by external modules that have their own logger instance but want
    trace_id in their output.
    """
    trace_id = get_trace_id()
    if trace_id:
        logger.info(f"[{trace_id}] {msg}", *args, **kwargs)
    else:
        logger.info(msg, *args, **kwargs)


def log_request(model: str, msg_count: int, stream: bool) -> None:
    _logger.info(
        "Request: model=%s, messages=%d, stream=%s",
        model, msg_count, stream,
    )


def log_conversation(body: dict) -> None:
    """Log a human-readable summary of the Codex conversation."""
    instructions = body.get("instructions") or ""
    if instructions:
        _logger.info("System: %s", instructions[:200])

    for item in body.get("input", []):
        item_type = item.get("type")
        if item_type == "message":
            role = item.get("role", "?")
            content_blocks = item.get("content") or []
            text = "".join(
                b.get("text", "") for b in content_blocks
                if isinstance(b, dict) and b.get("type") == "input_text"
            )
            if text:
                _logger.info("  [%s] %s", role, text[:300])
        elif item_type == "function_call":
            _logger.info("  [tool_call] %s(%s)",
                         item.get("name", "?"),
                         item.get("arguments", "")[:200])
        elif item_type == "function_call_output":
            _logger.info("  [tool_result] %s", item.get("output", "")[:200])


def log_response(model: str, elapsed_ms: int, status: str) -> None:
    _logger.info(
        "Response: model=%s, elapsed=%dms, status=%s",
        model, elapsed_ms, status,
    )


def log_upstream_response(ds_resp: dict) -> None:
    """Log DeepSeek API response summary."""
    choices = ds_resp.get("choices", [])
    if choices:
        msg = choices[0].get("message", {})
        content = msg.get("content") or ""
        reasoning = msg.get("reasoning_content") or ""
        tool_calls = msg.get("tool_calls") or []
        if reasoning:
            _logger.info("DeepSeek -> reasoning: %s", reasoning[:200])
        if content:
            _logger.info("DeepSeek -> content: %s", content[:500])
        for tc in tool_calls:
            tc_fn = tc.get("function", {})
            _logger.info("DeepSeek -> tool_call: %s(%s)",
                         tc_fn.get("name", "?"),
                         tc_fn.get("arguments", "")[:300])
    usage = ds_resp.get("usage", {})
    if usage:
        _logger.info("DeepSeek -> usage: prompt=%d completion=%d total=%d reasoning=%d",
                     usage.get("prompt_tokens", 0),
                     usage.get("completion_tokens", 0),
                     usage.get("total_tokens", 0),
                     usage.get("completion_tokens_details", {}).get("reasoning_tokens", 0))


def log_downstream_response(codex_resp: dict) -> None:
    """Log converted Codex response summary."""
    for item in codex_resp.get("output", []):
        item_type = item.get("type")
        if item_type == "message":
            for part in item.get("content", []):
                if part.get("type") == "output_text":
                    _logger.info("Codex <- message: %s", part.get("text", "")[:500])
        elif item_type == "function_call":
            _logger.info("Codex <- tool_call: %s(%s)",
                         item.get("name", "?"),
                         item.get("arguments", "")[:300])


def log_error(message: str) -> None:
    _logger.error("Error: %s", message)


def log_warning(message: str) -> None:
    _logger.warning("Warning: %s", message)
