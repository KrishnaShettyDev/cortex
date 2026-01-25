"""
Rate Limiter Configuration

Centralized rate limiter instance for use across all API endpoints.
Prevents circular imports between main.py and API route files.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import get_settings

settings = get_settings()

# Use Redis in production if configured, otherwise fall back to in-memory
# Check if redis module is available before attempting to use Redis storage
storage_uri = "memory://"

if settings.redis_url:
    try:
        import redis
        storage_uri = settings.redis_url
    except ImportError:
        print("WARNING: redis package not installed, falling back to memory storage")
        storage_uri = "memory://"

# Rate limiter configuration
# Uses client IP for rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/minute"],  # Default rate limit
    storage_uri=storage_uri,
    strategy="fixed-window",
)
