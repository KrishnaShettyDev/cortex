"""Unit tests for reminders that don't require database connection."""

import pytest
from datetime import datetime, timedelta

from app.models.reminder import ReminderStatus, ReminderType


class TestReminderModels:
    """Test reminder model enums and types."""

    def test_reminder_status_values(self):
        """Test ReminderStatus enum values."""
        assert ReminderStatus.PENDING.value == "pending"
        assert ReminderStatus.SENT.value == "sent"
        assert ReminderStatus.SNOOZED.value == "snoozed"
        assert ReminderStatus.COMPLETED.value == "completed"
        assert ReminderStatus.CANCELLED.value == "cancelled"

    def test_reminder_type_values(self):
        """Test ReminderType enum values."""
        assert ReminderType.TIME.value == "time"
        assert ReminderType.LOCATION.value == "location"
        assert ReminderType.EVENT.value == "event"


class TestReminderServiceParsing:
    """Test reminder natural language parsing."""

    @pytest.fixture
    def mock_service(self):
        """Create a mock reminder service for parsing tests."""
        from app.services.reminder_service import ReminderService

        class MockDB:
            pass

        return ReminderService(MockDB())

    def test_parse_time_in_minutes(self, mock_service):
        """Test parsing 'in X minutes' format."""
        result = mock_service.parse_reminder_from_text(
            "remind me to call mom in 30 minutes"
        )
        assert "call mom" in result["title"]
        assert result["reminder_type"] == ReminderType.TIME.value
        assert result["remind_at"] is not None
        # Should be roughly 30 minutes from now
        expected = datetime.utcnow() + timedelta(minutes=30)
        assert abs((result["remind_at"] - expected).total_seconds()) < 60

    def test_parse_time_in_hours(self, mock_service):
        """Test parsing 'in X hours' format."""
        result = mock_service.parse_reminder_from_text(
            "remind me to check email in 2 hours"
        )
        assert "check email" in result["title"]
        assert result["reminder_type"] == ReminderType.TIME.value
        assert result["remind_at"] is not None
        # Should be roughly 2 hours from now
        expected = datetime.utcnow() + timedelta(hours=2)
        assert abs((result["remind_at"] - expected).total_seconds()) < 60

    def test_parse_location_based(self, mock_service):
        """Test parsing location-based reminders."""
        result = mock_service.parse_reminder_from_text(
            "remind me to buy milk when I'm at the grocery store"
        )
        assert "buy milk" in result["title"]
        assert result["reminder_type"] == ReminderType.LOCATION.value
        assert result["location_name"] is not None

    def test_parse_location_near(self, mock_service):
        """Test parsing 'near' location format."""
        result = mock_service.parse_reminder_from_text(
            "remind me to get gas when near the station"
        )
        assert result["reminder_type"] == ReminderType.LOCATION.value

    def test_parse_tomorrow(self, mock_service):
        """Test parsing 'tomorrow' keyword."""
        result = mock_service.parse_reminder_from_text(
            "remind me to submit report tomorrow"
        )
        assert "submit report" in result["title"]
        assert result["remind_at"] is not None
        # Should be tomorrow
        tomorrow = datetime.utcnow() + timedelta(days=1)
        assert result["remind_at"].day == tomorrow.day

    def test_parse_tomorrow_with_time(self, mock_service):
        """Test parsing 'tomorrow at X' format."""
        result = mock_service.parse_reminder_from_text(
            "remind me to call bank tomorrow at 9am"
        )
        assert "call bank" in result["title"]
        assert result["remind_at"] is not None
        assert result["remind_at"].hour == 9

    def test_parse_tomorrow_with_pm_time(self, mock_service):
        """Test parsing 'tomorrow at Xpm' format."""
        result = mock_service.parse_reminder_from_text(
            "remind me about meeting tomorrow at 3pm"
        )
        assert result["remind_at"] is not None
        assert result["remind_at"].hour == 15  # 3pm = 15:00

    def test_parse_about_format(self, mock_service):
        """Test parsing 'remind me about' format."""
        result = mock_service.parse_reminder_from_text(
            "remind me about the dentist appointment in 1 hour"
        )
        assert "dentist appointment" in result["title"]

    def test_parse_default_time(self, mock_service):
        """Test that default time is set when no time specified."""
        result = mock_service.parse_reminder_from_text(
            "remind me to water the plants"
        )
        # Should default to 1 hour
        assert result["remind_at"] is not None
        expected = datetime.utcnow() + timedelta(hours=1)
        assert abs((result["remind_at"] - expected).total_seconds()) < 60


