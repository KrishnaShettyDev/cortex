"""Service for extracting and searching decisions from memories."""

import logging
from uuid import UUID
from datetime import datetime, date
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from openai import AsyncOpenAI

from app.config import get_settings
from app.models.memory import Memory
from app.models.connection import Decision
from app.services.embedding_service import embedding_service

settings = get_settings()
logger = logging.getLogger(__name__)


class DecisionService:
    """Service for extracting and searching decisions from memories."""

    DECISION_EXTRACTION_PROMPT = """Analyze this text and extract any explicit decisions made by the user.

Text:
{content}

Extract decisions that are:
- Explicit choices or determinations made
- Commitments or resolutions
- Final conclusions on a topic

Do NOT extract:
- Plans or intentions ("I should...")
- Questions or considerations
- Information without a decision

Return a JSON array of decisions (empty array if none found):
[
    {{
        "topic": "brief topic (2-5 words)",
        "decision_text": "the actual decision made",
        "context": "brief context if available"
    }}
]

Return valid JSON only. Maximum 3 decisions per text."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    async def extract_decisions(self, memory: Memory) -> list[Decision]:
        """
        Extract decisions from a memory.
        Called when a memory is created.
        """
        if not memory.content or len(memory.content) < 20:
            return []

        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": self.DECISION_EXTRACTION_PROMPT.format(
                            content=memory.content[:1500]
                        ),
                    }
                ],
                temperature=0.2,
                max_tokens=500,
                response_format={"type": "json_object"},
            )

            import json
            result = json.loads(response.choices[0].message.content)

            # Handle both array and object with array
            if isinstance(result, dict):
                decisions_data = result.get("decisions", [])
            else:
                decisions_data = result

            if not decisions_data:
                return []

            decisions = []
            for dec_data in decisions_data[:3]:  # Max 3 decisions
                if not dec_data.get("decision_text"):
                    continue

                # Generate embedding for the decision
                embed_text = f"{dec_data.get('topic', '')} {dec_data.get('decision_text', '')}"
                embedding = await embedding_service.embed(embed_text)

                decision = Decision(
                    user_id=memory.user_id,
                    memory_id=memory.id,
                    topic=dec_data.get("topic", "General")[:255],
                    decision_text=dec_data.get("decision_text"),
                    context=dec_data.get("context"),
                    decision_date=memory.memory_date.date() if memory.memory_date else date.today(),
                    embedding=embedding,
                )
                self.db.add(decision)
                decisions.append(decision)

            if decisions:
                await self.db.commit()
                logger.info(f"Extracted {len(decisions)} decisions from memory {memory.id}")

            return decisions

        except Exception as e:
            logger.error(f"Error extracting decisions: {e}")
            return []

    async def search_decisions(
        self,
        user_id: UUID,
        query: str,
        topic: str | None = None,
        limit: int = 10,
    ) -> list[Decision]:
        """
        Search decisions by semantic similarity and optional topic filter.
        """
        # Generate query embedding
        query_embedding = await embedding_service.embed(query)

        # Build query
        base_query = (
            select(Decision)
            .where(Decision.user_id == user_id)
            .where(Decision.embedding.isnot(None))
        )

        if topic:
            base_query = base_query.where(
                func.lower(Decision.topic).contains(func.lower(topic))
            )

        # Order by cosine similarity
        base_query = base_query.order_by(
            Decision.embedding.cosine_distance(query_embedding)
        ).limit(limit)

        result = await self.db.execute(base_query)
        return list(result.scalars().all())

    async def get_decisions_by_topic(
        self,
        user_id: UUID,
        topic: str,
        limit: int = 10,
    ) -> list[Decision]:
        """Get decisions for a specific topic."""
        result = await self.db.execute(
            select(Decision)
            .where(Decision.user_id == user_id)
            .where(func.lower(Decision.topic).contains(func.lower(topic)))
            .order_by(Decision.decision_date.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_recent_decisions(
        self,
        user_id: UUID,
        limit: int = 10,
    ) -> list[Decision]:
        """Get most recent decisions."""
        result = await self.db.execute(
            select(Decision)
            .where(Decision.user_id == user_id)
            .order_by(Decision.decision_date.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_decision_with_memory(
        self, decision_id: UUID, user_id: UUID
    ) -> tuple[Decision, Memory] | None:
        """Get a decision with its source memory."""
        result = await self.db.execute(
            select(Decision)
            .where(Decision.id == decision_id)
            .where(Decision.user_id == user_id)
        )
        decision = result.scalar_one_or_none()
        if not decision:
            return None

        memory_result = await self.db.execute(
            select(Memory).where(Memory.id == decision.memory_id)
        )
        memory = memory_result.scalar_one_or_none()
        if not memory:
            return None

        return decision, memory
