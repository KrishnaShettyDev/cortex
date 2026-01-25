"""Pydantic schemas for advanced memory features."""

from datetime import date, datetime
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, Field


# ==================== DECISION OUTCOME SCHEMAS ====================

class DecisionOutcomeCreate(BaseModel):
    """Create a decision outcome."""
    outcome_status: str = Field(..., description="Status: successful, failed, abandoned, mixed")
    outcome_notes: Optional[str] = Field(None, max_length=1000)
    outcome_memory_id: Optional[UUID] = Field(None, description="Memory that recorded the outcome")
    confidence_in_hindsight: Optional[float] = Field(None, ge=0, le=1)


class DecisionOutcomeResponse(BaseModel):
    """Response with decision outcome details."""
    id: UUID
    topic: str
    decision_text: str
    context: Optional[str]
    decision_date: date
    outcome_status: Optional[str]
    outcome_date: Optional[datetime]
    outcome_notes: Optional[str]
    lessons_learned: Optional[str]
    confidence_at_decision: Optional[float]
    confidence_in_hindsight: Optional[float]

    class Config:
        from_attributes = True


class PendingDecision(BaseModel):
    """Decision pending outcome tracking."""
    id: UUID
    topic: str
    decision_text: str
    context: Optional[str]
    decision_date: date
    confidence_at_decision: Optional[float]
    days_since_decision: int

    class Config:
        from_attributes = True


class DecisionTopicMetrics(BaseModel):
    """Metrics for a specific decision topic."""
    topic: str
    decisions: int
    success_rate: Optional[float]
    avg_confidence_successful: Optional[float]
    avg_confidence_failed: Optional[float]


class DecisionInsights(BaseModel):
    """Aggregated decision insights."""
    total_decisions_tracked: int
    successful: int
    failed: int
    overall_success_rate: Optional[float]
    best_topics: list[tuple[str, float]]
    topics_needing_improvement: list[tuple[str, float]]
    topics: list[DecisionTopicMetrics]


# ==================== SPACED REPETITION SCHEMAS ====================

class SM2ReviewCreate(BaseModel):
    """Submit an SM2 spaced repetition review."""
    quality: int = Field(
        ...,
        ge=0,
        le=5,
        description="Quality of recall: 0=blackout, 5=perfect"
    )


class SM2ReviewResponse(BaseModel):
    """Response after SM2 review."""
    id: UUID
    easiness_factor: float
    interval_days: int
    repetitions: int
    next_review_date: Optional[date]
    strength: float

    class Config:
        from_attributes = True


class MemoryForReview(BaseModel):
    """Memory due for spaced repetition review."""
    id: UUID
    content: str
    summary: Optional[str]
    memory_type: str
    memory_date: datetime
    strength: float
    emotional_weight: float
    easiness_factor: float
    interval_days: int
    repetitions: int
    next_review_date: Optional[date]

    class Config:
        from_attributes = True


# ==================== MEMORY CONSOLIDATION SCHEMAS ====================

class ConsolidationGroup(BaseModel):
    """Group of memories that can be consolidated."""
    memory_ids: list[UUID]
    previews: list[str]
    count: int
    similarity_score: Optional[float]


class ConsolidationCandidates(BaseModel):
    """Response with consolidation candidates."""
    groups: list[ConsolidationGroup]
    total_groups: int


class ConsolidateRequest(BaseModel):
    """Request to consolidate memories."""
    memory_ids: list[UUID] = Field(..., min_length=3)


class ConsolidatedMemory(BaseModel):
    """Response with consolidated memory."""
    consolidated_memory_id: UUID
    content: str
    summary: Optional[str]
    source_count: int
    strength: float

    class Config:
        from_attributes = True


# ==================== TEMPORAL PATTERN SCHEMAS ====================

class TemporalPatternResponse(BaseModel):
    """Temporal pattern response."""
    id: UUID
    pattern_type: str
    trigger: str
    behavior: str
    recommendation: Optional[str]
    confidence: float
    occurrence_count: int
    confirmed_by_user: Optional[bool]
    last_occurred: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class PatternConfirmation(BaseModel):
    """Confirm or dismiss a pattern."""
    confirmed: bool


class RelevantPattern(BaseModel):
    """Pattern relevant to current context."""
    id: UUID
    trigger: str
    behavior: str
    recommendation: Optional[str]
    confidence: float


class DetectPatternsResponse(BaseModel):
    """Response from pattern detection."""
    patterns_detected: int
    patterns: list[RelevantPattern]


# ==================== LEARNING STATS SCHEMAS ====================

class MemoryLearningStats(BaseModel):
    """Statistics about memory learning."""
    total_memories: int
    memories_with_spaced_repetition: int
    memories_due_for_review: int
    consolidated_memories: int
    avg_strength: float
    avg_easiness_factor: float


class DecisionLearningStats(BaseModel):
    """Statistics about decision tracking."""
    total_decisions: int
    decisions_with_outcomes: int
    pending_decisions: int
    overall_success_rate: Optional[float]
    avg_confidence_successful: Optional[float]


class PatternStats(BaseModel):
    """Statistics about detected patterns."""
    total_patterns: int
    confirmed_patterns: int
    dismissed_patterns: int
    avg_confidence: float


class AdvancedLearningStats(BaseModel):
    """Combined learning statistics."""
    memories: MemoryLearningStats
    decisions: DecisionLearningStats
    patterns: PatternStats
