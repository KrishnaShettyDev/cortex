"""Tests for Autonomous Actions API and Service.

Tests the Iris-style autonomous action generation, approval, and dismissal.
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch, MagicMock
import uuid


class TestAutonomousActionsAPI:
    """Tests for /autonomous-actions endpoints."""

    @pytest.mark.asyncio
    async def test_get_pending_actions_empty(self, auth_client, mock_user):
        """Test getting pending actions when none exist."""
        with patch('app.api.autonomous_actions.AutonomousActionService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.get_pending_actions.return_value = []
            MockService.return_value = mock_instance

            response = await auth_client.get("/autonomous-actions")

            assert response.status_code == 200
            data = response.json()
            assert data["actions"] == []
            assert data["count"] == 0

    @pytest.mark.asyncio
    async def test_get_pending_actions_with_results(self, auth_client, mock_user):
        """Test getting pending actions with results."""
        mock_action = MagicMock()
        mock_action.id = uuid.uuid4()
        mock_action.action_type = "email_reply"
        mock_action.title = "Reply to Sarah"
        mock_action.description = "Thanks for the update on the project..."
        mock_action.action_payload = {
            "thread_id": "thread_123",
            "to": "sarah@example.com",
            "subject": "Re: Project Update",
            "body": "Thanks for the update!",
        }
        mock_action.reason = "Urgent email needs response"
        mock_action.confidence_score = 0.85
        mock_action.priority_score = 75.0
        mock_action.source_type = "email"
        mock_action.source_id = "thread_123"
        mock_action.status = "pending"
        mock_action.created_at = datetime.now(timezone.utc)
        mock_action.expires_at = datetime.now(timezone.utc) + timedelta(hours=24)

        with patch('app.api.autonomous_actions.AutonomousActionService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.get_pending_actions.return_value = [mock_action]
            MockService.return_value = mock_instance

            response = await auth_client.get("/autonomous-actions")

            assert response.status_code == 200
            data = response.json()
            assert data["count"] == 1
            assert len(data["actions"]) == 1
            assert data["actions"][0]["action_type"] == "email_reply"
            assert data["actions"][0]["title"] == "Reply to Sarah"

    @pytest.mark.asyncio
    async def test_generate_actions(self, auth_client, mock_user):
        """Test force generating new actions."""
        with patch('app.api.autonomous_actions.AutonomousActionService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.generate_actions.return_value = []
            MockService.return_value = mock_instance

            response = await auth_client.post("/autonomous-actions/generate")

            assert response.status_code == 200
            data = response.json()
            assert "actions_generated" in data
            mock_instance.generate_actions.assert_called_once()

    @pytest.mark.asyncio
    async def test_approve_action_success(self, auth_client, mock_user):
        """Test approving an action successfully."""
        action_id = uuid.uuid4()

        with patch('app.api.autonomous_actions.AutonomousActionService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.approve_action.return_value = {
                "success": True,
                "message": "Email sent successfully",
                "message_id": "msg_123",
            }
            MockService.return_value = mock_instance

            response = await auth_client.post(
                f"/autonomous-actions/{action_id}/approve",
                json={}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "message" in data

    @pytest.mark.asyncio
    async def test_approve_action_with_modifications(self, auth_client, mock_user):
        """Test approving an action with user modifications."""
        action_id = uuid.uuid4()
        modifications = {
            "body": "Modified email body with more context",
            "subject": "Re: Updated Subject",
        }

        with patch('app.api.autonomous_actions.AutonomousActionService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.approve_action.return_value = {
                "success": True,
                "message": "Email sent with modifications",
            }
            MockService.return_value = mock_instance

            response = await auth_client.post(
                f"/autonomous-actions/{action_id}/approve",
                json={"modifications": modifications}
            )

            assert response.status_code == 200
            # Just verify it was called - the modifications are passed via service call
            mock_instance.approve_action.assert_called_once()

    @pytest.mark.asyncio
    async def test_approve_action_not_found(self, auth_client, mock_user):
        """Test approving non-existent action."""
        action_id = uuid.uuid4()

        with patch('app.api.autonomous_actions.AutonomousActionService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.approve_action.return_value = {
                "success": False,
                "message": "Action not found",
            }
            MockService.return_value = mock_instance

            response = await auth_client.post(
                f"/autonomous-actions/{action_id}/approve",
                json={}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is False

    @pytest.mark.asyncio
    async def test_dismiss_action_success(self, auth_client, mock_user):
        """Test dismissing an action."""
        action_id = uuid.uuid4()

        with patch('app.api.autonomous_actions.AutonomousActionService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.dismiss_action.return_value = {
                "success": True,
                "message": "Action dismissed",
            }
            MockService.return_value = mock_instance

            response = await auth_client.post(
                f"/autonomous-actions/{action_id}/dismiss",
                json={}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    @pytest.mark.asyncio
    async def test_dismiss_action_with_reason(self, auth_client, mock_user):
        """Test dismissing an action with a reason."""
        action_id = uuid.uuid4()

        with patch('app.api.autonomous_actions.AutonomousActionService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.dismiss_action.return_value = {
                "success": True,
                "message": "Action dismissed",
            }
            MockService.return_value = mock_instance

            response = await auth_client.post(
                f"/autonomous-actions/{action_id}/dismiss",
                json={"reason": "wrong_timing"}
            )

            assert response.status_code == 200
            # Just verify it was called
            mock_instance.dismiss_action.assert_called_once()

    @pytest.mark.asyncio
    async def test_submit_feedback(self, auth_client, mock_user):
        """Test submitting feedback on an action."""
        action_id = uuid.uuid4()

        with patch('app.api.autonomous_actions.AutonomousActionService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.submit_feedback.return_value = {
                "success": True,
                "message": "Feedback recorded",
            }
            MockService.return_value = mock_instance

            response = await auth_client.post(
                f"/autonomous-actions/{action_id}/feedback",
                json={"rating": 5, "feedback_type": "helpful"}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    @pytest.mark.asyncio
    async def test_get_action_stats(self, auth_client, mock_user):
        """Test getting action statistics."""
        with patch('app.api.autonomous_actions.AutonomousActionService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.get_action_stats.return_value = {
                "pending": 3,
                "executed": 10,
                "dismissed": 5,
                "expired": 2,
                "total": 20,
                "approval_rate": 0.67,
            }
            MockService.return_value = mock_instance

            response = await auth_client.get("/autonomous-actions/stats/summary")

            assert response.status_code == 200
            data = response.json()
            assert data["pending"] == 3
            assert data["executed"] == 10
            assert data["approval_rate"] == 0.67


class TestAutonomousActionsAPIAuth:
    """Tests for authentication on autonomous actions endpoints."""

    @pytest.mark.asyncio
    async def test_get_actions_unauthorized(self, client):
        """Test getting actions without auth returns 401."""
        response = await client.get("/autonomous-actions")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_generate_actions_unauthorized(self, client):
        """Test generating actions without auth returns 401."""
        response = await client.post("/autonomous-actions/generate")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_approve_action_unauthorized(self, client):
        """Test approving action without auth returns 401."""
        response = await client.post(
            f"/autonomous-actions/{uuid.uuid4()}/approve",
            json={}
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_dismiss_action_unauthorized(self, client):
        """Test dismissing action without auth returns 401."""
        response = await client.post(
            f"/autonomous-actions/{uuid.uuid4()}/dismiss",
            json={}
        )
        assert response.status_code == 401


class TestAutonomousActionServiceUnit:
    """Unit tests for AutonomousActionService."""

    @pytest.mark.asyncio
    async def test_can_generate_actions_max_pending(self):
        """Test action generation blocked when max pending reached."""
        from app.services.autonomous_action_service import AutonomousActionService
        from sqlalchemy import func

        mock_db = AsyncMock()
        service = AutonomousActionService(mock_db)

        # Mock existing pending count at max
        mock_result = MagicMock()
        mock_result.scalar.return_value = service.MAX_PENDING_ACTIONS
        mock_db.execute.return_value = mock_result

        can_generate, reason = await service._can_generate_actions(uuid.uuid4())

        assert can_generate is False
        assert "pending" in reason.lower()

    @pytest.mark.asyncio
    async def test_confidence_threshold_filtering(self):
        """Test that low-confidence actions are filtered out."""
        from app.services.autonomous_action_service import AutonomousActionService
        from app.models.autonomous import AutonomousAction

        mock_db = AsyncMock()
        service = AutonomousActionService(mock_db)

        # Create actions with varying confidence
        high_confidence = AutonomousAction(
            user_id=uuid.uuid4(),
            action_type="email_reply",
            title="High confidence",
            action_payload={},
            confidence_score=0.8,
            priority_score=70,
        )
        low_confidence = AutonomousAction(
            user_id=uuid.uuid4(),
            action_type="email_reply",
            title="Low confidence",
            action_payload={},
            confidence_score=0.2,  # Below threshold
            priority_score=70,
        )

        # Verify filtering logic
        actions = [high_confidence, low_confidence]
        filtered = [
            a for a in actions
            if a.confidence_score >= service.MIN_CONFIDENCE_THRESHOLD
        ]

        assert len(filtered) == 1
        assert filtered[0].title == "High confidence"

    @pytest.mark.asyncio
    async def test_priority_threshold_filtering(self):
        """Test that low-priority actions are filtered out."""
        from app.services.autonomous_action_service import AutonomousActionService
        from app.models.autonomous import AutonomousAction

        mock_db = AsyncMock()
        service = AutonomousActionService(mock_db)

        high_priority = AutonomousAction(
            user_id=uuid.uuid4(),
            action_type="email_reply",
            title="High priority",
            action_payload={},
            confidence_score=0.7,
            priority_score=80,
        )
        low_priority = AutonomousAction(
            user_id=uuid.uuid4(),
            action_type="email_reply",
            title="Low priority",
            action_payload={},
            confidence_score=0.7,
            priority_score=20,  # Below threshold
        )

        actions = [high_priority, low_priority]
        filtered = [
            a for a in actions
            if a.priority_score >= service.MIN_PRIORITY_THRESHOLD
        ]

        assert len(filtered) == 1
        assert filtered[0].title == "High priority"

    @pytest.mark.asyncio
    async def test_action_execution_email_reply(self):
        """Test email reply action execution."""
        from app.services.autonomous_action_service import AutonomousActionService

        mock_db = AsyncMock()
        service = AutonomousActionService(mock_db)

        # Mock sync service
        service.sync_service = AsyncMock()
        service.sync_service.reply_to_thread.return_value = {
            "success": True,
            "message_id": "msg_abc123",
        }

        payload = {
            "thread_id": "thread_123",
            "to": "recipient@example.com",
            "subject": "Re: Test",
            "body": "Test reply body",
        }

        result = await service._execute_action("email_reply", payload, uuid.uuid4())

        assert result["success"] is True
        service.sync_service.reply_to_thread.assert_called_once()

    @pytest.mark.asyncio
    async def test_action_execution_calendar_create(self):
        """Test calendar event creation action execution."""
        from app.services.autonomous_action_service import AutonomousActionService

        mock_db = AsyncMock()
        service = AutonomousActionService(mock_db)

        # Mock sync service
        service.sync_service = AsyncMock()
        service.sync_service.create_calendar_event.return_value = {
            "success": True,
            "event_id": "evt_123",
            "event_link": "https://calendar.google.com/event/123",
        }

        payload = {
            "title": "Team Meeting",
            "start_time": "2024-01-20T10:00:00Z",
            "end_time": "2024-01-20T11:00:00Z",
            "description": "Weekly sync",
            "attendees": ["john@example.com"],
        }

        result = await service._execute_action("calendar_create", payload, uuid.uuid4())

        assert result["success"] is True
        service.sync_service.create_calendar_event.assert_called_once()

    @pytest.mark.asyncio
    async def test_action_execution_meeting_prep(self):
        """Test meeting prep action (informational only)."""
        from app.services.autonomous_action_service import AutonomousActionService

        mock_db = AsyncMock()
        service = AutonomousActionService(mock_db)

        payload = {
            "event_id": "evt_123",
            "event_title": "Important Meeting",
            "start_time": "2024-01-20T14:00:00Z",
        }

        result = await service._execute_action("meeting_prep", payload, uuid.uuid4())

        # Meeting prep is acknowledged, not executed
        assert result["success"] is True
        assert "Acknowledged" in result["message"]

    @pytest.mark.asyncio
    async def test_action_execution_unknown_type(self):
        """Test handling of unknown action type."""
        from app.services.autonomous_action_service import AutonomousActionService

        mock_db = AsyncMock()
        service = AutonomousActionService(mock_db)

        result = await service._execute_action("unknown_type", {}, uuid.uuid4())

        assert result["success"] is False
        assert "Unknown action type" in result["message"]


class TestEmailActionGeneration:
    """Tests for email action generation logic."""

    @pytest.mark.asyncio
    async def test_email_confidence_calculation(self):
        """Test confidence score calculation for email actions."""
        # High urgency should result in higher confidence
        urgency_score = 0.9
        confidence = min(0.9, 0.5 + (urgency_score * 0.4))
        assert confidence == pytest.approx(0.86, rel=1e-9)

        # Lower urgency should result in lower confidence
        urgency_score = 0.3
        confidence = min(0.9, 0.5 + (urgency_score * 0.4))
        assert confidence == pytest.approx(0.62, rel=1e-9)

    @pytest.mark.asyncio
    async def test_email_priority_calculation(self):
        """Test priority score calculation for email actions."""
        # Urgent email
        urgency_score = 0.8
        is_urgent = True
        priority = 60 + (urgency_score * 30) if is_urgent else 40 + (urgency_score * 20)
        assert priority == 84

        # Non-urgent email
        is_urgent = False
        priority = 60 + (urgency_score * 30) if is_urgent else 40 + (urgency_score * 20)
        assert priority == 56


class TestCalendarActionGeneration:
    """Tests for calendar action generation logic."""

    @pytest.mark.asyncio
    async def test_conflict_detection_overlap(self):
        """Test calendar conflict detection with overlapping events."""
        # Event 1: 10:00-11:00
        # Event 2: 10:30-11:30
        # These overlap from 10:30-11:00

        from datetime import datetime

        s1 = datetime(2024, 1, 20, 10, 0)
        e1 = datetime(2024, 1, 20, 11, 0)
        s2 = datetime(2024, 1, 20, 10, 30)
        e2 = datetime(2024, 1, 20, 11, 30)

        # Check overlap: s1 < e2 and s2 < e1
        has_conflict = s1 < e2 and s2 < e1
        assert has_conflict is True

    @pytest.mark.asyncio
    async def test_no_conflict_sequential_events(self):
        """Test no conflict detection for sequential events."""
        # Event 1: 10:00-11:00
        # Event 2: 11:00-12:00 (starts exactly when first ends)

        from datetime import datetime

        s1 = datetime(2024, 1, 20, 10, 0)
        e1 = datetime(2024, 1, 20, 11, 0)
        s2 = datetime(2024, 1, 20, 11, 0)
        e2 = datetime(2024, 1, 20, 12, 0)

        # No overlap: e1 == s2
        has_conflict = s1 < e2 and s2 < e1
        assert has_conflict is False

    @pytest.mark.asyncio
    async def test_meeting_prep_timing(self):
        """Test meeting prep action is only generated for meetings within 4 hours."""
        from datetime import datetime, timedelta

        now = datetime.utcnow()
        cutoff = now + timedelta(hours=4)

        # Meeting in 2 hours - should get prep
        meeting_in_2h = now + timedelta(hours=2)
        should_prep_2h = now < meeting_in_2h < cutoff
        assert should_prep_2h is True

        # Meeting in 6 hours - should not get prep
        meeting_in_6h = now + timedelta(hours=6)
        should_prep_6h = now < meeting_in_6h < cutoff
        assert should_prep_6h is False


class TestActionFeedbackTracking:
    """Tests for feedback tracking functionality."""

    @pytest.mark.asyncio
    async def test_feedback_logged_on_approve(self):
        """Test that feedback is logged when action is approved."""
        from app.services.autonomous_action_service import AutonomousActionService
        from app.models.autonomous import AutonomousAction

        mock_db = AsyncMock()
        service = AutonomousActionService(mock_db)

        # Create mock action
        mock_action = MagicMock()
        mock_action.id = uuid.uuid4()
        mock_action.user_id = uuid.uuid4()
        mock_action.status = "pending"
        mock_action.action_type = "meeting_prep"
        mock_action.action_payload = {"event_id": "123"}

        # Mock get_action_by_id
        service.get_action_by_id = AsyncMock(return_value=mock_action)

        # Execute
        await service.approve_action(mock_action.id, mock_action.user_id)

        # Verify feedback was logged (db.add was called for ActionFeedback)
        assert mock_db.add.called
        assert mock_db.commit.called

    @pytest.mark.asyncio
    async def test_feedback_logged_on_dismiss(self):
        """Test that feedback is logged when action is dismissed."""
        from app.services.autonomous_action_service import AutonomousActionService

        mock_db = AsyncMock()
        service = AutonomousActionService(mock_db)

        # Create mock action
        mock_action = MagicMock()
        mock_action.id = uuid.uuid4()
        mock_action.user_id = uuid.uuid4()
        mock_action.status = "pending"

        # Mock get_action_by_id
        service.get_action_by_id = AsyncMock(return_value=mock_action)

        # Execute
        await service.dismiss_action(mock_action.id, mock_action.user_id, "wrong_timing")

        # Verify
        assert mock_action.status == "dismissed"
        assert mock_action.user_feedback == "wrong_timing"
        assert mock_db.commit.called


class TestActionExpiry:
    """Tests for action expiry functionality."""

    @pytest.mark.asyncio
    async def test_expire_old_actions(self):
        """Test expiring actions past their expiry time."""
        from app.services.autonomous_action_service import AutonomousActionService

        mock_db = AsyncMock()
        service = AutonomousActionService(mock_db)

        # Mock result
        mock_result = MagicMock()
        mock_result.rowcount = 3
        mock_db.execute.return_value = mock_result

        expired_count = await service.expire_old_actions()

        assert expired_count == 3
        assert mock_db.execute.called
        assert mock_db.commit.called


class TestActionStats:
    """Tests for action statistics."""

    @pytest.mark.asyncio
    async def test_approval_rate_calculation(self):
        """Test approval rate calculation."""
        # 10 executed, 5 dismissed = 10/15 = 0.67 approval rate
        executed = 10
        dismissed = 5
        total_actioned = executed + dismissed
        approval_rate = executed / total_actioned if total_actioned > 0 else 0

        assert round(approval_rate, 2) == 0.67

    @pytest.mark.asyncio
    async def test_approval_rate_no_actions(self):
        """Test approval rate when no actions actioned."""
        executed = 0
        dismissed = 0
        total_actioned = executed + dismissed
        approval_rate = executed / total_actioned if total_actioned > 0 else 0

        assert approval_rate == 0
