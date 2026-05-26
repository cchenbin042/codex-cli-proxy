"""Audit logging with JSONL daily-rotated files.

Writes one JSON line per proxy request, including trace_id, timing,
model info, and status. Files are named by date (YYYY-MM-DD.jsonl).

File I/O is offloaded to a background daemon thread via a thread-safe queue
to avoid blocking the async event loop.
"""

import json
import queue
import threading
from datetime import datetime, timezone
from pathlib import Path


class AuditWriter:
    """Append-only JSONL audit log writer with daily file rotation.

    Uses a background thread to decouple file I/O from the async request path.
    Call ``close()`` on shutdown to flush remaining entries.
    """

    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._queue: queue.Queue[dict | None] = queue.Queue()
        self._worker = threading.Thread(target=self._drain, daemon=True)
        self._worker.start()

    def write(self, entry: dict) -> None:
        """Enqueue a single audit entry for background writing.

        Non-blocking: pushes to a thread-safe queue and returns immediately.
        A 'timestamp' field is automatically added if not present.
        """
        now = datetime.now(timezone.utc)
        entry.setdefault("timestamp", now.isoformat())
        entry["_date"] = now.strftime("%Y-%m-%d")
        self._queue.put(entry)

    def _drain(self) -> None:
        """Background thread: drain the queue and write entries to disk."""
        while True:
            entry = self._queue.get()
            if entry is None:  # shutdown signal
                self._queue.task_done()
                break
            try:
                date_str = entry.pop("_date")
                filepath = self.base_dir / f"{date_str}.jsonl"
                with open(filepath, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            except Exception:
                pass
            finally:
                self._queue.task_done()

    def close(self) -> None:
        """Signal the background thread to stop and flush remaining entries."""
        self.flush()
        self._queue.put(None)
        self._worker.join(timeout=5.0)

    def flush(self) -> None:
        """Block until all queued entries have been written to disk."""
        self._queue.join()

    def read_date(self, date_str: str) -> list[dict]:
        """Read all entries for a given date (YYYY-MM-DD)."""
        filepath = self.base_dir / f"{date_str}.jsonl"
        if not filepath.exists():
            return []
        entries = []
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    entries.append(json.loads(line))
        return entries
