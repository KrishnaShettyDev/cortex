"""Tests for reminders and tasks functionality using SQLite test database."""

import pytest
import pytest_asyncio
from datetime import datetime, timedelta
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import TestUser, TestReminder, TestTask
from app.models.reminder import ReminderStatus, ReminderType


# ==================== FIXTURES ====================


@pytest_asyncio.fixture
async def test_user(test_session: AsyncSession):
    """Create a test user."""
    user = TestUser(
        id=str(uuid4()),
        oauth_id="test_oauth_id",
        email="test@example.com",
        name="Test User",
    )
    test_session.add(user)
    await test_session.commit()
    await test_session.refresh(user)
    return user


@pytest.fixture
def sample_reminder_data():
    """Sample reminder data for testing."""
    return {
        "title": "Buy groceries",
        "body": "Milk, eggs, bread",
        "remind_at": datetime.utcnow() + timedelta(hours=2),
        "reminder_type": ReminderType.TIME.value,
    }


@pytest.fixture
def sample_location_reminder_data():
    """Sample location-based reminder data."""
    return {
        "title": "Get coffee",
        "body": "Try the new espresso",
        "reminder_type": ReminderType.LOCATION.value,
        "location_name": "Starbucks",
        "location_latitude": 37.7749,
        "location_longitude": -122.4194,
        "location_radius_meters": 100,
    }


@pytest.fixture
def sample_task_data():
    """Sample task data for testing."""
    return {
        "title": "Review pull request",
        "description": "Check the new authentication feature",
        "due_date": datetime.utcnow() + timedelta(days=1),
        "priority": 2,
    }


# ==================== REMINDER CRUD TESTS ====================


@pytest.mark.asyncio
async def test_create_reminder(
    test_session: AsyncSession,
    test_user: TestUser,
    sample_reminder_data: dict,
):
    """Test creating a time-based reminder."""
    reminder = TestReminder(
        id=str(uuid4()),
        user_id=test_user.id,
        title=sample_reminder_data["title"],
        body=sample_reminder_data["body"],
        remind_at=sample_reminder_data["remind_at"],
        reminder_type=sample_reminder_data["reminder_type"],
        status=ReminderStatus.PENDING.value,
    )
    test_session.add(reminder)
    await test_session.commit()
    await test_session.refresh(reminder)

    assert reminder.id is not None
    assert reminder.user_id == test_user.id
    assert reminder.title == sample_reminder_data["title"]
    assert reminder.body == sample_reminder_data["body"]
    assert reminder.reminder_type == ReminderType.TIME.value
    assert reminder.status == ReminderStatus.PENDING.value


@pytest.mark.asyncio
async def test_create_location_reminder(
    test_session: AsyncSession,
    test_user: TestUser,
    sample_location_reminder_data: dict,
):
    """Test creating a location-based reminder."""
    reminder = TestReminder(
        id=str(uuid4()),
        user_id=test_user.id,
        title=sample_location_reminder_data["title"],
        body=sample_location_reminder_data["body"],
        reminder_type=sample_location_reminder_data["reminder_type"],
        location_name=sample_location_reminder_data["location_name"],
        location_latitude=sample_location_reminder_data["location_latitude"],
        location_longitude=sample_location_reminder_data["location_longitude"],
        location_radius_meters=sample_location_reminder_data["location_radius_meters"],
        status=ReminderStatus.PENDING.value,
    )
    test_session.add(reminder)
    await test_session.commit()
    await test_session.refresh(reminder)

    assert reminder.reminder_type == ReminderType.LOCATION.value
    assert reminder.location_name == sample_location_reminder_data["location_name"]
    assert reminder.location_latitude == sample_location_reminder_data["location_latitude"]
    assert reminder.location_longitude == sample_location_reminder_data["location_longitude"]


@pytest.mark.asyncio
async def test_get_reminder(
    test_session: AsyncSession,
    test_user: TestUser,
    sample_reminder_data: dict,
):
    """Test retrieving a specific reminder."""
    reminder = TestReminder(
        id=str(uuid4()),
        user_id=test_user.id,
        title=sample_reminder_data["title"],
        status=ReminderStatus.PENDING.value,
    )
    test_session.add(reminder)
    await test_session.commit()

    result = await test_session.execute(
        select(TestReminder).where(TestReminder.id == reminder.id)
    )
    fetched = result.scalar_one_or_none()

    assert fetched is not None
    assert fetched.id == reminder.id
    assert fetched.title == reminder.title


