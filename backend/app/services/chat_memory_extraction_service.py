"""
Chat Memory Extraction Service

Automatically extracts and saves memories from chat conversations.
Every meaningful conversation should feed into the user's memory.

Key features:
- Extracts facts, preferences, commitments, and events from chat
- Runs asynchronously after chat response (doesn't slow down UX)
- Deduplicates against existing memories
- Uses fact extraction for atomic, searchable memories
"""

import json
import logging
import asyncio
from datetime import datetime
from uuid import UUID
from typing import Optional

from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.memory import Memory
from app.services.memory_service import MemoryService
from app.services.fact_extraction_service import FactExtractionService
from app.services.search_service import SearchService

settings = get_settings()
logger = logging.getLogger(__name__)


MEMORY_EXTRACTION_PROMPT = """Analyze this chat conversation and extract any information worth remembering about the user.

CONVERSATION:
{conversation}

Extract memories that would be valuable for a personal AI assistant to remember. Focus on:
1. **Personal facts**: Name, relationships, job, preferences, habits
2. **Events**: Past events mentioned, future plans, appointments
3. **Commitments**: Things the user said they would do or need to do
4. **Preferences**: Likes, dislikes, how they want things done
5. **Context**: Information that would help personalize future interactions

IMPORTANT:
- Only extract information the USER shared, not what the assistant said
- Skip generic chat (greetings, thanks, etc.)
- Be specific and include dates/names when mentioned
- Each memory should be self-contained and understandable alone

Return a JSON array of memories to save. Each memory should have:
- content: The memory text (1-3 sentences, written as a fact about the user)
- memory_type: One of "personal_fact", "event", "commitment", "preference", "context"
- importance: 1-10 (10 = critical info like job/family, 1 = minor detail)

Return ONLY valid JSON. Return empty array [] if nothing worth remembering.

Example output:
[
  {"content": "User works as a software engineer at Google.", "memory_type": "personal_fact", "importance": 9},
  {"content": "User has a meeting with Sarah on Friday at 2pm to discuss the Q2 budget.", "memory_type": "event", "importance": 7},
  {"content": "User prefers morning meetings before 10am.", "memory_type": "preference", "importance": 5}
]
"""


class ChatMemoryExtractionService:
    """
    Extracts and saves memories from chat conversations automatically.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.openai = AsyncOpenAI(api_key=settings.openai_api_key)
        self.memory_service = MemoryService(db)
        self.search_service = SearchService(db)

    async def extract_and_save_memories(
        self,
        user_id: UUID,
        conversation: list[dict],
        min_importance: int = 3,
    ) -> list[Memory]:
        """
        Extract memories from a conversation and save them.

        Args:
            user_id: The user's ID
            conversation: List of message dicts with 'role' and 'content'
            min_importance: Minimum importance score to save (1-10)

        Returns:
            List of created Memory objects
        """
        # Filter to only user messages and recent assistant context
        formatted_conv = self._format_conversation(conversation)

        if not formatted_conv or len(formatted_conv) < 50:
            # Skip very short conversations
            return []

        try:
            # Extract memories using GPT
            memories_to_save = await self._extract_memories(formatted_conv)

            if not memories_to_save:
                return []

            # Filter by importance and deduplicate
            memories_to_save = [
                m for m in memories_to_save
                if m.get("importance", 0) >= min_importance
            ]

            created_memories = []
            for memory_data in memories_to_save:
                # Check for duplicates
                if await self._is_duplicate(user_id, memory_data["content"]):
                    logger.debug(f"Skipping duplicate memory: {memory_data['content'][:50]}...")
                    continue

                # Create the memory
                memory, _ = await self.memory_service.create_memory(
                    user_id=user_id,
                    content=memory_data["content"],
                    memory_type=f"chat_{memory_data.get('memory_type', 'context')}",
                    memory_date=datetime.utcnow(),
                    source_id=f"chat_extraction_{datetime.utcnow().isoformat()}",
                )
                created_memories.append(memory)

                logger.info(
                    f"Created memory from chat: {memory_data['content'][:50]}... "
                    f"(importance: {memory_data.get('importance', 'N/A')})"
                )

            # Trigger fact extraction for the new memories (runs in background)
            if created_memories:
                asyncio.create_task(
                    self._extract_facts_for_memories(user_id, created_memories)
                )

            return created_memories

        except Exception as e:
            logger.error(f"Failed to extract memories from chat: {e}")
            return []

    def _format_conversation(self, conversation: list[dict]) -> str:
        """Format conversation for the extraction prompt."""
        lines = []
        for msg in conversation:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            if role == "user":
                lines.append(f"User: {content}")
            elif role == "assistant":
                lines.append(f"Assistant: {content}")
        return "\n".join(lines)

    async def _extract_memories(self, conversation: str) -> list[dict]:
        """Use GPT to extract memories from conversation."""
        try:
            response = await self.openai.chat.completions.create(
                model="gpt-4o-mini",  # Fast and cheap for extraction
                messages=[
                    {
                        "role": "system",
                        "content": "You extract important information from conversations to help a personal AI assistant remember details about the user. Return only valid JSON."
                    },
                    {
                        "role": "user",
                        "content": MEMORY_EXTRACTION_PROMPT.format(conversation=conversation)
                    }
                ],
                temperature=0.3,
                max_tokens=1000,
                response_format={"type": "json_object"},
            )

            result = response.choices[0].message.content

            # Parse JSON response
            parsed = json.loads(result)

            # Handle both array and object with array inside
            if isinstance(parsed, list):
                return parsed
            elif isinstance(parsed, dict):
                return parsed.get("memories", [])

            return []

        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse memory extraction response: {e}")
            return []
        except Exception as e:
            logger.error(f"Memory extraction API call failed: {e}")
            return []

    async def _is_duplicate(self, user_id: UUID, content: str) -> bool:
        """Check if a similar memory already exists."""
        try:
            # Search for similar memories
            existing = await self.search_service.search(
                user_id=user_id,
                query=content,
                limit=3,
            )

            # Check similarity (simple approach - could use embeddings for better matching)
            for memory in existing:
                if self._text_similarity(content, memory.content) > 0.8:
                    return True

            return False

        except Exception as e:
            logger.warning(f"Duplicate check failed: {e}")
            return False

    def _text_similarity(self, text1: str, text2: str) -> float:
        """Simple word overlap similarity."""
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())

        if not words1 or not words2:
            return 0.0

        intersection = len(words1 & words2)
        union = len(words1 | words2)

        return intersection / union if union > 0 else 0.0

    async def _extract_facts_for_memories(
        self,
        user_id: UUID,
        memories: list[Memory]
    ) -> None:
        """Extract atomic facts from new memories (runs in background)."""
        try:
            fact_service = FactExtractionService(self.db)

            for memory in memories:
                await fact_service.extract_and_save(
                    user_id=user_id,
                    memory_id=memory.id,
                    content=memory.content,
                    document_date=memory.memory_date,
                )

        except Exception as e:
            logger.error(f"Background fact extraction failed: {e}")


# Convenience function for use in chat service
async def extract_memories_from_chat(
    db: AsyncSession,
    user_id: UUID,
    conversation: list[dict],
) -> list[Memory]:
    """
    Convenience function to extract and save memories from a chat.

    Usage in chat_service.py:
        asyncio.create_task(
            extract_memories_from_chat(db, user_id, conversation_history)
        )
    """
    service = ChatMemoryExtractionService(db)
    return await service.extract_and_save_memories(user_id, conversation)
