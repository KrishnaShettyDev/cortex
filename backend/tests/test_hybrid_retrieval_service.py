"""
Tests for Hybrid Retrieval Service

Tests the hybrid search combining vector, entity, and temporal strategies.
"""

import pytest
from datetime import datetime, timedelta
from uuid import uuid4
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.hybrid_retrieval_service import (
    HybridRetrievalService,
    RetrievalResult,
    QueryAnalysis,
)
from app.models.memory_fact import MemoryFact


class TestQueryAnalysis:
    """Tests for query analysis."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        return db

    @pytest.fixture
    def reference_date(self):
        return datetime(2024, 1, 24, 12, 0, 0)

    @pytest.mark.asyncio
    async def test_analyze_simple_query(self, mock_db, reference_date):
        """Test analyzing a simple query."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("What do I know?", reference_date)

        assert isinstance(analysis, QueryAnalysis)
        assert analysis.original_query == "What do I know?"
        assert analysis.is_temporal_query is False

    @pytest.mark.asyncio
    async def test_analyze_entity_query(self, mock_db, reference_date):
        """Test analyzing a query with entities."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("Tell me about Sarah", reference_date)

        assert analysis.is_entity_query is True
        assert "Sarah" in analysis.entities

    @pytest.mark.asyncio
    async def test_analyze_multiple_entities(self, mock_db, reference_date):
        """Test analyzing a query with multiple entities."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("Meeting between John and Sarah at Google", reference_date)

        assert analysis.is_entity_query is True
        assert "John" in analysis.entities
        assert "Sarah" in analysis.entities
        assert "Google" in analysis.entities

    @pytest.mark.asyncio
    async def test_filter_non_entity_words(self, mock_db, reference_date):
        """Test that common words are filtered from entities."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("What did I do yesterday?", reference_date)

        # "What" and "I" should not be entities
        assert "What" not in analysis.entities
        assert "I" not in analysis.entities

    @pytest.mark.asyncio
    async def test_analyze_temporal_query(self, mock_db, reference_date):
        """Test analyzing a temporal query."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("What happened last week?", reference_date)

        assert analysis.is_temporal_query is True
        assert analysis.temporal_start is not None
        assert analysis.temporal_end is not None

    @pytest.mark.asyncio
    async def test_analyze_fact_types_person(self, mock_db, reference_date):
        """Test detecting person fact type."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("Who is my friend from college?", reference_date)

        assert "person" in analysis.fact_types

    @pytest.mark.asyncio
    async def test_analyze_fact_types_event(self, mock_db, reference_date):
        """Test detecting event fact type."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("What happened at the meeting?", reference_date)

        assert "event" in analysis.fact_types

    @pytest.mark.asyncio
    async def test_analyze_fact_types_preference(self, mock_db, reference_date):
        """Test detecting preference fact type."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("What is my favorite restaurant?", reference_date)

        assert "preference" in analysis.fact_types

    @pytest.mark.asyncio
    async def test_analyze_fact_types_plan(self, mock_db, reference_date):
        """Test detecting plan fact type."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("What is my schedule for tomorrow?", reference_date)

        assert "plan" in analysis.fact_types

    @pytest.mark.asyncio
    async def test_analyze_fact_types_location(self, mock_db, reference_date):
        """Test detecting location fact type."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("Where did I go last summer?", reference_date)

        assert "location" in analysis.fact_types

    @pytest.mark.asyncio
    async def test_analyze_fact_types_work(self, mock_db, reference_date):
        """Test detecting work fact type."""
        service = HybridRetrievalService(mock_db)

        analysis = await service.analyze_query("What company does Sarah work for?", reference_date)

        assert "work" in analysis.fact_types


class TestVectorSearch:
    """Tests for vector search."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.execute = AsyncMock()
        db.connection = AsyncMock()
        return db

    @pytest.fixture
    def user_id(self):
        return uuid4()

    @pytest.mark.asyncio
    async def test_vector_search_empty_results(self, mock_db, user_id):
        """Test vector search with no results."""
        service = HybridRetrievalService(mock_db)

        # Mock connection and results
        mock_conn = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_conn.exec_driver_sql = AsyncMock(return_value=mock_result)
        mock_db.connection.return_value = mock_conn

        with patch('app.services.hybrid_retrieval_service.embedding_service') as mock_embedding:
            mock_embedding.embed = AsyncMock(return_value=[0.1] * 1536)

            results = await service.vector_search(user_id, "test query", limit=10)

        assert results == []

    @pytest.mark.asyncio
    async def test_vector_search_with_results(self, mock_db, user_id):
        """Test vector search with results."""
        service = HybridRetrievalService(mock_db)

        fact_id = uuid4()
        fact = MemoryFact(
            id=fact_id,
            user_id=user_id,
            fact_text="Sarah works at Google",
            fact_type="work",
            document_date=datetime.utcnow(),
            is_current=True,
        )

        # Mock connection
        mock_conn = AsyncMock()
        mock_sql_result = MagicMock()
        mock_sql_result.fetchall.return_value = [(fact_id, 0.95)]
        mock_conn.exec_driver_sql = AsyncMock(return_value=mock_sql_result)
        mock_db.connection.return_value = mock_conn

        # Mock fact retrieval
        mock_fact_result = MagicMock()
        mock_fact_result.scalar_one_or_none.return_value = fact
        mock_db.execute.return_value = mock_fact_result

        with patch('app.services.hybrid_retrieval_service.embedding_service') as mock_embedding:
            mock_embedding.embed = AsyncMock(return_value=[0.1] * 1536)

            results = await service.vector_search(user_id, "Where does Sarah work?")

        assert len(results) == 1
        assert results[0].fact == fact
        assert results[0].score == 0.95
        assert results[0].source == "vector"

    @pytest.mark.asyncio
    async def test_vector_search_error_handling(self, mock_db, user_id):
        """Test vector search error handling."""
        service = HybridRetrievalService(mock_db)

        mock_db.connection.side_effect = Exception("Database error")

        with patch('app.services.hybrid_retrieval_service.embedding_service') as mock_embedding:
            mock_embedding.embed = AsyncMock(return_value=[0.1] * 1536)

            results = await service.vector_search(user_id, "test")

        assert results == []


