"""Structured logging for cli-proxy."""

import logging

_logger = logging.getLogger("cli-proxy")


def log_request(model: str, msg_count: int, stream: bool) -> None:
    _logger.info(
        "Request: model=%s, messages=%d, stream=%s",
        model, msg_count, stream,
    )


def log_response(model: str, elapsed_ms: int, status: str) -> None:
    _logger.info(
        "Response: model=%s, elapsed=%dms, status=%s",
        model, elapsed_ms, status,
    )


def log_error(message: str) -> None:
    _logger.error("Error: %s", message)


def log_warning(message: str) -> None:
    _logger.warning("Warning: %s", message)