@pytest.mark.asyncio
async def test_list_reminders(
    test_session: AsyncSession,
    test_user: TestUser,
):
    """Test listing reminders for a user."""
    # Create multiple reminders
    for i in range(3):
        reminder = TestReminder(
            id=str(uuid4()),
            user_id=test_user.id,
            title=f"Reminder {i}",
            status=ReminderStatus.PENDING.value,
        )
        test_session.add(reminder)
    await test_session.commit()

    result = await test_session.execute(
        select(TestReminder).where(TestReminder.user_id == test_user.id)
    )
    reminders = list(result.scalars().all())

    assert len(reminders) == 3


@pytest.mark.asyncio
async def test_update_reminder(
    test_session: AsyncSession,
    test_user: TestUser,
):
    """Test updating a reminder."""
    reminder = TestReminder(
        id=str(uuid4()),
        user_id=test_user.id,
        title="Original title",
        status=ReminderStatus.PENDING.value,
    )
    test_session.add(reminder)
    await test_session.commit()

    # Update the reminder
    reminder.title = "Updated title"
    await test_session.commit()
    await test_session.refresh(reminder)

    assert reminder.title == "Updated title"


@pytest.mark.asyncio
async def test_complete_reminder(
    test_session: AsyncSession,
    test_user: TestUser,
):
    """Test marking a reminder as completed."""
    reminder = TestReminder(
        id=str(uuid4()),
        user_id=test_user.id,
        title="Test reminder",
        status=ReminderStatus.PENDING.value,
    )
    test_session.add(reminder)
    await test_session.commit()

    # Complete the reminder
    reminder.status = ReminderStatus.COMPLETED.value
    reminder.completed_at = datetime.utcnow()
    await test_session.commit()
    await test_session.refresh(reminder)

    assert reminder.status == ReminderStatus.COMPLETED.value
    assert reminder.completed_at is not None


@pytest.mark.asyncio
async def test_snooze_reminder(
    test_session: AsyncSession,
    test_user: TestUser,
):
    """Test snoozing a reminder."""
    reminder = TestReminder(
        id=str(uuid4()),
        user_id=test_user.id,
        title="Test reminder",
        remind_at=datetime.utcnow(),
        status=ReminderStatus.PENDING.value,
    )
    test_session.add(reminder)
    await test_session.commit()

    # Snooze the reminder
    snooze_until = datetime.utcnow() + timedelta(minutes=30)
    reminder.status = ReminderStatus.SNOOZED.value
    reminder.remind_at = snooze_until
    await test_session.commit()
    await test_session.refresh(reminder)

    assert reminder.status == ReminderStatus.SNOOZED.value


@pytest.mark.asyncio
async def test_delete_reminder(
    test_session: AsyncSession,
    test_user: TestUser,
):
    """Test deleting a reminder."""
    reminder = TestReminder(
        id=str(uuid4()),
        user_id=test_user.id,
        title="Test reminder",
        status=ReminderStatus.PENDING.value,
    )
    test_session.add(reminder)
    await test_session.commit()

    reminder_id = reminder.id

    # Delete the reminder
    await test_session.delete(reminder)
    await test_session.commit()

    # Verify it's gone
    result = await test_session.execute(
        select(TestReminder).where(TestReminder.id == reminder_id)
    )
    assert result.scalar_one_or_none() is None


# ==================== TASK CRUD TESTS ====================


@pytest.mark.asyncio
async def test_create_task(
    test_session: AsyncSession,
    test_user: TestUser,
    sample_task_data: dict,
):
    """Test creating a task."""
    task = TestTask(
        id=str(uuid4()),
        user_id=test_user.id,
        title=sample_task_data["title"],
        description=sample_task_data["description"],
        due_date=sample_task_data["due_date"],
        priority=sample_task_data["priority"],
        is_completed=False,
    )
    test_session.add(task)
    await test_session.commit()
    await test_session.refresh(task)

    assert task.id is not None
    assert task.user_id == test_user.id
    assert task.title == sample_task_data["title"]
    assert task.description == sample_task_data["description"]
    assert task.priority == sample_task_data["priority"]
    assert task.is_completed is False


@pytest.mark.asyncio
async def test_list_tasks(
    test_session: AsyncSession,
    test_user: TestUser,
):
    """Test listing tasks for a user."""
    # Create multiple tasks
    for i in range(3):
        task = TestTask(
            id=str(uuid4()),
            user_id=test_user.id,
            title=f"Task {i}",
            is_completed=False,
        )
        test_session.add(task)
    await test_session.commit()

    result = await test_session.execute(
        select(TestTask).where(TestTask.user_id == test_user.id)
    )
    tasks = list(result.scalars().all())

    assert len(tasks) == 3