class TestEntitySearch:
    """Tests for entity search."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.execute = AsyncMock()
        return db

    @pytest.fixture
    def user_id(self):
        return uuid4()

    @pytest.mark.asyncio
    async def test_entity_search_empty_entities(self, mock_db, user_id):
        """Test entity search with no entities."""
        service = HybridRetrievalService(mock_db)

        results = await service.entity_search(user_id, [])

        assert results == []
        assert not mock_db.execute.called

    @pytest.mark.asyncio
    async def test_entity_search_single_entity(self, mock_db, user_id):
        """Test entity search with single entity."""
        service = HybridRetrievalService(mock_db)

        fact = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Sarah works at Google",
            fact_type="work",
            subject_entity="Sarah",
            object_entity="Google",
            document_date=datetime.utcnow(),
            is_current=True,
        )

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [fact]
        mock_db.execute.return_value = mock_result

        results = await service.entity_search(user_id, ["Sarah"])

        assert len(results) == 1
        assert results[0].fact == fact
        assert results[0].source == "entity"

    @pytest.mark.asyncio
    async def test_entity_search_scoring(self, mock_db, user_id):
        """Test entity search scoring based on matches."""
        service = HybridRetrievalService(mock_db)

        fact = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Sarah met John at Google",
            fact_type="event",
            subject_entity="Sarah",
            object_entity="John",
            document_date=datetime.utcnow(),
            is_current=True,
        )

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [fact]
        mock_db.execute.return_value = mock_result

        results = await service.entity_search(user_id, ["Sarah", "John"])

        assert len(results) == 1
        # Both entities match, so score should be 1.0
        assert results[0].score == 1.0


class TestTemporalSearch:
    """Tests for temporal search."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.execute = AsyncMock()
        return db

    @pytest.fixture
    def user_id(self):
        return uuid4()

    @pytest.mark.asyncio
    async def test_temporal_search(self, mock_db, user_id):
        """Test temporal search."""
        service = HybridRetrievalService(mock_db)

        start_date = datetime(2024, 1, 20)
        end_date = datetime(2024, 1, 25)

        fact = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Met Sarah for coffee",
            fact_type="event",
            event_date=datetime(2024, 1, 22),
            document_date=datetime.utcnow(),
            is_current=True,
        )

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [fact]
        mock_db.execute.return_value = mock_result

        results = await service.temporal_search(user_id, start_date, end_date)

        assert len(results) == 1
        assert results[0].fact == fact
        assert results[0].source == "temporal"

    @pytest.mark.asyncio
    async def test_temporal_search_scoring(self, mock_db, user_id):
        """Test temporal search scores by proximity to center."""
        service = HybridRetrievalService(mock_db)

        start_date = datetime(2024, 1, 20)
        end_date = datetime(2024, 1, 25)
        center = datetime(2024, 1, 22, 12)  # Center of range

        fact_at_center = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Event at center",
            fact_type="event",
            event_date=center,
            document_date=datetime.utcnow(),
            is_current=True,
        )

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [fact_at_center]
        mock_db.execute.return_value = mock_result

        results = await service.temporal_search(user_id, start_date, end_date)

        assert len(results) == 1
        # Event at center should have high score
        assert results[0].score > 0.5

    @pytest.mark.asyncio
    async def test_temporal_search_no_event_date(self, mock_db, user_id):
        """Test temporal search with fact missing event_date."""
        service = HybridRetrievalService(mock_db)

        start_date = datetime(2024, 1, 20)
        end_date = datetime(2024, 1, 25)

        fact = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Some event",
            fact_type="event",
            event_date=None,  # No event date
            document_date=datetime.utcnow(),
            is_current=True,
        )

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [fact]
        mock_db.execute.return_value = mock_result

        results = await service.temporal_search(user_id, start_date, end_date)

        assert len(results) == 1
        assert results[0].score == 0.5  # Default score for no event date


