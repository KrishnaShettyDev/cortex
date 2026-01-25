import ssl
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

from app.config import get_settings

settings = get_settings()

# Process database URL - asyncpg needs SSL passed via connect_args, not URL
database_url = settings.database_url
connect_args = {}

# Remove sslmode from URL and configure SSL properly for asyncpg
if "sslmode=require" in database_url:
    database_url = database_url.replace("?sslmode=require", "").replace("&sslmode=require", "")
    # Create SSL context for asyncpg
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    connect_args["ssl"] = ssl_context

# Create async engine with configurable pooling
engine = create_async_engine(
    database_url,
    echo=settings.debug,
    pool_pre_ping=True,  # Verify connections before use
    pool_size=settings.db_pool_size,  # Base pool size
    max_overflow=settings.db_max_overflow,  # Additional connections allowed
    pool_recycle=settings.db_pool_recycle,  # Recycle connections to avoid stale connections
    connect_args=connect_args,
)

# Create async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""
    pass


async def get_db() -> AsyncSession:
    """Dependency that provides a database session."""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Initialize database extensions."""
    async with engine.begin() as conn:
        # Enable required PostgreSQL extensions
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "vector"'))
