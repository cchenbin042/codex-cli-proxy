"""Structured logging for the proxy."""

import time
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
_logger = logging.getLogger("cli-proxy")


def log_request(model: str, msg_count: int, stream: bool) -> None:
    mode = "stream" if stream else "non-stream"
    _logger.info("REQ → model=%s messages=%d mode=%s", model, msg_count, mode)


def log_response(model: str, elapsed_ms: int, status: str = "completed") -> None:
    _logger.info("RES ← model=%s status=%s elapsed=%dms", model, status, elapsed_ms)


def log_warning(msg: str) -> None:
    _logger.warning(msg)


def log_error(msg: str) -> None:
    _logger.error(msg)