class TestReciprocalRankFusion:
    """Tests for RRF merging."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        return AsyncMock()

    @pytest.fixture
    def user_id(self):
        return uuid4()

    def test_rrf_empty_lists(self, mock_db):
        """Test RRF with empty input."""
        service = HybridRetrievalService(mock_db)

        merged = service._reciprocal_rank_fusion([])

        assert merged == []

    def test_rrf_single_list(self, mock_db, user_id):
        """Test RRF with single result list."""
        service = HybridRetrievalService(mock_db)

        fact = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Test fact",
            fact_type="other",
            document_date=datetime.utcnow(),
            is_current=True,
        )

        results = [RetrievalResult(fact=fact, score=0.9, source="vector")]

        merged = service._reciprocal_rank_fusion([results])

        assert len(merged) == 1
        assert merged[0].fact == fact

    def test_rrf_multiple_lists(self, mock_db, user_id):
        """Test RRF with multiple result lists."""
        service = HybridRetrievalService(mock_db)

        fact1 = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Fact 1",
            fact_type="other",
            document_date=datetime.utcnow(),
            is_current=True,
        )
        fact2 = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Fact 2",
            fact_type="other",
            document_date=datetime.utcnow(),
            is_current=True,
        )

        vector_results = [
            RetrievalResult(fact=fact1, score=0.9, source="vector"),
            RetrievalResult(fact=fact2, score=0.8, source="vector"),
        ]
        entity_results = [
            RetrievalResult(fact=fact2, score=0.95, source="entity"),
        ]

        merged = service._reciprocal_rank_fusion([vector_results, entity_results])

        assert len(merged) == 2
        # fact2 appears in both lists, so should rank higher
        fact2_in_merged = next(r for r in merged if r.fact == fact2)
        assert "vector" in fact2_in_merged.source
        assert "entity" in fact2_in_merged.source

    def test_rrf_with_weights(self, mock_db, user_id):
        """Test RRF with custom weights."""
        service = HybridRetrievalService(mock_db)

        fact = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Test fact",
            fact_type="other",
            document_date=datetime.utcnow(),
            is_current=True,
        )

        results = [RetrievalResult(fact=fact, score=0.9, source="vector")]

        # Test with weight
        merged_weighted = service._reciprocal_rank_fusion([results], weights=[2.0])
        merged_unweighted = service._reciprocal_rank_fusion([results], weights=[1.0])

        # Weighted should have higher RRF score
        assert merged_weighted[0].score > merged_unweighted[0].score


class TestHybridSearch:
    """Tests for hybrid search combining all strategies."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        db = AsyncMock()
        db.execute = AsyncMock()
        db.connection = AsyncMock()
        return db

    @pytest.fixture
    def user_id(self):
        return uuid4()

    @pytest.fixture
    def reference_date(self):
        return datetime(2024, 1, 24, 12, 0, 0)

    @pytest.mark.asyncio
    async def test_hybrid_search_basic(self, mock_db, user_id, reference_date):
        """Test basic hybrid search."""
        service = HybridRetrievalService(mock_db)

        fact = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Sarah works at Google",
            fact_type="work",
            subject_entity="Sarah",
            document_date=datetime.utcnow(),
            is_current=True,
        )

        # Mock vector search
        with patch.object(
            service, 'vector_search', new_callable=AsyncMock
        ) as mock_vector, patch.object(
            service, 'entity_search', new_callable=AsyncMock
        ) as mock_entity:
            mock_vector.return_value = [
                RetrievalResult(fact=fact, score=0.9, source="vector")
            ]
            mock_entity.return_value = [
                RetrievalResult(fact=fact, score=0.95, source="entity")
            ]

            results = await service.search(user_id, "Where does Sarah work?", reference_date)

        assert len(results) >= 1
        assert results[0].fact == fact

    @pytest.mark.asyncio
    async def test_hybrid_search_with_temporal(self, mock_db, user_id, reference_date):
        """Test hybrid search with temporal component."""
        service = HybridRetrievalService(mock_db)

        fact = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Had meeting last week",
            fact_type="event",
            event_date=reference_date - timedelta(days=7),
            document_date=datetime.utcnow(),
            is_current=True,
        )

        with patch.object(
            service, 'vector_search', new_callable=AsyncMock
        ) as mock_vector, patch.object(
            service, 'temporal_search', new_callable=AsyncMock
        ) as mock_temporal:
            mock_vector.return_value = [
                RetrievalResult(fact=fact, score=0.8, source="vector")
            ]
            mock_temporal.return_value = [
                RetrievalResult(fact=fact, score=0.9, source="temporal")
            ]

            results = await service.search(
                user_id, "What happened last week?", reference_date
            )

        assert len(results) >= 1


