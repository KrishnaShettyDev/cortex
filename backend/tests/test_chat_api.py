"""Tests for chat API endpoints."""
import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch, MagicMock
import uuid


class TestChatAPI:
    """Tests for /chat endpoints."""

    @pytest.mark.asyncio
    async def test_chat_basic_message(self, auth_client, mock_user):
        """Test basic chat message processing."""
        mock_memory = MagicMock()
        mock_memory.id = uuid.uuid4()
        mock_memory.content = "Meeting with John last week about project"
        mock_memory.memory_type = "text"
        mock_memory.memory_date = datetime.now(timezone.utc)
        mock_memory.photo_url = None
        mock_memory.audio_url = None

        with patch('app.api.chat.ChatService') as MockChat, \
             patch('app.api.chat.SearchService') as MockSearch:
            mock_chat_instance = AsyncMock()
            mock_chat_instance.chat.return_value = (
                "Based on your memories, you met with John last week.",
                [mock_memory],
                "conv_123",
                [],  # actions_taken
                [],  # pending_actions
            )
            MockChat.return_value = mock_chat_instance

            response = await auth_client.post(
                "/chat",
                json={
                    "message": "What did I discuss with John?"
                }
            )

            assert response.status_code == 200
            data = response.json()
            assert "response" in data
            assert len(data["memories_used"]) == 1
            assert data["conversation_id"] == "conv_123"

    @pytest.mark.asyncio
    async def test_chat_with_conversation_id(self, auth_client, mock_user):
        """Test chat with existing conversation context."""
        with patch('app.api.chat.ChatService') as MockChat, \
             patch('app.api.chat.SearchService') as MockSearch:
            mock_chat_instance = AsyncMock()
            mock_chat_instance.chat.return_value = (
                "Continuing from our previous discussion...",
                [],
                "conv_456",
                [],
                [],
            )
            MockChat.return_value = mock_chat_instance

            response = await auth_client.post(
                "/chat",
                json={
                    "message": "Can you elaborate?",
                    "conversation_id": "conv_456"
                }
            )

            assert response.status_code == 200
            data = response.json()
            assert data["conversation_id"] == "conv_456"

    @pytest.mark.asyncio
    async def test_chat_returns_pending_actions(self, auth_client, mock_user):
        """Test chat returns pending actions for user approval."""
        with patch('app.api.chat.ChatService') as MockChat, \
             patch('app.api.chat.SearchService') as MockSearch:
            mock_chat_instance = AsyncMock()
            mock_chat_instance.chat.return_value = (
                "I'll create a meeting for you. Please confirm.",
                [],
                "conv_789",
                [],
                [{"action_id": "act_1", "tool": "create_event", "arguments": {"title": "Team Meeting"}}],
            )
            MockChat.return_value = mock_chat_instance

            response = await auth_client.post(
                "/chat",
                json={"message": "Schedule a team meeting tomorrow"}
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["pending_actions"]) == 1
            assert data["pending_actions"][0]["tool"] == "create_event"

    @pytest.mark.asyncio
    async def test_chat_empty_message_fails(self, auth_client, mock_user):
        """Test chat with empty message fails validation."""
        response = await auth_client.post(
            "/chat",
            json={"message": ""}
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_chat_with_context(self, auth_client, mock_user):
        """Test chat with context data for reinstatement."""
        with patch('app.api.chat.ChatService') as MockChat, \
             patch('app.api.chat.SearchService') as MockSearch:
            mock_chat_instance = AsyncMock()
            mock_chat_instance.chat.return_value = (
                "Here are your work-related memories...",
                [],
                "conv_101",
                [],
                [],
            )
            MockChat.return_value = mock_chat_instance

            response = await auth_client.post(
                "/chat",
                json={
                    "message": "What meetings do I have?",
                    "context": {
                        "time_of_day": "morning",
                        "day_of_week": "Monday",
                        "activity": "working",
                    }
                }
            )

            assert response.status_code == 200


class TestChatStreamAPI:
    """Tests for /chat/stream endpoint."""

    @pytest.mark.asyncio
    @pytest.mark.skip(reason="Requires full database setup with connected_accounts table")
    async def test_chat_stream_endpoint_exists(self, auth_client, mock_user):
        """Test chat stream endpoint is accessible."""
        with patch('app.api.chat.ChatService') as MockChat, \
             patch('app.api.chat.SearchService') as MockSearch:
            # Mock the streaming response
            async def mock_stream():
                yield "data: {\"type\": \"text\", \"content\": \"Hello\"}\n\n"
                yield "data: {\"type\": \"done\"}\n\n"

            mock_chat_instance = AsyncMock()
            mock_chat_instance.chat_stream = mock_stream
            MockChat.return_value = mock_chat_instance

            response = await auth_client.post(
                "/chat/stream",
                json={"message": "Hello"}
            )

            # Stream endpoints return 200 with text/event-stream
            assert response.status_code == 200


class TestGreetingAPI:
    """Tests for /chat/greeting endpoint."""

    @pytest.mark.asyncio
    @pytest.mark.skip(reason="Requires full database setup with connected_accounts table")
    async def test_get_greeting_morning(self, auth_client, mock_user):
        """Test morning greeting generation."""
        with patch('app.api.chat.ChatService') as MockChat, \
             patch('app.api.chat.SearchService') as MockSearch:
            mock_chat_instance = AsyncMock()
            mock_chat_instance.generate_greeting.return_value = (
                "Good morning! Ready to start the day?",
                {"weather": "sunny", "temperature": "72°F"}
            )
            MockChat.return_value = mock_chat_instance

            response = await auth_client.get(
                "/chat/greeting",
                params={"hour": 9}
            )

            assert response.status_code == 200
            data = response.json()
            assert "greeting" in data
            assert "morning" in data["greeting"].lower()

    @pytest.mark.asyncio
    @pytest.mark.skip(reason="Requires full database setup with connected_accounts table")
    async def test_get_greeting_default_hour(self, auth_client, mock_user):
        """Test greeting with default hour parameter."""
        with patch('app.api.chat.ChatService') as MockChat, \
             patch('app.api.chat.SearchService') as MockSearch:
            mock_chat_instance = AsyncMock()
            mock_chat_instance.generate_greeting.return_value = (
                "Hello there!",
                {}
            )
            MockChat.return_value = mock_chat_instance

            response = await auth_client.get("/chat/greeting")

            assert response.status_code == 200


class TestSuggestionsAPI:
    """Tests for /chat/suggestions endpoint."""

    @pytest.mark.asyncio
    @pytest.mark.skip(reason="Requires full database setup with connected_accounts table")
    async def test_get_smart_suggestions(self, auth_client, mock_user):
        """Test getting smart suggestions."""
        with patch('app.api.chat.SuggestionService') as MockSuggestion:
            mock_instance = AsyncMock()
            mock_instance.get_smart_suggestions.return_value = [
                {
                    "text": "What meetings do I have today?",
                    "icon": "calendar",
                    "category": "calendar",
                }
            ]
            MockSuggestion.return_value = mock_instance

            response = await auth_client.get("/chat/suggestions")

            assert response.status_code == 200
            data = response.json()
            assert "suggestions" in data
            assert len(data["suggestions"]) >= 0


class TestExecuteActionAPI:
    """Tests for /chat/execute-action endpoint."""

    @pytest.mark.asyncio
    @pytest.mark.skip(reason="Requires full database setup - execute-action endpoint needs conversation state")
    async def test_execute_action_success(self, auth_client, mock_user):
        """Test executing a pending action."""
        with patch('app.api.chat.ChatService') as MockChat, \
             patch('app.api.chat.SearchService') as MockSearch:
            mock_chat_instance = AsyncMock()
            mock_chat_instance.execute_pending_action.return_value = {
                "success": True,
                "message": "Event created successfully",
                "event_id": "evt_123",
            }
            MockChat.return_value = mock_chat_instance

            response = await auth_client.post(
                "/chat/execute-action",
                json={
                    "action_id": "act_1",
                    "conversation_id": "conv_123",
                    "approved": True,
                }
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    @pytest.mark.asyncio
    @pytest.mark.skip(reason="Requires full database setup - execute-action endpoint needs conversation state")
    async def test_execute_action_rejected(self, auth_client, mock_user):
        """Test rejecting a pending action."""
        with patch('app.api.chat.ChatService') as MockChat, \
             patch('app.api.chat.SearchService') as MockSearch:
            mock_chat_instance = AsyncMock()
            mock_chat_instance.execute_pending_action.return_value = {
                "success": True,
                "message": "Action cancelled",
            }
            MockChat.return_value = mock_chat_instance

            response = await auth_client.post(
                "/chat/execute-action",
                json={
                    "action_id": "act_1",
                    "conversation_id": "conv_123",
                    "approved": False,
                }
            )

            assert response.status_code == 200


class TestChatAPIAuthentication:
    """Tests for authentication on chat endpoints."""

    @pytest.mark.asyncio
    async def test_chat_unauthorized(self, client):
        """Test chat without auth returns 401."""
        response = await client.post(
            "/chat",
            json={"message": "Hello"}
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_chat_stream_unauthorized(self, client):
        """Test chat stream without auth returns 401."""
        response = await client.post(
            "/chat/stream",
            json={"message": "Hello"}
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_greeting_unauthorized(self, client):
        """Test greeting without auth returns 401."""
        response = await client.get("/chat/greeting")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_suggestions_unauthorized(self, client):
        """Test suggestions without auth returns 401."""
        response = await client.get("/chat/suggestions")
        assert response.status_code == 401
