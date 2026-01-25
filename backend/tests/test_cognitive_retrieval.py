"""Tests for cognitive retrieval service.

These tests verify that the chat behavior actually changes based on
Phase 1 cognitive science features:
- FSRS retrievability
- Context reinstatement
- Emotional salience
- Autobiographical anchoring
"""
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services.cognitive_retrieval_service import CognitiveRetrievalService
from app.models import Memory
from app.models.context import MemoryContext
from app.models.emotion import EmotionalSignature


class TestCognitiveScoring:
    """Test the cognitive scoring calculations."""

    def test_retrievability_vivid_memory(self):
        """Recently reviewed memories should have high retrievability."""
        service = CognitiveRetrievalService(MagicMock())

        memory = MagicMock()
        memory.fsrs_stability = 30.0  # 30-day stability
        memory.fsrs_last_review = datetime.now(timezone.utc) - timedelta(days=1)
        memory.memory_date = datetime.now(timezone.utc)

        now = datetime.now(timezone.utc)
        retrievability = service._calculate_retrievability(memory, now)

        # Should be very high (close to 1.0) for recently reviewed
        assert retrievability > 0.9

    def test_retrievability_fading_memory(self):
        """Old unreviewed memories should have low retrievability."""
        service = CognitiveRetrievalService(MagicMock())

        memory = MagicMock()
        memory.fsrs_stability = 5.0  # Low stability
        memory.fsrs_last_review = datetime.now(timezone.utc) - timedelta(days=30)
        memory.memory_date = datetime.now(timezone.utc) - timedelta(days=60)

        now = datetime.now(timezone.utc)
        retrievability = service._calculate_retrievability(memory, now)

        # Should be lower for older, unstable memories
        assert retrievability < 0.5

    def test_context_match_same_time_of_day(self):
        """Memories from same time of day should score higher."""
        service = CognitiveRetrievalService(MagicMock())

        memory = MagicMock()
        memory_context = MagicMock()
        memory_context.time_of_day = "morning"
        memory_context.is_weekend = False
        memory_context.location_type = "office"
        memory_context.activity_category = "work"
        memory_context.social_setting = None

        current_context = {
            "time_of_day": "morning",
            "is_weekend": False,
            "location_type": "office",
        }

        match_score = service._calculate_context_match(memory, memory_context, current_context)

        # Should be high for matching contexts
        assert match_score >= 0.8

    def test_context_match_different_context(self):
        """Memories from different context should score lower."""
        service = CognitiveRetrievalService(MagicMock())

        memory = MagicMock()
        memory_context = MagicMock()
        memory_context.time_of_day = "night"
        memory_context.is_weekend = True
        memory_context.location_type = "home"
        memory_context.activity_category = "leisure"
        memory_context.social_setting = "social"

        current_context = {
            "time_of_day": "morning",
            "is_weekend": False,
            "location_type": "office",
        }

        match_score = service._calculate_context_match(memory, memory_context, current_context)

        # Should be low for mismatched contexts
        assert match_score < 0.5

    def test_emotional_salience_high_arousal(self):
        """High arousal memories should have high emotional salience."""
        service = CognitiveRetrievalService(MagicMock())

        emotion = MagicMock()
        emotion.arousal = 0.9
        emotion.personal_significance = 0.8
        emotion.surprise = 0.7
        emotion.consequentiality = 0.6
        emotion.importance_score = None  # Let it calculate

        salience = service._calculate_emotional_salience(emotion)

        # Should be high for emotionally significant memories
        assert salience > 0.6

    def test_emotional_salience_low_arousal(self):
        """Low arousal, routine memories should have lower salience."""
        service = CognitiveRetrievalService(MagicMock())

        emotion = MagicMock()
        emotion.arousal = 0.2
        emotion.personal_significance = 0.3
        emotion.surprise = 0.1
        emotion.consequentiality = 0.1
        emotion.importance_score = None

        salience = service._calculate_emotional_salience(emotion)

        # Should be lower for routine memories
        assert salience < 0.4

    def test_emotion_label_mapping(self):
        """Test emotion labels are correctly mapped from circumplex."""
        service = CognitiveRetrievalService(MagicMock())

        # High valence, high arousal = excited
        emotion = MagicMock()
        emotion.valence = 0.8
        emotion.arousal = 0.8
        assert service._get_emotion_label(emotion) == "excited"

        # High valence, low arousal = content
        emotion.valence = 0.8
        emotion.arousal = 0.2
        assert service._get_emotion_label(emotion) == "content"

        # Low valence, high arousal = anxious
        emotion.valence = 0.2
        emotion.arousal = 0.8
        assert service._get_emotion_label(emotion) == "anxious"

        # Low valence, low arousal = sad
        emotion.valence = 0.2
        emotion.arousal = 0.2
        assert service._get_emotion_label(emotion) == "sad"


