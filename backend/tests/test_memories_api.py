"""Tests for memories API endpoints."""
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch, MagicMock
import uuid


class TestMemoriesAPI:
    """Tests for /memories endpoints."""

    @pytest.mark.asyncio
    async def test_create_memory_success(self, auth_client, mock_user):
        """Test successful memory creation."""
        # Mock the memory service to avoid database complexity
        mock_memory = MagicMock()
        mock_memory.id = uuid.uuid4()

        with patch('app.api.memories.MemoryService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.create_memory.return_value = (mock_memory, ["John"])
            MockService.return_value = mock_instance

            response = await auth_client.post(
                "/memories",
                json={
                    "content": "Met with John today to discuss the project.",
                    "memory_type": "text",
                }
            )

            assert response.status_code == 201
            data = response.json()
            assert "memory_id" in data
            assert data["entities_extracted"] == ["John"]

    @pytest.mark.asyncio
    async def test_create_memory_with_date(self, auth_client, mock_user):
        """Test memory creation with specific date."""
        mock_memory = MagicMock()
        mock_memory.id = uuid.uuid4()

        with patch('app.api.memories.MemoryService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.create_memory.return_value = (mock_memory, [])
            MockService.return_value = mock_instance

            memory_date = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
            response = await auth_client.post(
                "/memories",
                json={
                    "content": "Yesterday's meeting notes.",
                    "memory_type": "text",
                    "memory_date": memory_date,
                }
            )

            assert response.status_code == 201

    @pytest.mark.asyncio
    async def test_create_memory_empty_content(self, auth_client, mock_user):
        """Test memory creation with empty content fails validation."""
        response = await auth_client.post(
            "/memories",
            json={
                "content": "",
                "memory_type": "text",
            }
        )
        # Should fail validation (content is required and non-empty)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_list_memories_empty(self, auth_client, mock_user):
        """Test listing memories when none exist."""
        with patch('app.api.memories.MemoryService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.list_memories.return_value = ([], 0)
            MockService.return_value = mock_instance

            response = await auth_client.get("/memories")

            assert response.status_code == 200
            data = response.json()
            assert data["memories"] == []
            assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_list_memories_with_pagination(self, auth_client, mock_user):
        """Test listing memories with pagination parameters."""
        mock_memory = MagicMock()
        mock_memory.id = uuid.uuid4()
        mock_memory.content = "Test memory"
        mock_memory.summary = None
        mock_memory.memory_type = "text"
        mock_memory.source_id = None
        mock_memory.source_url = None
        mock_memory.audio_url = None
        mock_memory.photo_url = None
        mock_memory.memory_date = datetime.now(timezone.utc)
        mock_memory.created_at = datetime.now(timezone.utc)
        mock_memory.entities = []

        with patch('app.api.memories.MemoryService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.list_memories.return_value = ([mock_memory], 50)
            MockService.return_value = mock_instance

            response = await auth_client.get(
                "/memories",
                params={"limit": 10, "offset": 20}
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["memories"]) == 1
            assert data["total"] == 50
            assert data["limit"] == 10
            assert data["offset"] == 20

    @pytest.mark.asyncio
    async def test_list_memories_filter_by_type(self, auth_client, mock_user):
        """Test filtering memories by type."""
        with patch('app.api.memories.MemoryService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.list_memories.return_value = ([], 0)
            MockService.return_value = mock_instance

            response = await auth_client.get(
                "/memories",
                params={"type": "voice"}
            )

            assert response.status_code == 200
            # Verify the service was called with correct filter
            mock_instance.list_memories.assert_called_once()
            call_kwargs = mock_instance.list_memories.call_args.kwargs
            assert call_kwargs["memory_type"] == "voice"

    @pytest.mark.asyncio
    async def test_get_memory_success(self, auth_client, mock_user):
        """Test getting a specific memory."""
        memory_id = uuid.uuid4()
        mock_memory = MagicMock()
        mock_memory.id = memory_id
        mock_memory.content = "Test memory content"
        mock_memory.summary = "Summary"
        mock_memory.memory_type = "text"
        mock_memory.source_id = None
        mock_memory.source_url = None
        mock_memory.audio_url = None
        mock_memory.photo_url = None
        mock_memory.memory_date = datetime.now(timezone.utc)
        mock_memory.created_at = datetime.now(timezone.utc)
        mock_memory.entities = []

        with patch('app.api.memories.MemoryService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.get_memory.return_value = mock_memory
            MockService.return_value = mock_instance

            response = await auth_client.get(f"/memories/{memory_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["content"] == "Test memory content"
            assert data["summary"] == "Summary"

    @pytest.mark.asyncio
    async def test_get_memory_not_found(self, auth_client, mock_user):
        """Test getting a non-existent memory returns 404."""
        memory_id = uuid.uuid4()

        with patch('app.api.memories.MemoryService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.get_memory.return_value = None
            MockService.return_value = mock_instance

            response = await auth_client.get(f"/memories/{memory_id}")

            assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_memory_success(self, auth_client, mock_user):
        """Test successful memory deletion."""
        memory_id = uuid.uuid4()

        with patch('app.api.memories.MemoryService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.delete_memory.return_value = True
            MockService.return_value = mock_instance

            response = await auth_client.delete(f"/memories/{memory_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    @pytest.mark.asyncio
    async def test_delete_memory_not_found(self, auth_client, mock_user):
        """Test deleting non-existent memory returns 404."""
        memory_id = uuid.uuid4()

        with patch('app.api.memories.MemoryService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.delete_memory.return_value = False
            MockService.return_value = mock_instance

            response = await auth_client.delete(f"/memories/{memory_id}")

            assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_search_memories(self, auth_client, mock_user):
        """Test memory search endpoint."""
        mock_memory = MagicMock()
        mock_memory.id = uuid.uuid4()
        mock_memory.content = "Meeting with client about sales"
        mock_memory.summary = None
        mock_memory.memory_type = "text"
        mock_memory.source_id = None
        mock_memory.source_url = None
        mock_memory.audio_url = None
        mock_memory.photo_url = None
        mock_memory.memory_date = datetime.now(timezone.utc)
        mock_memory.created_at = datetime.now(timezone.utc)
        mock_memory.entities = []

        with patch('app.api.memories.SearchService') as MockService:
            mock_instance = AsyncMock()
            mock_instance.search.return_value = [mock_memory]
            MockService.return_value = mock_instance

            response = await auth_client.get(
                "/memories/search",
                params={"q": "client meeting"}
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["memories"]) == 1
            assert "client" in data["memories"][0]["content"].lower()

    @pytest.mark.asyncio
    async def test_search_memories_requires_query(self, auth_client, mock_user):
        """Test search requires query parameter."""
        response = await auth_client.get("/memories/search")
        assert response.status_code == 422  # Missing required query param


class TestMemoriesAPIAuthentication:
    """Tests for authentication on memories endpoints."""

    @pytest.mark.asyncio
    async def test_create_memory_unauthorized(self, client):
        """Test creating memory without auth returns 401."""
        response = await client.post(
            "/memories",
            json={
                "content": "Test content",
                "memory_type": "text",
            }
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_list_memories_unauthorized(self, client):
        """Test listing memories without auth returns 401."""
        response = await client.get("/memories")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_memory_unauthorized(self, client):
        """Test getting memory without auth returns 401."""
        response = await client.get(f"/memories/{uuid.uuid4()}")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_delete_memory_unauthorized(self, client):
        """Test deleting memory without auth returns 401."""
        response = await client.delete(f"/memories/{uuid.uuid4()}")
        assert response.status_code == 401
