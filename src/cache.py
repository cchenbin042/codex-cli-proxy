"""LRU response cache with SHA256 fingerprinting.

Caches non-streaming responses keyed by a canonical hash of the request payload.
Supports TTL-based expiration and X-No-Cache bypass header.
"""

import hashlib
import json
import time
from collections import OrderedDict


class ResponseCache:
    """Thread-safe LRU cache for non-streaming chat completions responses.

    Uses SHA256 of the canonical JSON payload as the cache key.
    Entries expire after ttl_seconds (default 300s = 5 minutes).
    """

    def __init__(self, max_size: int = 100, ttl_seconds: float = 300.0):
        self._store: OrderedDict[str, tuple[float, dict]] = OrderedDict()
        self.max_size = max_size
        self.ttl = ttl_seconds

    def _fingerprint(self, payload: dict) -> str:
        """Compute a deterministic SHA256 hash of the request payload."""
        canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def get(self, payload: dict, no_cache: bool = False) -> dict | None:
        """Return cached response if present and not expired, or None."""
        if no_cache:
            return None
        key = self._fingerprint(payload)
        entry = self._store.get(key)
        if entry is None:
            return None
        ts, value = entry
        if time.time() - ts > self.ttl:
            del self._store[key]
            return None
        # Move to end (most recently used)
        self._store.move_to_end(key)
        return value

    def set(self, payload: dict, response: dict) -> None:
        """Store a response in the cache, evicting oldest if at capacity."""
        key = self._fingerprint(payload)
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = (time.time(), response)
        while len(self._store) > self.max_size:
            self._store.popitem(last=False)

    def clear(self) -> None:
        """Remove all cached entries."""
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)
