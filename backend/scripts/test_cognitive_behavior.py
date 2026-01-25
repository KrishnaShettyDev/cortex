#!/usr/bin/env python3
"""
Test script to demonstrate cognitive retrieval behavioral changes.

Run: python3 scripts/test_cognitive_behavior.py

This shows how the chat behavior changes based on Phase 1 features.
"""
import asyncio
import sys
sys.path.insert(0, '.')

from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, AsyncMock
from uuid import uuid4

from app.services.cognitive_retrieval_service import CognitiveRetrievalService


def create_mock_memory(content: str, days_old: int, fsrs_stability: float = 10.0, last_reviewed_days: int = 7):
    """Create a mock memory with FSRS data."""
    memory = MagicMock()
    memory.id = uuid4()
    memory.content = content
    memory.memory_type = "note"
    memory.memory_date = datetime.now(timezone.utc) - timedelta(days=days_old)
    memory.fsrs_stability = fsrs_stability
    memory.fsrs_last_review = datetime.now(timezone.utc) - timedelta(days=last_reviewed_days)
    memory.source_id = None
    memory.summary = None
    memory.embedding = [0.1] * 1536  # Mock embedding
    memory.life_period_id = None
    memory.general_event_id = None
    return memory


def demo_retrievability_change():
    """
    DEMO 1: Retrievability affects ranking

    Before: Old and new memories ranked equally by pure similarity.
    After: Recently reviewed memories rank higher due to FSRS retrievability.
    """
    print("\n" + "="*60)
    print("DEMO 1: FSRS Retrievability Changes Ranking")
    print("="*60)

    service = CognitiveRetrievalService(MagicMock())
    now = datetime.now(timezone.utc)

    # Memory A: Recently reviewed, high stability (vivid)
    memory_a = create_mock_memory(
        "Important meeting with Sarah about the product launch",
        days_old=30,
        fsrs_stability=30.0,
        last_reviewed_days=1
    )

    # Memory B: Not reviewed recently, low stability (fading)
    memory_b = create_mock_memory(
        "Meeting notes from last month's sprint planning",
        days_old=30,
        fsrs_stability=5.0,
        last_reviewed_days=45
    )

    retrievability_a = service._calculate_retrievability(memory_a, now)
    retrievability_b = service._calculate_retrievability(memory_b, now)

    print(f"\nMemory A (recently reviewed): {memory_a.content[:50]}...")
    print(f"  Retrievability: {retrievability_a:.3f} {'(vivid)' if retrievability_a > 0.8 else ''}")

    print(f"\nMemory B (not reviewed): {memory_b.content[:50]}...")
    print(f"  Retrievability: {retrievability_b:.3f} {'(fading)' if retrievability_b < 0.3 else ''}")

    print(f"\n→ BEHAVIORAL CHANGE: Memory A ranks {retrievability_a/retrievability_b:.1f}x higher")
    print("  User sees vivid memories first, fading memories deprioritized.")


def demo_context_reinstatement():
    """
    DEMO 2: Context reinstatement affects ranking

    Before: Work memories surfaced equally at work and at home.
    After: Work memories surface better during work hours at the office.
    """
    print("\n" + "="*60)
    print("DEMO 2: Context Reinstatement (Encoding Specificity)")
    print("="*60)

    service = CognitiveRetrievalService(MagicMock())

    # Work memory captured at the office on a weekday morning
    work_context = MagicMock()
    work_context.time_of_day = "morning"
    work_context.is_weekend = False
    work_context.location_type = "office"
    work_context.activity_category = "work"
    work_context.social_setting = None

    # Current context: at work
    at_work = {
        "time_of_day": "morning",
        "is_weekend": False,
        "location_type": "office",
    }

    # Current context: at home on weekend
    at_home = {
        "time_of_day": "evening",
        "is_weekend": True,
        "location_type": "home",
    }

    memory = MagicMock()

    work_match = service._calculate_context_match(memory, work_context, at_work)
    home_match = service._calculate_context_match(memory, work_context, at_home)

    print(f"\nWork memory encoded: morning, weekday, office")
    print(f"\nRetrieving at work (morning, weekday, office):")
    print(f"  Context match: {work_match:.3f}")

    print(f"\nRetrieving at home (evening, weekend, home):")
    print(f"  Context match: {home_match:.3f}")

    ratio = work_match / home_match if home_match > 0 else float('inf')
    print(f"\n→ BEHAVIORAL CHANGE: Work memory is {ratio:.1f}x more likely")
    print("  to surface when you're at work than when you're at home.")


