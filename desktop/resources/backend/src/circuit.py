"""Circuit breaker for upstream resilience."""

import time
import logging
from enum import Enum

_logger = logging.getLogger("cli-proxy")


class State(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """Three-state circuit breaker for upstream API calls.

    CLOSED   → normal operation, failures increment counter
    OPEN     → requests rejected immediately, cooldown timer runs
    HALF_OPEN → single probe request allowed after cooldown
    """

    def __init__(self, failure_threshold: int = 5, cooldown_seconds: float = 30.0):
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self._state = State.CLOSED
        self._failure_count = 0
        self._opened_at: float = 0.0
        self._probe_in_flight: bool = False
        self._probe_started_at: float = 0.0

    @property
    def state(self) -> State:
        return self._state

    def allow_request(self) -> bool:
        """Check if a request should be allowed through.

        CLOSED     → always allow.
        OPEN       → reject until cooldown expires, then transition to HALF_OPEN.
        HALF_OPEN  → allow exactly one probe; reject others until probe completes.
        """
        if self._state == State.CLOSED:
            return True

        if self._state == State.OPEN:
            if time.monotonic() - self._opened_at >= self.cooldown_seconds:
                self._state = State.HALF_OPEN
                self._probe_in_flight = False
            else:
                return False

        # HALF_OPEN: allow only one probe request at a time
        if self._state == State.HALF_OPEN:
            # Auto-reset stuck probe (e.g. after asyncio.CancelledError)
            if self._probe_in_flight and (
                time.monotonic() - self._probe_started_at >= 2 * self.cooldown_seconds
            ):
                self._probe_in_flight = False
                _logger.warning("CircuitBreaker: probe stuck > %.0fs, auto-reset",
                                2 * self.cooldown_seconds)

            if self._probe_in_flight:
                return False
            self._probe_in_flight = True
            self._probe_started_at = time.monotonic()
            return True

        return False

    def record_success(self) -> None:
        """Record a successful upstream response."""
        self._probe_in_flight = False
        if self._state == State.HALF_OPEN:
            self._state = State.CLOSED
            self._failure_count = 0
        elif self._state == State.CLOSED:
            self._failure_count = 0

    def record_failure(self) -> None:
        """Record a failed upstream response."""
        self._probe_in_flight = False
        if self._state == State.HALF_OPEN:
            self._state = State.OPEN
            self._opened_at = time.monotonic()
        elif self._state == State.CLOSED:
            self._failure_count += 1
            if self._failure_count >= self.failure_threshold:
                self._state = State.OPEN
                self._opened_at = time.monotonic()
