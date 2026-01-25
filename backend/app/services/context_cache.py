"""
Request-level caching for user context data.

This module provides short-lived caching (TTL: 60-300 seconds) for:
- User model prompts (from adaptive learning)
- Intentions context
- Patterns context
- Email context
- Relationship context

Benefits:
- Avoids redundant DB queries within same session
- 10+ messages in a conversation share cached context
- Cached prompts enable OpenAI's automatic prompt caching

Uses in-memory LRU cache with TTL expiration.
For production, consider Redis for multi-instance deployments.
"""

import time
import asyncio
from typing import Any
from collections import OrderedDict
import hashlib


class TTLCache:
    """
    Thread-safe LRU cache with TTL (Time To Live) expiration.

    Features:
    - Automatic expiration of stale entries
    - LRU eviction when max size reached
    - Per-key TTL support
    """

    def __init__(self, maxsize: int = 1000, default_ttl: int = 120):
        """
        Initialize cache.

        Args:
            maxsize: Maximum number of entries
            default_ttl: Default TTL in seconds (2 minutes)
        """
        self._cache: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._maxsize = maxsize
        self._default_ttl = default_ttl
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> tuple[Any, bool]:
        """
        Get value from cache.

        Returns:
            Tuple of (value, found). If not found or expired, returns (None, False).
        """
        async with self._lock:
            if key not in self._cache:
                return None, False

            value, expires_at = self._cache[key]

            # Check expiration
            if time.time() > expires_at:
                del self._cache[key]
                return None, False

            # Move to end (LRU)
            self._cache.move_to_end(key)
            return value, True

    async def set(self, key: str, value: Any, ttl: int | None = None) -> None:
        """
        Set value in cache.

        Args:
            key: Cache key
            value: Value to cache
            ttl: Optional custom TTL in seconds
        """
        ttl = ttl or self._default_ttl
        expires_at = time.time() + ttl

        async with self._lock:
            # Remove oldest if at capacity
            while len(self._cache) >= self._maxsize:
                self._cache.popitem(last=False)

            self._cache[key] = (value, expires_at)

    async def delete(self, key: str) -> None:
        """Delete key from cache."""
        async with self._lock:
            self._cache.pop(key, None)

    async def clear_user(self, user_id: str) -> None:
        """Clear all cached data for a user."""
        prefix = f"user:{user_id}:"
        async with self._lock:
            keys_to_delete = [k for k in self._cache if k.startswith(prefix)]
            for key in keys_to_delete:
                del self._cache[key]

    async def cleanup_expired(self) -> int:
        """Remove all expired entries. Returns count removed."""
        now = time.time()
        removed = 0

        async with self._lock:
            keys_to_delete = [
                k for k, (_, expires_at) in self._cache.items()
                if now > expires_at
            ]
            for key in keys_to_delete:
                del self._cache[key]
                removed += 1

        return removed


# Global cache instance
_context_cache = TTLCache(maxsize=2000, default_ttl=120)  # 2 minute default TTL


def cache_key(user_id: str, context_type: str, extra: str = "") -> str:
    """Generate cache key for user context."""
    if extra:
        # Hash extra data if present (e.g., message for patterns)
        extra_hash = hashlib.md5(extra.encode()).hexdigest()[:8]
        return f"user:{user_id}:{context_type}:{extra_hash}"
    return f"user:{user_id}:{context_type}"


async def get_cached_context(user_id: str, context_type: str, extra: str = "") -> tuple[str | None, bool]:
    """
    Get cached context for user.

    Returns:
        Tuple of (context_string, found)
    """
    key = cache_key(user_id, context_type, extra)
    return await _context_cache.get(key)


async def set_cached_context(
    user_id: str,
    context_type: str,
    value: str,
    extra: str = "",
    ttl: int | None = None
) -> None:
    """
    Cache context for user.

    Args:
        user_id: User ID
        context_type: Type of context (user_model, intentions, patterns, email, relationship)
        value: Context string to cache
        extra: Optional extra key data (e.g., message for patterns)
        ttl: Optional custom TTL in seconds
    """
    key = cache_key(user_id, context_type, extra)
    await _context_cache.set(key, value, ttl)


async def invalidate_user_context(user_id: str) -> None:
    """Invalidate all cached context for a user (call on data changes)."""
    await _context_cache.clear_user(user_id)


# TTL constants for different context types
CONTEXT_TTL = {
    "user_model": 300,      # 5 minutes - rarely changes
    "intentions": 120,      # 2 minutes - may update during session
    "patterns": 600,        # 10 minutes - static analysis
    "email": 60,            # 1 minute - changes frequently
    "relationship": 300,    # 5 minutes - relatively static
}
