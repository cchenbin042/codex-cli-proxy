"""Persisted reasoning stores, keyed by session_id."""
import json
import logging
import threading
from pathlib import Path

_logger = logging.getLogger("cli-proxy")

# {session_id: [reasoning_str, ...]} — append-only per session
_stores: dict[str, list[str]] = {}
_lock = threading.Lock()
_dirty = False
_save_timer: threading.Timer | None = None
_path: Path | None = None

_FLUSH_INTERVAL = 5.0  # seconds to debounce writes


def init(path: str) -> None:
    """Load existing stores from disk. Must be called once on startup."""
    global _path, _stores, _dirty
    _path = Path(path)
    if _path.exists():
        try:
            _stores = json.loads(_path.read_text("utf-8"))
            _logger.info("Loaded reasoning stores for %d sessions from %s",
                         len(_stores), _path)
        except (json.JSONDecodeError, OSError):
            _stores = {}
    else:
        _stores = {}


def get(session_id: str) -> list[str]:
    """Return the reasoning store for a session (mutable list)."""
    if session_id not in _stores:
        _stores[session_id] = []
    return _stores[session_id]


def _schedule_save() -> None:
    """Schedule a debounced disk write. Cancels any pending timer."""
    global _save_timer, _dirty
    _dirty = True
    if _save_timer is not None:
        _save_timer.cancel()
    _save_timer = threading.Timer(_FLUSH_INTERVAL, _save)
    _save_timer.daemon = True
    _save_timer.start()


def append(session_id: str, reasoning: str) -> None:
    """Append a reasoning entry and schedule a debounced disk write."""
    store = get(session_id)
    store.append(reasoning)
    _schedule_save()


def reset(session_id: str) -> None:
    """Clear the reasoning store for a session (new conversation detected)."""
    if session_id in _stores and _stores[session_id]:
        _stores[session_id] = []
        _logger.info("Reset reasoning store for session %s (new conversation)", session_id)
        _schedule_save()


def flush() -> None:
    """Force immediate write to disk. Call before shutdown."""
    global _save_timer
    if _save_timer is not None:
        _save_timer.cancel()
        _save_timer = None
    _save()


def _save() -> None:
    global _dirty, _save_timer
    if _path is None or not _dirty:
        return
    with _lock:
        if not _dirty:
            return
        try:
            _path.write_text(json.dumps(_stores, ensure_ascii=False), "utf-8")
            _dirty = False
            _save_timer = None
        except OSError as e:
            _logger.warning("Failed to save reasoning stores: %s", e)
