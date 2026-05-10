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
_path: Path | None = None


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


def append(session_id: str, reasoning: str) -> None:
    """Append a reasoning entry and persist to disk."""
    global _dirty
    store = get(session_id)
    store.append(reasoning)
    _dirty = True
    _save()


def reset(session_id: str) -> None:
    """Clear the reasoning store for a session (new conversation detected)."""
    global _dirty
    if session_id in _stores and _stores[session_id]:
        _stores[session_id] = []
        _dirty = True
        _save()
        _logger.info("Reset reasoning store for session %s (new conversation)", session_id)


def _save() -> None:
    global _dirty
    if _path is None or not _dirty:
        return
    with _lock:
        if not _dirty:
            return
        try:
            _path.write_text(json.dumps(_stores, ensure_ascii=False), "utf-8")
            _dirty = False
        except OSError as e:
            _logger.warning("Failed to save reasoning stores: %s", e)
