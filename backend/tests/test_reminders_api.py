"""Tests for reminders and tasks API endpoints."""

import pytest
import pytest_asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from httpx import AsyncClient


# ==================== FIXTURES ====================


@pytest.fixture
def sample_reminder_request():
    """Sample reminder request payload."""
    return {
        "title": "Call the bank",
        "body": "Ask about loan rates",
        "remind_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
        "reminder_type": "time",
    }


@pytest.fixture
def sample_task_request():
    """Sample task request payload."""
    return {
        "title": "Review code changes",
        "description": "Check the new API endpoints",
        "due_date": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "priority": 2,
    }


# ==================== REMINDER API TESTS ====================


@pytest.mark.asyncio
async def test_create_reminder_endpoint(
    auth_client: AsyncClient,
    sample_reminder_request: dict,
):
    """Test POST /reminders endpoint."""
    response = await auth_client.post(
        "/reminders",
        json=sample_reminder_request,
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
    auth_client: AsyncClient,
    sample_reminder_request: dict,
):
    """Test GET /reminders endpoint."""
    # Create a reminder first
    await auth_client.post(
        "/reminders",
        json=sample_reminder_request,
    )

    response = await auth_client.get("/reminders")

    assert response.status_code == 200
    data = response.json()
    assert "reminders" in data
    assert "total" in data
    assert data["total"] >= 1


@pytest.mark.asyncio
async def test_get_reminder_endpoint(
    auth_client: AsyncClient,
    sample_reminder_request: dict,
):
    """Test GET /reminders/{id} endpoint."""
    # Create a reminder
    create_response = await auth_client.post(
        "/reminders",
        json=sample_reminder_request,
    )
    reminder_id = create_response.json()["id"]

    # Get the reminder
    response = await auth_client.get(f"/reminders/{reminder_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == reminder_id
    assert data["title"] == sample_reminder_request["title"]


@pytest.mark.asyncio
async def test_get_reminder_not_found(
    auth_client: AsyncClient,
):
    """Test GET /reminders/{id} with non-existent ID."""
    fake_id = str(uuid4())
    response = await auth_client.get(f"/reminders/{fake_id}")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_reminder_endpoint(
    auth_client: AsyncClient,
    sample_reminder_request: dict,
):
    """Test PATCH /reminders/{id} endpoint."""
    # Create a reminder
    create_response = await auth_client.post(
        "/reminders",
        json=sample_reminder_request,
    )
    reminder_id = create_response.json()["id"]

    # Update the reminder
    update_data = {"title": "Updated title"}
    response = await auth_client.patch(
        f"/reminders/{reminder_id}",
        json=update_data,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Updated title"


@pytest.mark.asyncio
async def test_complete_reminder_endpoint(
    auth_client: AsyncClient,
    sample_reminder_request: dict,
):
    """Test POST /reminders/{id}/complete endpoint."""
    # Create a reminder
    create_response = await auth_client.post(
        "/reminders",
        json=sample_reminder_request,
    )
    reminder_id = create_response.json()["id"]

    # Complete the reminder
    response = await auth_client.post(f"/reminders/{reminder_id}/complete")

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True


@pytest.mark.asyncio
async def test_snooze_reminder_endpoint(
    auth_client: AsyncClient,
    sample_reminder_request: dict,
):
    """Test POST /reminders/{id}/snooze endpoint."""
    # Create a reminder
    create_response = await auth_client.post(
        "/reminders",
        json=sample_reminder_request,
    )
    reminder_id = create_response.json()["id"]

    # Snooze the reminder
    response = await auth_client.post(f"/reminders/{reminder_id}/snooze?minutes=30")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "snoozed"


@pytest.mark.asyncio
async def test_delete_reminder_endpoint(
    auth_client: AsyncClient,
    sample_reminder_request: dict,
):
    """Test DELETE /reminders/{id} endpoint."""
    # Create a reminder
    create_response = await auth_client.post(
        "/reminders",
        json=sample_reminder_request,
    )
    reminder_id = create_response.json()["id"]

    # Delete the reminder
    response = await auth_client.delete(f"/reminders/{reminder_id}")

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True

    # Verify it's gone
    get_response = await auth_client.get(f"/reminders/{reminder_id}")
    assert get_response.status_code == 404


# ==================== TASK API TESTS ====================


@pytest.mark.asyncio
async def test_create_task_endpoint(
    auth_client: AsyncClient,
    sample_task_request: dict,
):
    """Test POST /reminders/tasks endpoint."""
    response = await auth_client.post(
        "/reminders/tasks",
        json=sample_task_request,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["title"] == sample_task_request["title"]
    assert data["description"] == sample_task_request["description"]
    assert data["priority"] == sample_task_request["priority"]
    assert data["is_completed"] is False


@pytest.mark.asyncio
async def test_list_tasks_endpoint(
    auth_client: AsyncClient,
    sample_task_request: dict,
):
    """Test GET /reminders/tasks endpoint."""
    # Create a task first
    await auth_client.post(
        "/reminders/tasks",
        json=sample_task_request,
    )

    response = await auth_client.get("/reminders/tasks")

    assert response.status_code == 200
    data = response.json()
    assert "tasks" in data
    assert "total" in data
    assert data["total"] >= 1


@pytest.mark.asyncio
async def test_complete_task_endpoint(
    auth_client: AsyncClient,
    sample_task_request: dict,
):
    """Test POST /reminders/tasks/{id}/complete endpoint."""
    # Create a task
    create_response = await auth_client.post(
        "/reminders/tasks",
        json=sample_task_request,
    )
    task_id = create_response.json()["id"]

    # Complete the task
    response = await auth_client.post(f"/reminders/tasks/{task_id}/complete")

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True


# ==================== LOCATION CHECK API TESTS ====================


@pytest.mark.asyncio
async def test_check_location_reminders_endpoint(
    auth_client: AsyncClient,
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
    await auth_client.post(
        "/reminders",
        json=location_reminder,
    )

    # Check for triggered reminders at that location
    response = await auth_client.post(
        "/reminders/check-location?latitude=37.7749&longitude=-122.4194",
    )

    assert response.status_code == 200
    data = response.json()
    assert "reminders" in data
    assert "total" in data
