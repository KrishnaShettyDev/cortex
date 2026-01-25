import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import Column, String, DateTime, Float, Integer, Boolean, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
import uuid

from app.main import app
from app.database import get_db
from app.config import get_settings

settings = get_settings()

# Use SQLite for testing (in-memory, no external setup needed)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# Create a separate test base that doesn't include PostgreSQL-specific columns
TestBase = declarative_base()


class TestUser(TestBase):
    """Simplified User model for testing without PostgreSQL-specific features."""
    __tablename__ = "cortex_users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    oauth_id = Column(String(255), unique=True, nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(255), nullable=True)
    location_lat = Column(Float, nullable=True)
    location_lng = Column(Float, nullable=True)
    location_updated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: __import__('datetime').datetime.utcnow())
    updated_at = Column(DateTime, default=lambda: __import__('datetime').datetime.utcnow())


class TestReminder(TestBase):
    """Reminder model for testing."""
    __tablename__ = "cortex_reminders"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=True)
    reminder_type = Column(String(20), nullable=False, default="time")
    remind_at = Column(DateTime, nullable=True)
    location_name = Column(String(255), nullable=True)
    location_latitude = Column(Float, nullable=True)
    location_longitude = Column(Float, nullable=True)
    location_radius_meters = Column(Integer, nullable=True, default=200)
    event_id = Column(String(255), nullable=True)
    minutes_before_event = Column(Integer, nullable=True, default=15)
    status = Column(String(20), nullable=False, default="pending")
    sent_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    is_recurring = Column(Boolean, default=False)
    recurrence_pattern = Column(String(50), nullable=True)
    source_message = Column(Text, nullable=True)
    conversation_id = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=lambda: __import__('datetime').datetime.utcnow())
    updated_at = Column(DateTime, default=lambda: __import__('datetime').datetime.utcnow())


class TestTask(TestBase):
    """Task model for testing."""
    __tablename__ = "cortex_tasks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("cortex_users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    is_completed = Column(Boolean, default=False)
    completed_at = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=True)
    priority = Column(Integer, nullable=True, default=3)
    source_type = Column(String(50), nullable=True)
    source_id = Column(String(255), nullable=True)
    extracted_from = Column(Text, nullable=True)
    related_person = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=lambda: __import__('datetime').datetime.utcnow())
    updated_at = Column(DateTime, default=lambda: __import__('datetime').datetime.utcnow())


@pytest_asyncio.fixture
async def test_engine():
    """Create test database engine using SQLite."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        connect_args={"check_same_thread": False},
    )

    async with engine.begin() as conn:
        await conn.run_sync(TestBase.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(TestBase.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture
async def test_session(test_engine):
    """Create test database session."""
    async_session = async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session() as session:
        yield session


@pytest_asyncio.fixture
async def client(test_session):
    """Create test client with database override."""

    async def override_get_db():
        yield test_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
def sample_user_data():
    """Sample user data for testing."""
    return {
        "oauth_id": "test_oauth_id_123",
        "email": "test@example.com",
        "name": "Test User",
    }


@pytest.fixture
def sample_memory_data():
    """Sample memory data for testing."""
    return {
        "content": "Had a great meeting with John about the new project. We discussed the timeline and agreed to deliver by Q2.",
        "memory_type": "text",
        "memory_date": "2024-01-15T10:00:00Z",
    }
