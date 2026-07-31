"""In-process stand-in for Upstash Redis, for local development only.

The app normally keeps every room in Upstash. Without credentials there is no
store at all, so `npm run dev` cannot deal a single hand. This module fills that
gap with a dict that implements the tiny slice of the Redis API the app uses:
``get``, ``set`` (with ``ex`` / ``nx``) and ``delete``.

It is deliberately not a Redis replacement: state lives in one process and
disappears on restart, so it must never be used in production. ``main.py`` only
falls back to it when no Upstash URL is configured.
"""

from __future__ import annotations

import time
from typing import Any


class LocalStore:
    """Single-process key/value store with TTL support."""

    def __init__(self) -> None:
        self._data: dict[str, tuple[str, float | None]] = {}

    def _live_value(self, key: str) -> str | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at is not None and expires_at <= time.time():
            self._data.pop(key, None)
            return None
        return value

    async def get(self, key: str) -> str | None:
        return self._live_value(key)

    async def set(
        self,
        key: str,
        value: Any,
        ex: int | None = None,
        nx: bool = False,
    ) -> str | None:
        # `nx` means "only if absent" — used by the room lock.
        if nx and self._live_value(key) is not None:
            return None
        self._data[key] = (value, time.time() + ex if ex else None)
        return "OK"

    async def delete(self, *keys: str) -> int:
        removed = 0
        for key in keys:
            if self._data.pop(key, None) is not None:
                removed += 1
        return removed

    # The two compare-and-swap operations the room lock needs. Against Upstash
    # these are Lua scripts; here the whole method runs without an await, so it
    # is already atomic with respect to other tasks on this loop.
    async def compare_delete(self, key: str, token: str) -> int:
        if self._live_value(key) != token:
            return 0
        self._data.pop(key, None)
        return 1

    async def compare_set(
        self, key: str, value: str, ex: int, lock_key: str, token: str
    ) -> bool:
        """Write ``key`` only while ``lock_key`` still holds ``token``."""
        if self._live_value(lock_key) != token:
            return False
        self._data[key] = (value, time.time() + ex if ex else None)
        return True
