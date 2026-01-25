"""
Tests for Fact Extraction Service

Tests the extraction of atomic facts from memories.
"""

import pytest
import json
from datetime import datetime, timedelta
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.fact_extraction_service import FactExtractionService, FACT_TYPES


class MockMessage:
    """Mock for OpenAI message."""
    def __init__(self, content):
        self.content = content


class MockChoice:
    """Mock for OpenAI choice."""
    def __init__(self, content):
        self.message = MockMessage(content)


class MockCompletion:
    """Mock for OpenAI completion."""
    def __init__(self, content):
        self.choices = [MockChoice(content)]


class TestFactExtractionService:
    """Tests for FactExtractionService."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()
        db.execute = AsyncMock()
        return db

    @pytest.fixture
    def user_id(self):
        return uuid4()

    @pytest.fixture
    def memory_id(self):
        return uuid4()

    @pytest.fixture
    def document_date(self):
        return datetime(2024, 1, 24, 12, 0, 0)

    # =========================================================================
    # Fact Type Tests
    # =========================================================================

    def test_fact_types_defined(self):
        """Test that all expected fact types are defined."""
        expected_types = [
            "person", "event", "preference", "plan", "location",
            "temporal", "relationship", "work", "health", "other"
        ]
        for fact_type in expected_types:
            assert fact_type in FACT_TYPES

    # =========================================================================
    # Basic Extraction Tests
    # =========================================================================

    @pytest.mark.asyncio
    async def test_extract_empty_content(self, mock_db, user_id, memory_id, document_date):
        """Test that empty content returns no facts."""
        service = FactExtractionService(mock_db)
        facts = await service.extract_facts_from_memory(
            user_id=user_id,
            memory_id=memory_id,
            content="",
            document_date=document_date,
        )
        assert facts == []

    @pytest.mark.asyncio
    async def test_extract_short_content(self, mock_db, user_id, memory_id, document_date):
        """Test that very short content returns no facts."""
        service = FactExtractionService(mock_db)
        facts = await service.extract_facts_from_memory(
            user_id=user_id,
            memory_id=memory_id,
            content="Hi",
            document_date=document_date,
        )
        assert facts == []

    @pytest.mark.asyncio
    async def test_extract_single_fact(self, mock_db, user_id, memory_id, document_date):
        """Test extracting a single fact."""
        service = FactExtractionService(mock_db)

        # Mock the OpenAI response
        response_data = [
            {
                "fact_text": "Sarah works at Google",
                "fact_type": "work",
                "subject_entity": "Sarah",
                "object_entity": "Google",
                "relation": "works_at",
                "temporal_expression": None,
                "event_date": None,
                "confidence": 0.95
            }
        ]

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = MockCompletion(json.dumps(response_data))

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="Sarah just got a job at Google",
                document_date=document_date,
            )

        assert len(facts) == 1
        assert facts[0].fact_text == "Sarah works at Google"
        assert facts[0].fact_type == "work"
        assert facts[0].subject_entity == "Sarah"
        assert facts[0].object_entity == "Google"
        assert facts[0].relation == "works_at"
        assert facts[0].confidence == 0.95

    @pytest.mark.asyncio
    async def test_extract_multiple_facts(self, mock_db, user_id, memory_id, document_date):
        """Test extracting multiple facts from one memory."""
        service = FactExtractionService(mock_db)

        response_data = [
            {
                "fact_text": "Sarah got promoted to VP",
                "fact_type": "work",
                "subject_entity": "Sarah",
                "object_entity": "VP",
                "relation": "promoted_to",
                "temporal_expression": None,
                "event_date": None,
                "confidence": 0.95
            },
            {
                "fact_text": "Sarah works at Google",
                "fact_type": "work",
                "subject_entity": "Sarah",
                "object_entity": "Google",
                "relation": "works_at",
                "temporal_expression": None,
                "event_date": None,
                "confidence": 0.9
            },
            {
                "fact_text": "User had coffee with Sarah",
                "fact_type": "event",
                "subject_entity": "User",
                "object_entity": "Sarah",
                "relation": "met",
                "temporal_expression": "yesterday",
                "event_date": "2024-01-23",
                "confidence": 0.85
            }
        ]

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = MockCompletion(json.dumps(response_data))

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="Had coffee with Sarah yesterday. She mentioned she got promoted to VP at Google.",
                document_date=document_date,
            )

        assert len(facts) == 3

    @pytest.mark.asyncio
    async def test_extract_with_temporal_expression(self, mock_db, user_id, memory_id, document_date):
        """Test extracting facts with temporal expressions."""
        service = FactExtractionService(mock_db)

        response_data = [
            {
                "fact_text": "User visited Paris",
                "fact_type": "event",
                "subject_entity": "User",
                "object_entity": "Paris",
                "relation": "visited",
                "temporal_expression": "last month",
                "event_date": "2023-12-24",
                "confidence": 0.9
            }
        ]

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = MockCompletion(json.dumps(response_data))

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="I visited Paris last month",
                document_date=document_date,
            )

        assert len(facts) == 1
        assert facts[0].temporal_expression == "last month"
        assert facts[0].event_date is not None
        assert facts[0].event_date.year == 2023
        assert facts[0].event_date.month == 12

    # =========================================================================
    # Low Confidence Filtering Tests
    # =========================================================================

    @pytest.mark.asyncio
    async def test_filter_low_confidence_facts(self, mock_db, user_id, memory_id, document_date):
        """Test that low confidence facts are filtered out."""
        service = FactExtractionService(mock_db)

        response_data = [
            {
                "fact_text": "High confidence fact",
                "fact_type": "work",
                "subject_entity": "Sarah",
                "object_entity": "Google",
                "relation": "works_at",
                "temporal_expression": None,
                "event_date": None,
                "confidence": 0.9
            },
            {
                "fact_text": "Low confidence fact",
                "fact_type": "other",
                "subject_entity": "Unknown",
                "object_entity": None,
                "relation": None,
                "temporal_expression": None,
                "event_date": None,
                "confidence": 0.3  # Below threshold
            }
        ]

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = MockCompletion(json.dumps(response_data))

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="Sarah works at Google and something unclear",
                document_date=document_date,
            )

        # Only high confidence fact should be included
        assert len(facts) == 1
        assert facts[0].fact_text == "High confidence fact"

    # =========================================================================
    # JSON Parsing Tests
    # =========================================================================

    @pytest.mark.asyncio
    async def test_parse_markdown_code_block(self, mock_db, user_id, memory_id, document_date):
        """Test parsing response with markdown code blocks."""
        service = FactExtractionService(mock_db)

        response_data = [
            {
                "fact_text": "Sarah works at Google",
                "fact_type": "work",
                "subject_entity": "Sarah",
                "object_entity": "Google",
                "relation": "works_at",
                "temporal_expression": None,
                "event_date": None,
                "confidence": 0.95
            }
        ]

        # Response wrapped in markdown code block
        markdown_response = f"```json\n{json.dumps(response_data)}\n```"

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = MockCompletion(markdown_response)

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="Sarah works at Google",
                document_date=document_date,
            )

        assert len(facts) == 1

    @pytest.mark.asyncio
    async def test_handle_invalid_json(self, mock_db, user_id, memory_id, document_date):
        """Test handling invalid JSON response."""
        service = FactExtractionService(mock_db)

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = MockCompletion("This is not valid JSON")

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="Sarah works at Google",
                document_date=document_date,
            )

        # Should return empty list on parse error
        assert facts == []

    @pytest.mark.asyncio
    async def test_handle_non_list_response(self, mock_db, user_id, memory_id, document_date):
        """Test handling non-list JSON response."""
        service = FactExtractionService(mock_db)

        # Return an object instead of array
        response = '{"fact": "single fact"}'

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = MockCompletion(response)

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="Sarah works at Google",
                document_date=document_date,
            )

        assert facts == []

    # =========================================================================
    # Error Handling Tests
    # =========================================================================

    @pytest.mark.asyncio
    async def test_handle_api_error(self, mock_db, user_id, memory_id, document_date):
        """Test handling API errors."""
        service = FactExtractionService(mock_db)

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.side_effect = Exception("API Error")

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="Sarah works at Google",
                document_date=document_date,
            )

        assert facts == []

    # =========================================================================
    # Save Facts Tests
    # =========================================================================

    @pytest.mark.asyncio
    async def test_save_facts(self, mock_db, user_id, memory_id, document_date):
        """Test saving facts to database."""
        service = FactExtractionService(mock_db)

        # Create mock facts
        from app.models.memory_fact import MemoryFact
        facts = [
            MemoryFact(
                memory_id=memory_id,
                user_id=user_id,
                fact_text="Sarah works at Google",
                fact_type="work",
                confidence=0.95,
                document_date=document_date,
                is_current=True,
            )
        ]

        # Mock embedding service
        with patch('app.services.fact_extraction_service.embedding_service') as mock_embedding:
            mock_embedding.embed = AsyncMock(return_value=[0.1] * 1536)

            saved = await service.save_facts(facts)

        assert len(saved) == 1
        assert mock_db.add.called
        assert mock_db.commit.called

    @pytest.mark.asyncio
    async def test_save_empty_facts(self, mock_db):
        """Test saving empty list returns empty list."""
        service = FactExtractionService(mock_db)
        saved = await service.save_facts([])
        assert saved == []
        assert not mock_db.add.called

    # =========================================================================
    # Fact Type Coverage Tests
    # =========================================================================

    @pytest.mark.asyncio
    async def test_extract_person_fact(self, mock_db, user_id, memory_id, document_date):
        """Test extracting person-type facts."""
        service = FactExtractionService(mock_db)

        response_data = [
            {
                "fact_text": "Sarah is User's sister",
                "fact_type": "person",
                "subject_entity": "Sarah",
                "object_entity": "User",
                "relation": "sister_of",
                "temporal_expression": None,
                "event_date": None,
                "confidence": 0.95
            }
        ]

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = MockCompletion(json.dumps(response_data))

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="My sister Sarah called today",
                document_date=document_date,
            )

        assert len(facts) == 1
        assert facts[0].fact_type == "person"

    @pytest.mark.asyncio
    async def test_extract_preference_fact(self, mock_db, user_id, memory_id, document_date):
        """Test extracting preference-type facts."""
        service = FactExtractionService(mock_db)

        response_data = [
            {
                "fact_text": "User likes Italian food",
                "fact_type": "preference",
                "subject_entity": "User",
                "object_entity": "Italian food",
                "relation": "likes",
                "temporal_expression": None,
                "event_date": None,
                "confidence": 0.9
            }
        ]

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = MockCompletion(json.dumps(response_data))

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="I really love Italian food",
                document_date=document_date,
            )

        assert len(facts) == 1
        assert facts[0].fact_type == "preference"

    @pytest.mark.asyncio
    async def test_extract_plan_fact(self, mock_db, user_id, memory_id, document_date):
        """Test extracting plan-type facts."""
        service = FactExtractionService(mock_db)

        response_data = [
            {
                "fact_text": "User has meeting with John tomorrow",
                "fact_type": "plan",
                "subject_entity": "User",
                "object_entity": "John",
                "relation": "meeting_with",
                "temporal_expression": "tomorrow",
                "event_date": "2024-01-25",
                "confidence": 0.9
            }
        ]

        with patch.object(
            service.client.chat.completions,
            'create',
            new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = MockCompletion(json.dumps(response_data))

            facts = await service.extract_facts_from_memory(
                user_id=user_id,
                memory_id=memory_id,
                content="I have a meeting with John tomorrow",
                document_date=document_date,
            )

        assert len(facts) == 1
        assert facts[0].fact_type == "plan"
        assert facts[0].temporal_expression == "tomorrow"