def demo_emotional_salience():
    """
    DEMO 3: Emotional salience affects ranking

    Before: Routine and emotional memories treated equally.
    After: High-arousal, significant memories are prioritized.
    """
    print("\n" + "="*60)
    print("DEMO 3: Emotional Salience (Flashbulb Memory Effect)")
    print("="*60)

    service = CognitiveRetrievalService(MagicMock())

    # Emotionally significant memory (wedding day)
    emotional = MagicMock()
    emotional.arousal = 0.9
    emotional.personal_significance = 0.95
    emotional.surprise = 0.7
    emotional.consequentiality = 0.9
    emotional.importance_score = None

    # Routine memory (regular standup meeting)
    routine = MagicMock()
    routine.arousal = 0.2
    routine.personal_significance = 0.2
    routine.surprise = 0.1
    routine.consequentiality = 0.1
    routine.importance_score = None

    emotional_score = service._calculate_emotional_salience(emotional)
    routine_score = service._calculate_emotional_salience(routine)

    print(f"\nEmotional memory (high arousal, high significance):")
    print(f"  Salience: {emotional_score:.3f}")

    print(f"\nRoutine memory (low arousal, low significance):")
    print(f"  Salience: {routine_score:.3f}")

    print(f"\n→ BEHAVIORAL CHANGE: Emotional memory is {emotional_score/routine_score:.1f}x")
    print("  more likely to surface. Important moments remembered better.")


def demo_cognitive_hints():
    """
    DEMO 4: LLM sees cognitive hints

    Before: LLM only saw raw memory content.
    After: LLM sees contextual hints and adapts its response.
    """
    print("\n" + "="*60)
    print("DEMO 4: Cognitive Hints in LLM Context")
    print("="*60)

    service = CognitiveRetrievalService(MagicMock())

    memory = MagicMock()
    memory.memory_date = datetime.now(timezone.utc)
    memory.memory_type = "note"
    memory.content = "Had a tense conversation with my manager about the deadline. Feeling stressed about the project timeline."
    memory.source_id = None
    memory.summary = None

    scored_memories = [(memory, {
        "final_score": 0.85,
        "semantic": 0.8,
        "retrievability": 0.92,
        "context_match": 0.7,
        "emotional_salience": 0.8,
        "life_period": "Current Job",
        "emotion_label": "anxious",
    })]

    output = service.format_memories_with_cognitive_context(scored_memories)

    print("\nBEFORE (basic formatting):")
    print("-" * 40)
    print(f"Memory 1 (note, {memory.memory_date.strftime('%Y-%m-%d %H:%M')}):")
    print(memory.content)

    print("\nAFTER (cognitive formatting):")
    print("-" * 40)
    print(output)

    print("\n→ BEHAVIORAL CHANGE: LLM now sees:")
    print("  - (vivid memory) → responds with confidence")
    print("  - (anxious) → responds with sensitivity")
    print("  - (from: Current Job) → understands life context")


def main():
    print("\n" + "#"*60)
    print("# COGNITIVE RETRIEVAL BEHAVIORAL CHANGES")
    print("# Phase 1 features now affect chat behavior")
    print("#"*60)

    demo_retrievability_change()
    demo_context_reinstatement()
    demo_emotional_salience()
    demo_cognitive_hints()

    print("\n" + "="*60)
    print("SUMMARY: How Chat Behavior Changes")
    print("="*60)
    print("""
1. FSRS Retrievability: Recently reviewed memories surface first.
   User's vivid memories are prioritized over fading ones.

2. Context Reinstatement: Memories match current context.
   Work memories at work, home memories at home.

3. Emotional Salience: Important moments remembered better.
   High-arousal, significant events rank higher.

4. Cognitive Hints: LLM adapts its response style.
   Confident for vivid, gentle for fading, sensitive for emotional.
""")


if __name__ == "__main__":
    main()
