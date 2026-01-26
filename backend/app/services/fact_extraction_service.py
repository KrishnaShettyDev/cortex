"""
Fact Extraction Service

Extracts atomic facts from memories for better retrieval and reasoning.
This is a core component for achieving SOTA performance on MemoryBench.

Example:
    Input: "Had coffee with Sarah yesterday. She mentioned she got promoted to VP at Google."
    Output:
        - Fact: "Sarah got promoted to VP" (subject=Sarah, relation=promoted_to, object=VP)
        - Fact: "Sarah works at Google" (subject=Sarah, relation=works_at, object=Google)
        - Fact: "User had coffee with Sarah" (subject=User, relation=met, object=Sarah)
"""

import json
import logging
from datetime import datetime, timedelta
from uuid import UUID
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from openai import AsyncOpenAI

from app.config import get_settings
from app.memory_config import get_memory_config
from app.models.memory_fact import MemoryFact, EntityRelation
from app.services.embedding_service import embedding_service

settings = get_settings()
config = get_memory_config()
logger = logging.getLogger(__name__)


# Fact types for classification
FACT_TYPES = [
    "person",       # Facts about people (name, job, relationship)
    "event",        # Things that happened (meetings, trips, activities)
    "preference",   # User preferences (likes, dislikes, favorites)
    "plan",         # Future intentions (appointments, goals, todos)
    "location",     # Places (home, work, visited places)
    "temporal",     # Time-based facts (birthdays, anniversaries)
    "relationship", # Relationships between people
    "work",         # Professional info (job, company, projects)
    "health",       # Health-related info
    "other",        # Catch-all
]


EXTRACTION_PROMPT = '''Extract discrete facts from this memory. For each fact:

1. **fact_text**: The core assertion in a complete sentence
2. **fact_type**: One of: person, event, preference, plan, location, temporal, relationship, work, health, other
3. **subject_entity**: The main entity (person/thing) the fact is about
4. **object_entity**: The secondary entity (if any)
5. **relation**: The relationship type (e.g., works_at, likes, visited, met)
6. **temporal_expression**: Any time reference in the original text (e.g., "yesterday", "last week")
7. **event_date**: The actual date/time the event happened (ISO format), if determinable
8. **confidence**: How confident you are (0.0-1.0)

Rules:
- Extract ATOMIC facts (one assertion per fact)
- Resolve pronouns to actual names when possible
- "User" refers to the person whose memory this is
- For relative dates, calculate from the document_date provided
- Only extract facts with confidence >= 0.5

Memory content:
{content}

Document date (when this was recorded): {document_date}

Return a JSON array of facts. Example:
[
  {{
    "fact_text": "Sarah got promoted to VP",
    "fact_type": "work",
    "subject_entity": "Sarah",
    "object_entity": "VP",
    "relation": "promoted_to",
    "temporal_expression": null,
    "event_date": null,
    "confidence": 0.95
  }},
  {{
    "fact_text": "User met Sarah for coffee",
    "fact_type": "event",
    "subject_entity": "User",
    "object_entity": "Sarah",
    "relation": "met",
    "temporal_expression": "yesterday",
    "event_date": "{yesterday_date}",
    "confidence": 0.9
  }}
]

Return ONLY the JSON array, no other text.'''