class TestSearchWithConfidence:
    """Tests for confidence scoring."""

    @pytest.fixture
    def mock_db(self):
        """Create a mock database session."""
        return AsyncMock()

    @pytest.fixture
    def user_id(self):
        return uuid4()

    @pytest.fixture
    def reference_date(self):
        return datetime(2024, 1, 24, 12, 0, 0)

    @pytest.mark.asyncio
    async def test_confidence_with_no_results(self, mock_db, user_id, reference_date):
        """Test confidence is 0 with no results."""
        service = HybridRetrievalService(mock_db)

        with patch.object(service, 'search', new_callable=AsyncMock) as mock_search:
            mock_search.return_value = []

            results, confidence = await service.search_with_confidence(
                user_id, "Unknown topic", reference_date
            )

        assert results == []
        assert confidence == 0.0

    @pytest.mark.asyncio
    async def test_confidence_with_high_score_results(self, mock_db, user_id, reference_date):
        """Test high confidence with good results."""
        service = HybridRetrievalService(mock_db)

        facts = [
            MemoryFact(
                id=uuid4(),
                user_id=user_id,
                fact_text=f"Fact {i}",
                fact_type="other",
                document_date=datetime.utcnow(),
                is_current=True,
            )
            for i in range(5)
        ]

        high_score_results = [
            RetrievalResult(fact=f, score=0.9, source="vector")
            for f in facts
        ]

        with patch.object(service, 'search', new_callable=AsyncMock) as mock_search:
            mock_search.return_value = high_score_results

            results, confidence = await service.search_with_confidence(
                user_id, "Test query", reference_date
            )

        assert len(results) == 5
        assert confidence > 0.5  # Should have decent confidence

    @pytest.mark.asyncio
    async def test_confidence_with_low_score_results(self, mock_db, user_id, reference_date):
        """Test lower confidence with poor results."""
        service = HybridRetrievalService(mock_db)

        fact = MemoryFact(
            id=uuid4(),
            user_id=user_id,
            fact_text="Barely related fact",
            fact_type="other",
            document_date=datetime.utcnow(),
            is_current=True,
        )

        low_score_results = [
            RetrievalResult(fact=fact, score=0.3, source="vector")
        ]

        with patch.object(service, 'search', new_callable=AsyncMock) as mock_search:
            mock_search.return_value = low_score_results

            results, confidence = await service.search_with_confidence(
                user_id, "Test query", reference_date
            )

        assert len(results) == 1
        assert confidence < 0.5  # Should have low confidence


class TestRetrievalResult:
    """Tests for RetrievalResult dataclass."""

    def test_retrieval_result_creation(self):
        """Test creating a RetrievalResult."""
        fact = MemoryFact(
            id=uuid4(),
            user_id=uuid4(),
            fact_text="Test fact",
            fact_type="other",
            document_date=datetime.utcnow(),
            is_current=True,
        )

        result = RetrievalResult(
            fact=fact,
            score=0.95,
            source="vector"
        )

        assert result.fact == fact
        assert result.score == 0.95
        assert result.source == "vector"


class TestQueryAnalysisDataclass:
    """Tests for QueryAnalysis dataclass."""

    def test_query_analysis_creation(self):
        """Test creating a QueryAnalysis."""
        analysis = QueryAnalysis(
            original_query="Test query",
            entities=["Sarah", "Google"],
            temporal_start=datetime(2024, 1, 20),
            temporal_end=datetime(2024, 1, 25),
            fact_types=["work", "person"],
            is_temporal_query=True,
            is_entity_query=True,
        )

        assert analysis.original_query == "Test query"
        assert len(analysis.entities) == 2
        assert analysis.is_temporal_query is True
        assert analysis.is_entity_query is True
