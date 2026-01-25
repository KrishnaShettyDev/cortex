"""Advanced memory models: Temporal patterns and decision metrics."""

import uuid
from datetime import datetime, date
from sqlalchemy import String, Float, Text, Date, DateTime, ForeignKey, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from pgvector.sqlalchemy import Vector

from app.database import Base


class TemporalPattern(Base):
    """Detected temporal patterns in user behavior (e.g., 'tired on Mondays')."""

    __tablename__ = "cortex_temporal_patterns"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Pattern definition
    pattern_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )  # 'daily', 'weekly', 'monthly', 'seasonal', 'event_triggered'
    trigger: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )  # e.g., "Monday morning", "after meetings", "end of month"
    behavior: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )  # What happens: "You tend to feel tired"
    recommendation: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )  # AI suggestion: "Consider scheduling light tasks"

    # Pattern strength and evidence
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    occurrence_count: Mapped[int] = mapped_column(Integer, default=1)
    last_occurred: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    source_memory_ids: Mapped[list] = mapped_column(JSONB, default=list)

    # Embedding for semantic search
    embedding: Mapped[list[float] | None] = mapped_column(
        Vector(1536),
        nullable=True,
    )

    # User interaction
    notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    confirmed_by_user: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User")

    def __repr__(self) -> str:
        return f"<TemporalPattern '{self.trigger}' -> '{self.behavior[:30]}...'>"

    @property
    def is_strong(self) -> bool:
        """Check if this pattern has strong evidence."""
        return self.confidence >= 0.7 and self.occurrence_count >= 3


class DecisionMetrics(Base):
    """Aggregated metrics for decision-making accuracy by topic."""

    __tablename__ = "cortex_decision_metrics"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Topic/category
    topic: Mapped[str] = mapped_column(String(255), nullable=False)

    # Counts
    total_decisions: Mapped[int] = mapped_column(Integer, default=0)
    successful_decisions: Mapped[int] = mapped_column(Integer, default=0)
    failed_decisions: Mapped[int] = mapped_column(Integer, default=0)
    success_rate: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Confidence analysis
    avg_confidence_when_successful: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_confidence_when_failed: Mapped[float | None] = mapped_column(Float, nullable=True)

    # AI-extracted patterns
    common_success_factors: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    common_failure_factors: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    # Time period
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User")

    def __repr__(self) -> str:
        rate = f"{self.success_rate:.0%}" if self.success_rate else "N/A"
        return f"<DecisionMetrics topic='{self.topic}' success_rate={rate}>"

    def update_success_rate(self) -> None:
        """Recalculate success rate."""
        total_with_outcome = self.successful_decisions + self.failed_decisions
        if total_with_outcome > 0:
            self.success_rate = self.successful_decisions / total_with_outcome
        else:
            self.success_rate = None