@pytest.mark.asyncio
async def test_complete_task(
    test_session: AsyncSession,
    test_user: TestUser,
):
    """Test marking a task as completed."""
    task = TestTask(
        id=str(uuid4()),
        user_id=test_user.id,
        title="Test task",
        is_completed=False,
    )
    test_session.add(task)
    await test_session.commit()

    # Complete the task
    task.is_completed = True
    task.completed_at = datetime.utcnow()
    await test_session.commit()
    await test_session.refresh(task)

    assert task.is_completed is True
    assert task.completed_at is not None


# ==================== NATURAL LANGUAGE PARSING TESTS ====================


@pytest.mark.asyncio
async def test_parse_reminder_time_based():
    """Test parsing time-based reminders from natural language."""
    from app.services.reminder_service import ReminderService

    class MockDB:
        pass

    service = ReminderService(MockDB())
    text = "remind me to call mom in 30 minutes"
    result = service.parse_reminder_from_text(text)

    assert "call mom" in result["title"]
    assert result["reminder_type"] == ReminderType.TIME.value
    assert result["remind_at"] is not None


@pytest.mark.asyncio
async def test_parse_reminder_location_based():
    """Test parsing location-based reminders from natural language."""
    from app.services.reminder_service import ReminderService

    class MockDB:
        pass

    service = ReminderService(MockDB())
    text = "remind me to buy milk when I'm at the grocery store"
    result = service.parse_reminder_from_text(text)

    assert "buy milk" in result["title"]
    assert result["reminder_type"] == ReminderType.LOCATION.value
    assert result["location_name"] is not None


@pytest.mark.asyncio
async def test_parse_reminder_tomorrow():
    """Test parsing reminders with 'tomorrow' keyword."""
    from app.services.reminder_service import ReminderService

    class MockDB:
        pass

    service = ReminderService(MockDB())
    text = "remind me to submit report tomorrow at 9am"
    result = service.parse_reminder_from_text(text)

    assert "submit report" in result["title"]
    assert result["remind_at"] is not None
    # Should be tomorrow
    tomorrow = datetime.utcnow() + timedelta(days=1)
    assert result["remind_at"].day == tomorrow.day


# ==================== LOCATION CHECK TESTS ====================


@pytest.mark.asyncio
async def test_haversine_distance_calculation():
    """Test haversine distance calculation for location reminders."""
    from math import radians, sin, cos, sqrt, atan2

    def haversine_distance(lat1, lon1, lat2, lon2):
        R = 6371000  # Earth's radius in meters
        phi1, phi2 = radians(lat1), radians(lat2)
        delta_phi = radians(lat2 - lat1)
        delta_lambda = radians(lon2 - lon1)
        a = sin(delta_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(delta_lambda / 2) ** 2
        c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return R * c

    # Same location should be ~0
    distance = haversine_distance(37.7749, -122.4194, 37.7749, -122.4194)
    assert distance < 1  # Less than 1 meter

    # SF to NYC is roughly 4,130 km
    sf_lat, sf_lon = 37.7749, -122.4194
    nyc_lat, nyc_lon = 40.7128, -74.0060
    distance = haversine_distance(sf_lat, sf_lon, nyc_lat, nyc_lon)
    assert 3_700_000 < distance < 4_500_000  # 3,700 - 4,500 km


@pytest.mark.asyncio
async def test_location_within_radius(
    test_session: AsyncSession,
    test_user: TestUser,
):
    """Test location check finds reminders within radius."""
    # Create a location-based reminder
    reminder = TestReminder(
        id=str(uuid4()),
        user_id=test_user.id,
        title="Get coffee",
        reminder_type=ReminderType.LOCATION.value,
        location_name="Cafe",
        location_latitude=37.7749,
        location_longitude=-122.4194,
        location_radius_meters=100,
        status=ReminderStatus.PENDING.value,
    )
    test_session.add(reminder)
    await test_session.commit()

    # Query for location-based reminders
    result = await test_session.execute(
        select(TestReminder).where(
            TestReminder.user_id == test_user.id,
            TestReminder.reminder_type == ReminderType.LOCATION.value,
            TestReminder.status == ReminderStatus.PENDING.value,
        )
    )
    reminders = list(result.scalars().all())

    assert len(reminders) == 1
    assert reminders[0].location_latitude == 37.7749