class TestCognitiveFormatting:
    """Test that memory formatting includes cognitive hints."""

    def test_format_includes_vivid_hint(self):
        """Vivid memories should be marked in output."""
        service = CognitiveRetrievalService(MagicMock())

        memory = MagicMock()
        memory.memory_date = datetime.now(timezone.utc)
        memory.memory_type = "note"
        memory.content = "This is a test memory"
        memory.source_id = None
        memory.summary = None

        scored_memories = [(memory, {
            "final_score": 0.9,
            "semantic": 0.8,
            "retrievability": 0.95,  # High retrievability = vivid
            "context_match": 0.5,
            "emotional_salience": 0.5,
            "life_period": None,
            "emotion_label": None,
        })]

        output = service.format_memories_with_cognitive_context(scored_memories)

        assert "(vivid memory)" in output

    def test_format_includes_fading_hint(self):
        """Fading memories should be marked in output."""
        service = CognitiveRetrievalService(MagicMock())

        memory = MagicMock()
        memory.memory_date = datetime.now(timezone.utc)
        memory.memory_type = "note"
        memory.content = "This is an old memory"
        memory.source_id = None
        memory.summary = None

        scored_memories = [(memory, {
            "final_score": 0.5,
            "semantic": 0.8,
            "retrievability": 0.2,  # Low retrievability = fading
            "context_match": 0.5,
            "emotional_salience": 0.5,
            "life_period": None,
            "emotion_label": None,
        })]

        output = service.format_memories_with_cognitive_context(scored_memories)

        assert "(fading memory)" in output

    def test_format_includes_emotion_label(self):
        """Emotional context should be included."""
        service = CognitiveRetrievalService(MagicMock())

        memory = MagicMock()
        memory.memory_date = datetime.now(timezone.utc)
        memory.memory_type = "note"
        memory.content = "I was so excited about this"
        memory.source_id = None
        memory.summary = None

        scored_memories = [(memory, {
            "final_score": 0.9,
            "semantic": 0.8,
            "retrievability": 0.7,
            "context_match": 0.5,
            "emotional_salience": 0.8,
            "life_period": None,
            "emotion_label": "excited",
        })]

        output = service.format_memories_with_cognitive_context(scored_memories)

        assert "(excited)" in output

    def test_format_includes_life_period(self):
        """Life period context should be included."""
        service = CognitiveRetrievalService(MagicMock())

        memory = MagicMock()
        memory.memory_date = datetime.now(timezone.utc)
        memory.memory_type = "note"
        memory.content = "Memory from college"
        memory.source_id = None
        memory.summary = None

        scored_memories = [(memory, {
            "final_score": 0.9,
            "semantic": 0.8,
            "retrievability": 0.7,
            "context_match": 0.5,
            "emotional_salience": 0.5,
            "life_period": "College Years",
            "emotion_label": None,
        })]

        output = service.format_memories_with_cognitive_context(scored_memories)

        assert "(from: College Years)" in output


class TestChatServiceIntegration:
    """Test that chat service uses cognitive retrieval."""

    def test_chat_service_has_cognitive_retrieval(self):
        """Chat service should have cognitive retrieval when db is provided."""
        from app.services.chat_service import ChatService
        from app.services.search_service import SearchService

        db_mock = MagicMock()
        search_service = MagicMock(spec=SearchService)

        chat_service = ChatService(search_service, db=db_mock)

        assert chat_service.cognitive_retrieval is not None

    def test_chat_service_no_cognitive_retrieval_without_db(self):
        """Chat service should fallback when no db."""
        from app.services.chat_service import ChatService
        from app.services.search_service import SearchService

        search_service = MagicMock(spec=SearchService)

        chat_service = ChatService(search_service, db=None)

        assert chat_service.cognitive_retrieval is None

    def test_get_current_context_returns_time_of_day(self):
        """Current context should include time of day."""
        from app.services.chat_service import ChatService
        from app.services.search_service import SearchService

        search_service = MagicMock(spec=SearchService)
        chat_service = ChatService(search_service, db=None)

        context = chat_service._get_current_context()

        assert "time_of_day" in context
        assert context["time_of_day"] in ["morning", "afternoon", "evening", "night"]
        assert "is_weekend" in context
        assert isinstance(context["is_weekend"], bool)

    def test_system_prompt_includes_cognitive_hints(self):
        """System prompt should explain cognitive hints."""
        from app.services.chat_service import ChatService

        assert "(vivid memory)" in ChatService.SYSTEM_PROMPT
        assert "(fading memory)" in ChatService.SYSTEM_PROMPT
        assert "excited/content/anxious/sad" in ChatService.SYSTEM_PROMPT


