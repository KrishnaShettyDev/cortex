"""Tests for reminders and tasks API endpoints."""

import pytest
import pytest_asyncio
from datetime import datetime, timedelta
from uuid import uuid4
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
import jwt

from app.models.user import User
from app.config import get_settings

settings = get_settings()


# ==================== FIXTURES ====================


@pytest_asyncio.fixture
async def test_user(test_session: AsyncSession):
    """Create a test user."""
    user = User(
        id=uuid4(),
        apple_id="test_apple_id_api",
        email="testapi@example.com",
        name="Test API User",
    )
    test_session.add(user)
    await test_session.commit()
    await test_session.refresh(user)
    return user


@pytest.fixture
def auth_headers(test_user: User):
    """Generate auth headers with JWT token."""
    token = jwt.encode(
        {
            "sub": str(test_user.id),
            "email": test_user.email,
            "exp": datetime.utcnow() + timedelta(hours=1),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def sample_reminder_request():
    """Sample reminder request payload."""
    return {
        "title": "Call the bank",
        "body": "Ask about loan rates",
        "remind_at": (datetime.utcnow() + timedelta(hours=2)).isoformat(),
        "reminder_type": "time",
    }


@pytest.fixture
def sample_task_request():
    """Sample task request payload."""
    return {
        "title": "Review code changes",
        "description": "Check the new API endpoints",
        "due_date": (datetime.utcnow() + timedelta(days=1)).isoformat(),
        "priority": 2,
    }


# ==================== REMINDER API TESTS ====================


@pytest.mark.asyncio
async def test_create_reminder_endpoint(
    client: AsyncClient,
    auth_headers: dict,
    sample_reminder_request: dict,
):
    """Test POST /reminders endpoint."""
    response = await client.post(
        "/reminders",
        json=sample_reminder_request,
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["title"] == sample_reminder_request["title"]
    assert data["body"] == sample_reminder_request["body"]
    assert data["reminder_type"] == "time"
    assert data["status"] == "pending"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_reminder_unauthorized(
    client: AsyncClient,
    sample_reminder_request: dict,
):
    """Test that creating reminder requires authentication."""
    response = await client.post(
        "/reminders",
        json=sample_reminder_request,
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_list_reminders_endpoint(
    client: AsyncClient,
    auth_headers: dict,
    sample_reminder_request: dict,
):
    """Test GET /reminders endpoint."""
    # Create a reminder first
    await client.post(
        "/reminders",
        json=sample_reminder_request,
        headers=auth_headers,
    )

    response = await client.get("/reminders", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert "reminders" in data
    assert "total" in data
    assert data["total"] >= 1


@pytest.mark.asyncio
async def test_get_reminder_endpoint(
    client: AsyncClient,
    auth_headers: dict,
    sample_reminder_request: dict,
):
    """Test GET /reminders/{id} endpoint."""
    # Create a reminder
    create_response = await client.post(
        "/reminders",
        json=sample_reminder_request,
        headers=auth_headers,
    )
    reminder_id = create_response.json()["id"]

    # Get the reminder
    response = await client.get(
        f"/reminders/{reminder_id}",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == reminder_id
    assert data["title"] == sample_reminder_request["title"]


@pytest.mark.asyncio
async def test_get_reminder_not_found(
    client: AsyncClient,
    auth_headers: dict,
):
    """Test GET /reminders/{id} with non-existent ID."""
    fake_id = str(uuid4())
    response = await client.get(
        f"/reminders/{fake_id}",
        headers=auth_headers,
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_reminder_endpoint(
    client: AsyncClient,
    auth_headers: dict,
    sample_reminder_request: dict,
):
    """Test PATCH /reminders/{id} endpoint."""
    # Create a reminder
    create_response = await client.post(
        "/reminders",
        json=sample_reminder_request,
        headers=auth_headers,
    )
    reminder_id = create_response.json()["id"]

    # Update the reminder
    update_data = {"title": "Updated title"}
    response = await client.patch(
        f"/reminders/{reminder_id}",
        json=update_data,
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Updated title"


@pytest.mark.asyncio
async def test_complete_reminder_endpoint(
    client: AsyncClient,
    auth_headers: dict,
    sample_reminder_request: dict,
):
    """Test POST /reminders/{id}/complete endpoint."""
    # Create a reminder
    create_response = await client.post(
        "/reminders",
        json=sample_reminder_request,
        headers=auth_headers,
    )
    reminder_id = create_response.json()["id"]

    # Complete the reminder
    response = await client.post(
        f"/reminders/{reminder_id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True


@pytest.mark.asyncio
async def test_snooze_reminder_endpoint(
    client: AsyncClient,
    auth_headers: dict,
    sample_reminder_request: dict,
):
    """Test POST /reminders/{id}/snooze endpoint."""
    # Create a reminder
    create_response = await client.post(
        "/reminders",
        json=sample_reminder_request,
        headers=auth_headers,
    )
    reminder_id = create_response.json()["id"]

    # Snooze the reminder
    response = await client.post(
        f"/reminders/{reminder_id}/snooze?minutes=30",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "snoozed"


@pytest.mark.asyncio
async def test_delete_reminder_endpoint(
    client: AsyncClient,
    auth_headers: dict,
    sample_reminder_request: dict,
):
    """Test DELETE /reminders/{id} endpoint."""
    # Create a reminder
    create_response = await client.post(
        "/reminders",
        json=sample_reminder_request,
        headers=auth_headers,
    )
    reminder_id = create_response.json()["id"]

    # Delete the reminder
    response = await client.delete(
        f"/reminders/{reminder_id}",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True

    # Verify it's gone
    get_response = await client.get(
        f"/reminders/{reminder_id}",
        headers=auth_headers,
    )
    assert get_response.status_code == 404


# ==================== TASK API TESTS ====================


@pytest.mark.asyncio
async def test_create_task_endpoint(
    client: AsyncClient,
    auth_headers: dict,
    sample_task_request: dict,
):
    """Test POST /reminders/tasks endpoint."""
    response = await client.post(
        "/reminders/tasks",
        json=sample_task_request,
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["title"] == sample_task_request["title"]
    assert data["description"] == sample_task_request["description"]
    assert data["priority"] == sample_task_request["priority"]
    assert data["is_completed"] is False


@pytest.mark.asyncio
async def test_list_tasks_endpoint(
    client: AsyncClient,
    auth_headers: dict,
    sample_task_request: dict,
):
    """Test GET /reminders/tasks endpoint."""
    # Create a task first
    await client.post(
        "/reminders/tasks",
        json=sample_task_request,
        headers=auth_headers,
    )

    response = await client.get("/reminders/tasks", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert "tasks" in data
    assert "total" in data
    assert data["total"] >= 1


@pytest.mark.asyncio
async def test_complete_task_endpoint(
    client: AsyncClient,
    auth_headers: dict,
    sample_task_request: dict,
):
    """Test POST /reminders/tasks/{id}/complete endpoint."""
    # Create a task
    create_response = await client.post(
        "/reminders/tasks",
        json=sample_task_request,
        headers=auth_headers,
    )
    task_id = create_response.json()["id"]

    # Complete the task
    response = await client.post(
        f"/reminders/tasks/{task_id}/complete",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True


# ==================== LOCATION CHECK API TESTS ====================


@pytest.mark.asyncio
async def test_check_location_reminders_endpoint(
    client: AsyncClient,
    auth_headers: dict,
):
    """Test POST /reminders/check-location endpoint."""
    # Create a location-based reminder
    location_reminder = {
        "title": "Get coffee",
        "reminder_type": "location",
        "location_name": "Cafe",
        "location_latitude": 37.7749,
        "location_longitude": -122.4194,
        "location_radius_meters": 100,
    }
    await client.post(
        "/reminders",
        json=location_reminder,
        headers=auth_headers,
    )

    # Check for triggered reminders at that location
    response = await client.post(
        "/reminders/check-location?latitude=37.7749&longitude=-122.4194",
        headers=auth_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert "reminders" in data
    assert "total" in data
