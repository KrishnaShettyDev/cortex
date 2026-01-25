"""
Hybrid Retrieval Service

Combines multiple retrieval strategies for optimal recall and precision:
1. Vector similarity search
2. Entity-based retrieval
3. Temporal filtering
4. Reciprocal Rank Fusion (RRF) for result merging

This is essential for achieving SOTA on MemoryBench.
"""

import logging
from datetime import datetime
from uuid import UUID
from typing import Optional
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import defer

from app.memory_config import get_memory_config
from app.models.memory_fact import MemoryFact, EntityRelation
from app.services.embedding_service import embedding_service

config = get_memory_config()
logger = logging.getLogger(__name__)


@dataclass
class RetrievalResult:
    """A retrieved fact with scoring information."""
    fact: MemoryFact
    score: float
    source: str  # "vector", "entity", "temporal", "relation"


@dataclass
class QueryAnalysis:
    """Analyzed query with extracted components."""
    original_query: str
    entities: list[str]
    temporal_start: Optional[datetime]
    temporal_end: Optional[datetime]
    fact_types: list[str]
    is_temporal_query: bool
    is_entity_query: bool


class HybridRetrievalService:
    """Service for hybrid fact retrieval."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def analyze_query(
        self,
        query: str,
        reference_date: Optional[datetime] = None,
    ) -> QueryAnalysis:
        """
        Analyze a query to extract entities, temporal references, etc.

        Args:
            query: The search query
            reference_date: Reference date for temporal parsing

        Returns:
            QueryAnalysis with extracted components
        """
        reference_date = reference_date or datetime.utcnow()

        # Extract entities (simple heuristic: capitalized words)
        words = query.split()
        entities = [w.strip(".,!?") for w in words if w[0].isupper() and len(w) > 1]

        # Common non-entity capitalized words
        non_entities = {"I", "What", "When", "Where", "Who", "How", "Why", "The", "A", "An", "My", "Your"}
        entities = [e for e in entities if e not in non_entities]

        # Extract temporal range (simplified - no longer uses temporal parser)
        temporal_start, temporal_end = None, None

        # Detect fact types from query
        fact_types = []
        query_lower = query.lower()

        type_keywords = {
            "person": ["who", "person", "friend", "family", "colleague"],
            "event": ["what happened", "did i", "meeting", "event", "trip"],
            "preference": ["like", "prefer", "favorite", "love", "hate"],
            "plan": ["plan", "schedule", "appointment", "going to", "will"],
            "location": ["where", "place", "location", "city", "country"],
            "work": ["job", "work", "company", "career", "project"],
        }

        for fact_type, keywords in type_keywords.items():
            if any(kw in query_lower for kw in keywords):
                fact_types.append(fact_type)

        return QueryAnalysis(
            original_query=query,
            entities=entities,
            temporal_start=temporal_start,
            temporal_end=temporal_end,
            fact_types=fact_types,
            is_temporal_query=temporal_start is not None,
            is_entity_query=len(entities) > 0,
        )

    async def vector_search(
        self,
        user_id: UUID,
        query: str,
        limit: int = 20,
    ) -> list[RetrievalResult]:
        """
        Perform vector similarity search.

        Args:
            user_id: The user's ID
            query: The search query
            limit: Maximum results

        Returns:
            List of RetrievalResult
        """
        try:
            query_embedding = await embedding_service.embed(query)
            embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

            raw_conn = await self.db.connection()
            result = await raw_conn.exec_driver_sql(
                """
                SELECT id, 1 - (embedding <=> $1::vector) as similarity
                FROM cortex_memory_facts
                WHERE user_id = $2::uuid
                AND is_current = true
                AND embedding IS NOT NULL
                ORDER BY embedding <=> $1::vector
                LIMIT $3
                """,
                (embedding_str, str(user_id), limit)
            )

            rows = result.fetchall()
            results = []

            for fact_id, similarity in rows:
                fact_result = await self.db.execute(
                    select(MemoryFact)
                    .options(defer(MemoryFact.embedding))
                    .where(MemoryFact.id == fact_id)
                )
                fact = fact_result.scalar_one_or_none()
                if fact:
                    results.append(RetrievalResult(
                        fact=fact,
                        score=float(similarity),
                        source="vector"
                    ))

            return results

        except Exception as e:
            logger.error(f"Vector search failed: {e}")
            return []

    async def entity_search(
        self,
        user_id: UUID,
        entities: list[str],
        limit: int = 20,
    ) -> list[RetrievalResult]:
        """
        Search facts by entity names.

        Args:
            user_id: The user's ID
            entities: List of entity names to search
            limit: Maximum results

        Returns:
            List of RetrievalResult
        """
        if not entities:
            return []

        # Build OR conditions for all entities
        entity_conditions = []
        for entity in entities:
            entity_conditions.extend([
                MemoryFact.subject_entity.ilike(f"%{entity}%"),
                MemoryFact.object_entity.ilike(f"%{entity}%"),
            ])

        query = select(MemoryFact).options(
            defer(MemoryFact.embedding)
        ).where(
            and_(
                MemoryFact.user_id == user_id,
                MemoryFact.is_current == True,
                or_(*entity_conditions)
            )
        ).order_by(MemoryFact.document_date.desc()).limit(limit)

        result = await self.db.execute(query)
        facts = result.scalars().all()

        # Score based on number of entities matched
        results = []
        for fact in facts:
            matches = 0
            for entity in entities:
                entity_lower = entity.lower()
                if fact.subject_entity and entity_lower in fact.subject_entity.lower():
                    matches += 1
                if fact.object_entity and entity_lower in fact.object_entity.lower():
                    matches += 1

            score = min(1.0, matches / len(entities))
            results.append(RetrievalResult(
                fact=fact,
                score=score,
                source="entity"
            ))

        return results

    async def temporal_search(
        self,
        user_id: UUID,
        start_date: datetime,
        end_date: datetime,
        limit: int = 20,
    ) -> list[RetrievalResult]:
        """
        Search facts by time range.

        Args:
            user_id: The user's ID
            start_date: Start of time range
            end_date: End of time range
            limit: Maximum results

        Returns:
            List of RetrievalResult
        """
        query = select(MemoryFact).options(
            defer(MemoryFact.embedding)
        ).where(
            and_(
                MemoryFact.user_id == user_id,
                MemoryFact.is_current == True,
                MemoryFact.event_date >= start_date,
                MemoryFact.event_date <= end_date,
            )
        ).order_by(MemoryFact.event_date.asc()).limit(limit)

        result = await self.db.execute(query)
        facts = result.scalars().all()

        # Score based on temporal proximity to query center
        center = start_date + (end_date - start_date) / 2
        results = []

        for fact in facts:
            if fact.event_date:
                distance = abs((fact.event_date - center).total_seconds())
                max_distance = (end_date - start_date).total_seconds() / 2
                score = 1.0 - min(1.0, distance / max_distance) if max_distance > 0 else 1.0
            else:
                score = 0.5

            results.append(RetrievalResult(
                fact=fact,
                score=score,
                source="temporal"
            ))

        return results

    async def relation_search(
        self,
        user_id: UUID,
        entity: str,
        relation_type: Optional[str] = None,
        limit: int = 10,
    ) -> list[RetrievalResult]:
        """
        Search for facts through entity relationships (multi-hop).

        Args:
            user_id: The user's ID
            entity: The entity to find relations for
            relation_type: Optional filter by relation type
            limit: Maximum results

        Returns:
            List of RetrievalResult for related entities
        """
        # Find relations where entity is source or target
        query = select(EntityRelation).where(
            and_(
                EntityRelation.user_id == user_id,
                EntityRelation.is_current == True,
                or_(
                    EntityRelation.source_entity.ilike(f"%{entity}%"),
                    EntityRelation.target_entity.ilike(f"%{entity}%"),
                )
            )
        )

        if relation_type:
            query = query.where(EntityRelation.relation_type == relation_type)

        query = query.limit(limit)

        result = await self.db.execute(query)
        relations = result.scalars().all()

        # Get facts about related entities
        related_entities = set()
        for rel in relations:
            if entity.lower() in rel.source_entity.lower():
                related_entities.add(rel.target_entity)
            else:
                related_entities.add(rel.source_entity)

        if not related_entities:
            return []

        # Get facts about related entities
        return await self.entity_search(user_id, list(related_entities), limit)

    def _reciprocal_rank_fusion(
        self,
        result_lists: list[list[RetrievalResult]],
        weights: Optional[list[float]] = None,
        k: int = 60,
    ) -> list[RetrievalResult]:
        """
        Combine multiple result lists using Reciprocal Rank Fusion.

        Args:
            result_lists: List of result lists from different sources
            weights: Optional weights for each list
            k: RRF parameter (default 60)

        Returns:
            Merged and re-ranked results
        """
        if not result_lists:
            return []

        if weights is None:
            weights = [1.0] * len(result_lists)

        # Calculate RRF scores
        fact_scores: dict[UUID, float] = {}
        fact_objects: dict[UUID, MemoryFact] = {}
        fact_sources: dict[UUID, list[str]] = {}

        for i, results in enumerate(result_lists):
            weight = weights[i]
            for rank, result in enumerate(results, 1):
                fact_id = result.fact.id
                rrf_score = weight / (k + rank)

                if fact_id not in fact_scores:
                    fact_scores[fact_id] = 0
                    fact_objects[fact_id] = result.fact
                    fact_sources[fact_id] = []

                fact_scores[fact_id] += rrf_score
                if result.source not in fact_sources[fact_id]:
                    fact_sources[fact_id].append(result.source)

        # Sort by score and create results
        sorted_facts = sorted(fact_scores.items(), key=lambda x: x[1], reverse=True)

        merged_results = []
        for fact_id, score in sorted_facts:
            merged_results.append(RetrievalResult(
                fact=fact_objects[fact_id],
                score=score,
                source="+".join(fact_sources[fact_id])
            ))

        return merged_results

    async def search(
        self,
        user_id: UUID,
        query: str,
        reference_date: Optional[datetime] = None,
        limit: int = 20,
    ) -> list[RetrievalResult]:
        """
        Perform hybrid search combining multiple strategies.

        Args:
            user_id: The user's ID
            query: The search query
            reference_date: Reference date for temporal queries
            limit: Maximum results

        Returns:
            List of RetrievalResult, ranked by relevance
        """
        # Analyze the query
        analysis = await self.analyze_query(query, reference_date)

        # Collect results from different sources
        result_lists = []
        weights = []

        # Always do vector search
        vector_results = await self.vector_search(user_id, query, limit * 2)
        if vector_results:
            result_lists.append(vector_results)
            weights.append(config.vector_weight)

        # Entity search if entities detected
        if analysis.is_entity_query:
            entity_results = await self.entity_search(user_id, analysis.entities, limit)
            if entity_results:
                result_lists.append(entity_results)
                weights.append(config.entity_weight)

        # Temporal search if temporal references found
        if analysis.is_temporal_query and analysis.temporal_start and analysis.temporal_end:
            temporal_results = await self.temporal_search(
                user_id,
                analysis.temporal_start,
                analysis.temporal_end,
                limit
            )
            if temporal_results:
                result_lists.append(temporal_results)
                weights.append(config.temporal_weight)

        # Merge results using RRF
        merged = self._reciprocal_rank_fusion(result_lists, weights)

        return merged[:limit]

    async def search_with_confidence(
        self,
        user_id: UUID,
        query: str,
        reference_date: Optional[datetime] = None,
        limit: int = 20,
    ) -> tuple[list[RetrievalResult], float]:
        """
        Search with confidence scoring for abstention.

        Args:
            user_id: The user's ID
            query: The search query
            reference_date: Reference date
            limit: Maximum results

        Returns:
            Tuple of (results, confidence_score)
        """
        results = await self.search(user_id, query, reference_date, limit)

        if not results:
            return results, 0.0

        # Calculate confidence based on:
        # 1. Top result score
        # 2. Score distribution
        # 3. Number of results

        top_score = results[0].score if results else 0
        avg_score = sum(r.score for r in results[:5]) / min(5, len(results))
        result_count_factor = min(1.0, len(results) / 5)

        confidence = (top_score * 0.5 + avg_score * 0.3 + result_count_factor * 0.2)

        return results, confidence