class FactExtractionService:
    """Service for extracting atomic facts from memories."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def extract_facts_from_memory(
        self,
        user_id: UUID,
        memory_id: UUID,
        content: str,
        document_date: datetime,
    ) -> list[MemoryFact]:
        """
        Extract atomic facts from a memory.

        Args:
            user_id: The user's ID
            memory_id: The source memory ID
            content: The memory content
            document_date: When the memory was created

        Returns:
            List of extracted MemoryFact objects
        """
        if not content or len(content.strip()) < 10:
            return []

        try:
            # Calculate reference dates for the prompt
            yesterday = (document_date - timedelta(days=1)).strftime("%Y-%m-%d")

            prompt = EXTRACTION_PROMPT.format(
                content=content,
                document_date=document_date.strftime("%Y-%m-%d %H:%M:%S"),
                yesterday_date=yesterday,
            )

            response = await self.client.chat.completions.create(
                model=config.extraction_model,
                messages=[
                    {"role": "system", "content": "You are a precise fact extractor. Extract atomic facts from text."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_tokens=2000,
            )

            # Parse the response
            response_content = response.choices[0].message.content
            if not response_content:
                logger.warning("Empty response from OpenAI API for fact extraction")
                return []

            response_text = response_content.strip()
            if not response_text:
                logger.warning("Empty response text from fact extraction")
                return []

            # Handle potential markdown code blocks
            if response_text.startswith("```"):
                response_text = response_text.split("```")[1]
                if response_text.startswith("json"):
                    response_text = response_text[4:]

            # Handle case where response is just "[]" or empty after processing
            response_text = response_text.strip()
            if not response_text or response_text == "[]":
                return []

            facts_data = json.loads(response_text)

            if not isinstance(facts_data, list):
                logger.warning(f"Expected list of facts, got {type(facts_data)}")
                return []

            # Create MemoryFact objects
            facts = []
            for fact_data in facts_data[:config.max_facts_per_memory]:
                # Skip low confidence facts
                confidence = fact_data.get("confidence", 1.0)
                if confidence < config.min_fact_confidence:
                    continue

                # Parse event_date if provided
                event_date = None
                if fact_data.get("event_date"):
                    try:
                        event_date = datetime.fromisoformat(fact_data["event_date"].replace("Z", "+00:00"))
                    except (ValueError, AttributeError):
                        pass

                fact = MemoryFact(
                    memory_id=memory_id,
                    user_id=user_id,
                    fact_text=fact_data.get("fact_text", ""),
                    fact_type=fact_data.get("fact_type", "other"),
                    confidence=confidence,
                    subject_entity=fact_data.get("subject_entity"),
                    object_entity=fact_data.get("object_entity"),
                    relation=fact_data.get("relation"),
                    document_date=document_date,
                    event_date=event_date,
                    temporal_expression=fact_data.get("temporal_expression"),
                    is_current=True,
                )

                facts.append(fact)

            return facts

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse fact extraction response: {e}")
            return []
        except Exception as e:
            logger.error(f"Error extracting facts: {e}")
            return []

    async def save_facts(self, facts: list[MemoryFact]) -> list[MemoryFact]:
        """
        Save extracted facts to the database.

        Args:
            facts: List of MemoryFact objects to save

        Returns:
            List of saved facts with IDs
        """
        if not facts:
            return []

        saved_facts = []
        for fact in facts:
            # Generate embedding for the fact
            try:
                embedding = await embedding_service.embed(fact.fact_text)
                fact.embedding = embedding
            except Exception as e:
                logger.warning(f"Failed to generate embedding for fact: {e}")

            self.db.add(fact)
            saved_facts.append(fact)

        await self.db.commit()

        # Refresh to get IDs
        for fact in saved_facts:
            await self.db.refresh(fact)

        return saved_facts

    async def extract_and_save(
        self,
        user_id: UUID,
        memory_id: UUID,
        content: str,
        document_date: datetime,
    ) -> list[MemoryFact]:
        """
        Extract facts from a memory and save them.

        Args:
            user_id: The user's ID
            memory_id: The source memory ID
            content: The memory content
            document_date: When the memory was created

        Returns:
            List of saved MemoryFact objects
        """
        facts = await self.extract_facts_from_memory(
            user_id=user_id,
            memory_id=memory_id,
            content=content,
            document_date=document_date,
        )

        if facts:
            facts = await self.save_facts(facts)
            # Extract entity relations
            await self.extract_entity_relations(user_id, facts)

        return facts

    async def extract_entity_relations(
        self,
        user_id: UUID,
        facts: list[MemoryFact],
    ) -> list[EntityRelation]:
        """
        Extract entity relationships from facts.

        Args:
            user_id: The user's ID
            facts: List of facts to extract relations from

        Returns:
            List of EntityRelation objects
        """
        relations = []

        for fact in facts:
            if fact.subject_entity and fact.object_entity and fact.relation:
                relation = EntityRelation(
                    user_id=user_id,
                    source_entity=fact.subject_entity,
                    relation_type=fact.relation,
                    target_entity=fact.object_entity,
                    source_fact_id=fact.id,
                    confidence=fact.confidence,
                    is_current=True,
                )
                self.db.add(relation)
                relations.append(relation)

        if relations:
            await self.db.commit()

        return relations

    async def get_facts_for_entity(
        self,
        user_id: UUID,
        entity_name: str,
        include_superseded: bool = False,
    ) -> list[MemoryFact]:
        """
        Get all facts about a specific entity.

        Args:
            user_id: The user's ID
            entity_name: The entity to search for
            include_superseded: Whether to include superseded facts

        Returns:
            List of MemoryFact objects
        """
        query = select(MemoryFact).where(
            MemoryFact.user_id == user_id,
            (MemoryFact.subject_entity.ilike(f"%{entity_name}%")) |
            (MemoryFact.object_entity.ilike(f"%{entity_name}%"))
        )

        if not include_superseded:
            query = query.where(MemoryFact.is_current == True)

        query = query.order_by(MemoryFact.document_date.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_facts_by_type(
        self,
        user_id: UUID,
        fact_type: str,
        limit: int = 20,
    ) -> list[MemoryFact]:
        """
        Get facts of a specific type.

        Args:
            user_id: The user's ID
            fact_type: The type of facts to retrieve
            limit: Maximum number of facts

        Returns:
            List of MemoryFact objects
        """
        query = select(MemoryFact).where(
            MemoryFact.user_id == user_id,
            MemoryFact.fact_type == fact_type,
            MemoryFact.is_current == True,
        ).order_by(MemoryFact.document_date.desc()).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_temporal_facts(
        self,
        user_id: UUID,
        start_date: datetime,
        end_date: datetime,
    ) -> list[MemoryFact]:
        """
        Get facts that occurred within a time range.

        Args:
            user_id: The user's ID
            start_date: Start of the time range
            end_date: End of the time range

        Returns:
            List of MemoryFact objects
        """
        query = select(MemoryFact).where(
            MemoryFact.user_id == user_id,
            MemoryFact.is_current == True,
            MemoryFact.event_date >= start_date,
            MemoryFact.event_date <= end_date,
        ).order_by(MemoryFact.event_date.asc())

        result = await self.db.execute(query)
        return list(result.scalars().all())
