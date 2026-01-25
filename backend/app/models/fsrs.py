"""FSRS-6 Spaced Repetition Models.

FSRS (Free Spaced Repetition Scheduler) is a state-of-the-art algorithm
with 21 trainable parameters that outperforms SM-2 by ~26%.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Float, Integer, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class FSRSParameters(Base):
    """User-specific FSRS-6 parameters.

    FSRS-6 has 21 trainable parameters (w0-w20) that can be optimized
    based on the user's review history for personalized scheduling.
    """

    __tablename__ = "cortex_fsrs_parameters"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    parameters: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    review_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_optimized: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    optimization_rmse: Mapped[float | None] = mapped_column(Float, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    user: Mapped["User"] = relationship("User", back_populates="fsrs_parameters")

    __table_args__ = (
        Index("idx_fsrs_parameters_user", "user_id"),
        UniqueConstraint("user_id", name="uq_fsrs_parameters_user"),
    )

    @classmethod
    def default_parameters(cls) -> dict:
        """Return default FSRS-6 parameters.

        These are the officially optimized default parameters from the FSRS research.
        w0-w3: Initial stability for each rating (Again, Hard, Good, Easy)
        w4: Initial difficulty
        w5-w6: Difficulty update parameters
        w7-w8: Short-term stability after forgetting
        w9-w10: Medium-term stability parameters
        w11-w14: Long-term stability parameters
        w15-w16: Difficulty adjustment
        w17-w18: Short-term stabilization
        w19: Hard penalty
        w20: Easy bonus (decay parameter)
        """
        return {
            "w0": 0.40255,   # Initial stability for Again
            "w1": 1.18385,   # Initial stability for Hard
            "w2": 3.17300,   # Initial stability for Good
            "w3": 15.69105,  # Initial stability for Easy
            "w4": 7.08060,   # Initial difficulty
            "w5": 0.57315,   # Difficulty update multiplier
            "w6": 1.10980,   # Difficulty update addition
            "w7": 0.00340,   # Short-term stability after forgetting
            "w8": 1.38750,   # Short-term stability multiplier
            "w9": 0.22355,   # Medium-term stability
            "w10": 1.03635,  # Medium-term stability addition
            "w11": 2.03800,  # Long-term stability factor
            "w12": 0.02305,  # Long-term stability multiplier
            "w13": 0.34500,  # Long-term stability exponent
            "w14": 1.13680,  # Long-term stability addition
            "w15": 0.22150,  # Difficulty adjustment factor
            "w16": 2.93810,  # Difficulty adjustment exponent
            "w17": 0.51000,  # Short-term stabilization
            "w18": 0.02365,  # Short-term stabilization multiplier
            "w19": 0.24000,  # Hard penalty
            "w20": 0.50000,  # Decay parameter (power law)
            "request_retention": 0.9,  # Target retention rate
            "maximum_interval": 36500,  # Max interval in days (100 years)
        }


class ReviewLog(Base):
    """Individual review log for FSRS parameter training.

    Each review is logged with before/after states to enable
    parameter optimization based on actual review performance.
    """

    __tablename__ = "cortex_review_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    memory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_memories.id", ondelete="CASCADE"),
        nullable=False,
    )

    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(20), nullable=False)

    scheduled_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    elapsed_days: Mapped[float | None] = mapped_column(Float, nullable=True)

    stability_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    stability_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    difficulty_after: Mapped[float | None] = mapped_column(Float, nullable=True)

    retrievability: Mapped[float | None] = mapped_column(Float, nullable=True)
    review_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    review_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    user: Mapped["User"] = relationship("User", back_populates="review_logs")
    memory: Mapped["Memory"] = relationship("Memory", back_populates="review_logs")

    __table_args__ = (
        Index("idx_review_logs_user", "user_id"),
        Index("idx_review_logs_memory", "memory_id"),
        Index("idx_review_logs_time", "user_id", "review_time"),
    )

    def __repr__(self) -> str:
        return f"<ReviewLog {self.id} memory={self.memory_id} rating={self.rating}>"
