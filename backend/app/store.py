"""A tiny JSON-file repository for saved quotes.

Limitations (documented in README/DECISIONS): one process only, whole-file
rewrites, no indexing. Writes go to a temp file and are swapped in with
``os.replace`` so a crash mid-write can't leave a half-written file behind.
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

Record = dict[str, Any]


class QuoteStore:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def list(self) -> list[Record]:
        with self._lock:
            return list(self._read().values())

    def get(self, quote_id: str) -> Record | None:
        with self._lock:
            return self._read().get(quote_id)

    def create(self, build: Callable[[str], Record]) -> Record:
        """Allocate the next id and persist ``build(id)`` atomically."""
        with self._lock:
            quotes = self._read()
            quote_id = f"Q-{len(quotes) + 1:04d}"
            while quote_id in quotes:  # defensive; ids are never reused
                quote_id = f"Q-{int(quote_id[2:]) + 1:04d}"
            record = build(quote_id)
            quotes[quote_id] = record
            self._write(quotes)
            return record

    def update(self, quote_id: str, change: Callable[[Record], Record]) -> Record | None:
        """Apply ``change`` under the lock. ``change`` may raise to abort without writing."""
        with self._lock:
            quotes = self._read()
            current = quotes.get(quote_id)
            if current is None:
                return None
            updated = change(current)
            quotes[quote_id] = updated
            self._write(quotes)
            return updated

    def _read(self) -> dict[str, Record]:
        if not self._path.exists():
            return {}
        data = json.loads(self._path.read_text(encoding="utf-8") or "{}")
        return {record["id"]: record for record in data.get("quotes", [])}

    def _write(self, quotes: dict[str, Record]) -> None:
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp.write_text(json.dumps({"quotes": list(quotes.values())}, indent=2), encoding="utf-8")
        os.replace(tmp, self._path)