class TestBehavioralChange:
    """
    These tests document the specific behavioral changes enabled by Phase 1.

    Before: Chat retrieved memories by pure semantic similarity.
    After: Chat retrieves memories by cognitive principles:
    1. FSRS retrievability boosts memories user is likely to recall
    2. Context reinstatement boosts memories matching current context
    3. Emotional salience boosts personally significant memories
    4. LLM sees cognitive hints and responds appropriately
    """

    def test_behavior_change_retrievability(self):
        """
        BEHAVIORAL CHANGE: Recently reviewed memories are prioritized.

        Before: A memory from last year might rank equally with one from yesterday.
        After: Recently reviewed memories (high FSRS stability) rank higher.
        """
        service = CognitiveRetrievalService(MagicMock())

        # Recent memory with high retrievability
        recent_memory = MagicMock()
        recent_memory.fsrs_stability = 30.0
        recent_memory.fsrs_last_review = datetime.now(timezone.utc) - timedelta(days=1)
        recent_memory.memory_date = datetime.now(timezone.utc)

        # Old memory with low retrievability
        old_memory = MagicMock()
        old_memory.fsrs_stability = 5.0
        old_memory.fsrs_last_review = datetime.now(timezone.utc) - timedelta(days=60)
        old_memory.memory_date = datetime.now(timezone.utc) - timedelta(days=90)

        now = datetime.now(timezone.utc)
        recent_score = service._calculate_retrievability(recent_memory, now)
        old_score = service._calculate_retrievability(old_memory, now)

        # Recent memory should rank higher
        assert recent_score > old_score

    def test_behavior_change_context_reinstatement(self):
        """
        BEHAVIORAL CHANGE: Context-matched memories surface better.

        Before: Work memories appeared equally during work and leisure.
        After: Work memories surface better during work hours at the office.
        """
        service = CognitiveRetrievalService(MagicMock())

        memory = MagicMock()

        # Work memory context
        work_memory_ctx = MagicMock()
        work_memory_ctx.time_of_day = "morning"
        work_memory_ctx.is_weekend = False
        work_memory_ctx.location_type = "office"
        work_memory_ctx.activity_category = "work"
        work_memory_ctx.social_setting = None

        # Current context: at work
        work_context = {"time_of_day": "morning", "is_weekend": False, "location_type": "office"}

        # Current context: at home on weekend
        leisure_context = {"time_of_day": "evening", "is_weekend": True, "location_type": "home"}

        work_match = service._calculate_context_match(memory, work_memory_ctx, work_context)
        leisure_match = service._calculate_context_match(memory, work_memory_ctx, leisure_context)

        # Work memory should match better in work context
        assert work_match > leisure_match

    def test_behavior_change_emotional_salience(self):
        """
        BEHAVIORAL CHANGE: Emotionally significant memories rank higher.

        Before: All memories treated equally regardless of emotional weight.
        After: High-arousal, personally significant memories are prioritized.
        """
        service = CognitiveRetrievalService(MagicMock())

        # Emotional memory (e.g., wedding day)
        emotional = MagicMock()
        emotional.arousal = 0.9
        emotional.personal_significance = 0.95
        emotional.surprise = 0.8
        emotional.consequentiality = 0.9
        emotional.importance_score = None

        # Routine memory (e.g., regular meeting)
        routine = MagicMock()
        routine.arousal = 0.2
        routine.personal_significance = 0.2
        routine.surprise = 0.1
        routine.consequentiality = 0.1
        routine.importance_score = None

        emotional_salience = service._calculate_emotional_salience(emotional)
        routine_salience = service._calculate_emotional_salience(routine)

        # Emotional memory should rank higher
        assert emotional_salience > routine_salience

    def test_behavior_change_cognitive_hints_in_prompt(self):
        """
        BEHAVIORAL CHANGE: LLM sees cognitive context and adapts response.

        Before: LLM only saw raw memory content.
        After: LLM sees "(vivid memory)" and responds confidently,
               sees "(fading memory)" and gently reminds,
               sees "(anxious)" and responds sensitively.
        """
        service = CognitiveRetrievalService(MagicMock())

        # Vivid emotional memory
        memory = MagicMock()
        memory.memory_date = datetime.now(timezone.utc)
        memory.memory_type = "note"
        memory.content = "Had a difficult conversation with my boss about the project"
        memory.source_id = None
        memory.summary = None

        scored_memories = [(memory, {
            "final_score": 0.85,
            "semantic": 0.8,
            "retrievability": 0.92,  # Vivid
            "context_match": 0.7,
            "emotional_salience": 0.8,
            "life_period": "Current Job",
            "emotion_label": "anxious",
        })]

        output = service.format_memories_with_cognitive_context(scored_memories)

        # LLM should see all the cognitive context
        assert "(vivid memory)" in output
        assert "(anxious)" in output
        assert "(from: Current Job)" in output
        assert "difficult conversation" in output