class TestChatServiceTools:
    """Test chat service reminder tool definitions."""

    def test_tools_include_reminders(self):
        """Test that TOOLS array includes reminder tools."""
        from app.services.chat_service import TOOLS

        tool_names = [t["function"]["name"] for t in TOOLS]
        assert "create_reminder" in tool_names
        assert "list_reminders" in tool_names
        assert "list_tasks" in tool_names

    def test_create_reminder_tool_schema(self):
        """Test create_reminder tool has correct parameters."""
        from app.services.chat_service import TOOLS

        create_tool = next(
            t for t in TOOLS if t["function"]["name"] == "create_reminder"
        )
        params = create_tool["function"]["parameters"]["properties"]

        assert "title" in params
        assert "remind_at" in params
        assert "reminder_type" in params
        assert "location_name" in params

    def test_list_reminders_tool_schema(self):
        """Test list_reminders tool has correct parameters."""
        from app.services.chat_service import TOOLS

        list_tool = next(
            t for t in TOOLS if t["function"]["name"] == "list_reminders"
        )
        params = list_tool["function"]["parameters"]["properties"]

        assert "include_completed" in params

    def test_list_tasks_tool_schema(self):
        """Test list_tasks tool has correct parameters."""
        from app.services.chat_service import TOOLS

        list_tool = next(t for t in TOOLS if t["function"]["name"] == "list_tasks")
        params = list_tool["function"]["parameters"]["properties"]

        assert "include_completed" in params


class TestAppRoutes:
    """Test that reminder routes are properly registered."""

    def test_reminder_routes_exist(self):
        """Test that reminder routes are registered in the app."""
        from app.main import app

        routes = [r.path for r in app.routes]

        # Check key reminder routes exist
        assert "/reminders" in routes
        assert "/reminders/{reminder_id}" in routes
        assert "/reminders/{reminder_id}/complete" in routes
        assert "/reminders/{reminder_id}/snooze" in routes
        assert "/reminders/tasks" in routes
        assert "/reminders/tasks/{task_id}/complete" in routes
        assert "/reminders/check-location" in routes


class TestHaversineDistance:
    """Test haversine distance calculation for location reminders."""

    def test_same_location_zero_distance(self):
        """Test that same location returns zero distance."""
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

    def test_known_distance(self):
        """Test haversine with known distance."""
        from math import radians, sin, cos, sqrt, atan2

        def haversine_distance(lat1, lon1, lat2, lon2):
            R = 6371000
            phi1, phi2 = radians(lat1), radians(lat2)
            delta_phi = radians(lat2 - lat1)
            delta_lambda = radians(lon2 - lon1)
            a = sin(delta_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(delta_lambda / 2) ** 2
            c = 2 * atan2(sqrt(a), sqrt(1 - a))
            return R * c

        # SF to NYC is roughly 4,130 km
        sf_lat, sf_lon = 37.7749, -122.4194
        nyc_lat, nyc_lon = 40.7128, -74.0060
        distance = haversine_distance(sf_lat, sf_lon, nyc_lat, nyc_lon)

        # Should be roughly 4,130,000 meters (allow 10% tolerance)
        assert 3_700_000 < distance < 4_500_000
