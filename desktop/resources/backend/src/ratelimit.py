"""Token bucket rate limiter for request throttling."""

import time
import threading


class TokenBucket:
    """Token bucket algorithm for per-client rate limiting.

    Tokens are added at a constant rate (tokens/second) up to capacity.
    Each request consumes 1 token. If no tokens available, request is denied.
    """

    def __init__(self, rate: int, capacity: int):
        self._rate = rate / 60.0  # convert per-minute to per-second
        self._capacity = float(capacity)
        self._tokens = float(capacity)
        self._last_refill = time.monotonic()
        self.last_used = time.monotonic()

    def _refill(self) -> None:
        """Add tokens based on elapsed time since last refill."""
        now = time.monotonic()
        elapsed = now - self._last_refill
        new_tokens = elapsed * self._rate
        self._tokens = min(self._capacity, self._tokens + new_tokens)
        self._last_refill = now

    def consume(self) -> bool:
        """Try to consume 1 token. Returns True if successful."""
        self.last_used = time.monotonic()
        self._refill()
        if self._tokens >= 1.0:
            self._tokens -= 1.0
            return True
        return False


class RateLimitMiddleware:
    """Per-client IP token bucket rate limiter.

    Creates one TokenBucket per client IP. Can be used as FastAPI middleware
    or called directly from endpoint handlers.
    """

    def __init__(self, rate: int = 30, capacity: int = 30, bucket_ttl: float = 300.0):
        self._rate = rate
        self._capacity = capacity
        self._buckets: dict[str, TokenBucket] = {}
        self._lock = threading.Lock()
        self._bucket_ttl = bucket_ttl
        self._evict_counter = 0

    def _get_key(self, client_ip: str) -> str:
        """Get or create a bucket key for a client IP."""
        if client_ip not in self._buckets:
            with self._lock:
                if client_ip not in self._buckets:
                    self._buckets[client_ip] = TokenBucket(
                        rate=self._rate, capacity=self._capacity
                    )
        return client_ip

    def _evict_expired(self) -> int:
        """Remove buckets unused for longer than _bucket_ttl seconds.

        Called periodically from allow_request(). Returns count of evicted buckets.
        """
        now = time.monotonic()
        expired = [
            ip for ip, bucket in self._buckets.items()
            if now - bucket.last_used >= self._bucket_ttl
        ]
        for ip in expired:
            del self._buckets[ip]
        return len(expired)

    def allow_request(self, client_ip: str) -> tuple[bool, int]:
        """Check if a request from this IP should be allowed.

        Returns (allowed, retry_after_seconds).
        """
        # Periodic eviction: clean up every 100 requests
        self._evict_counter += 1
        if self._evict_counter % 100 == 0:
            self._evict_expired()

        key = self._get_key(client_ip)
        bucket = self._buckets[key]
        if bucket.consume():
            return True, 0
        # Calculate retry-after: time to refill 1 token at current rate
        retry_after = int(60.0 / self._rate)
        return False, max(1, retry_after)

    @staticmethod
    def _get_client_ip(client_host: str,
                       x_forwarded_for: str | None = None) -> str:
        """Extract the real client IP from request headers."""
        if x_forwarded_for:
            # Use the first IP in X-Forwarded-For chain
            return x_forwarded_for.split(",")[0].strip()
        return client_host
