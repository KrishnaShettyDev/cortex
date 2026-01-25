"""Emotional Signature Model.

Implements Russell's 3D Circumplex Model (Valence × Arousal × Dominance)
extended with personal meaning factors for comprehensive emotional tagging.
"""
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Float, Integer, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.database import Base


class EmotionalSignature(Base):
    """3D Emotional signature for a memory.

    Based on Russell's Circumplex Model extended with:
    - Dominance dimension (PAD model)
    - Personal significance factors
    - Flashbulb memory indicators
    - Goal relevance
    """

    __tablename__ = "cortex_emotional_signatures"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    memory_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cortex_memories.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Russell's Circumplex (3D) - PAD Model
    valence: Mapped[float] = mapped_column(Float, nullable=False)  # Pleasure (-1 to 1)
    arousal: Mapped[float] = mapped_column(Float, nullable=False)  # Activation (-1 to 1)
    dominance: Mapped[float] = mapped_column(Float, nullable=False)  # Control (-1 to 1)

    # Personal meaning factors
    personal_significance: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    identity_relevance: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Flashbulb memory indicators
    surprise: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    consequentiality: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Goal connections
    related_goals: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Detected emotions
    primary_emotion: Mapped[str | None] = mapped_column(String(50), nullable=True)
    secondary_emotions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Computed importance
    importance_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)

    # Analysis metadata
    analyzed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )
    analysis_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relationships
    memory: Mapped["Memory"] = relationship("Memory", back_populates="emotional_signature")

    __table_args__ = (
        Index("idx_emotional_memory", "memory_id"),
        Index("idx_emotional_importance", "importance_score"),
        Index("idx_emotional_valence_arousal", "valence", "arousal"),
        UniqueConstraint("memory_id", name="uq_emotional_signature_memory"),
    )

    def __repr__(self) -> str:
        return f"<EmotionalSignature V={self.valence:.2f} A={self.arousal:.2f} D={self.dominance:.2f}>"

    def calculate_importance(self) -> float:
        """Calculate importance score from emotional factors.

        Formula weights:
        - arousal: 25% (high activation = more memorable)
        - personal_significance: 30% (self-relevance)
        - surprise: 20% (unexpected events)
        - consequentiality: 25% (life impact)
        """
        arousal_normalized = (self.arousal + 1) / 2  # Convert -1,1 to 0,1

        score = (
            arousal_normalized * 0.25
            + self.personal_significance * 0.30
            + self.surprise * 0.20
            + self.consequentiality * 0.25
        )
        return min(1.0, max(0.0, score))

    def update_importance(self) -> None:
        """Update the importance_score field."""
        self.importance_score = self.calculate_importance()

    @classmethod
    def emotion_to_pad(cls, emotion: str) -> tuple[float, float, float]:
        """Map emotion name to PAD (Pleasure-Arousal-Dominance) coordinates.

        Based on research by Mehrabian & Russell (1974) and subsequent studies.
        Values are approximate and represent typical emotional states.
        """
        emotion_map = {
            # High valence, high arousal
            "joy": (0.8, 0.5, 0.6),
            "excitement": (0.7, 0.8, 0.5),
            "enthusiasm": (0.6, 0.7, 0.6),
            "elation": (0.9, 0.7, 0.7),

            # High valence, low arousal
            "contentment": (0.6, -0.2, 0.4),
            "serenity": (0.5, -0.4, 0.3),
            "relaxation": (0.4, -0.5, 0.3),
            "calm": (0.3, -0.3, 0.4),

            # Low valence, high arousal
            "anger": (-0.6, 0.7, 0.7),
            "fear": (-0.7, 0.8, -0.5),
            "anxiety": (-0.5, 0.6, -0.3),
            "frustration": (-0.5, 0.5, 0.3),
            "stress": (-0.4, 0.6, -0.2),

            # Low valence, low arousal
            "sadness": (-0.6, -0.3, -0.4),
            "depression": (-0.7, -0.5, -0.6),
            "boredom": (-0.2, -0.5, -0.2),
            "loneliness": (-0.5, -0.2, -0.4),

            # Mixed/complex emotions
            "surprise": (0.0, 0.8, 0.0),
            "curiosity": (0.3, 0.4, 0.3),
            "nostalgia": (0.2, -0.1, -0.1),
            "gratitude": (0.7, 0.3, 0.4),
            "pride": (0.6, 0.4, 0.7),
            "guilt": (-0.4, 0.3, -0.5),
            "shame": (-0.5, 0.4, -0.6),
            "hope": (0.4, 0.3, 0.2),
            "love": (0.8, 0.3, 0.4),
            "awe": (0.5, 0.6, -0.2),

            # Neutral
            "neutral": (0.0, 0.0, 0.0),
        }
        return emotion_map.get(emotion.lower(), (0.0, 0.0, 0.0))

    @classmethod
    def pad_to_emotion(cls, valence: float, arousal: float, dominance: float) -> str:
        """Infer primary emotion from PAD coordinates.

        Uses nearest-neighbor matching to emotion prototypes.
        """
        emotion_map = {
            "joy": (0.8, 0.5, 0.6),
            "excitement": (0.7, 0.8, 0.5),
            "contentment": (0.6, -0.2, 0.4),
            "serenity": (0.5, -0.4, 0.3),
            "anger": (-0.6, 0.7, 0.7),
            "fear": (-0.7, 0.8, -0.5),
            "anxiety": (-0.5, 0.6, -0.3),
            "sadness": (-0.6, -0.3, -0.4),
            "boredom": (-0.2, -0.5, -0.2),
            "surprise": (0.0, 0.8, 0.0),
            "curiosity": (0.3, 0.4, 0.3),
            "gratitude": (0.7, 0.3, 0.4),
            "pride": (0.6, 0.4, 0.7),
            "hope": (0.4, 0.3, 0.2),
            "neutral": (0.0, 0.0, 0.0),
        }

        min_distance = float("inf")
        closest_emotion = "neutral"

        for emotion, (v, a, d) in emotion_map.items():
            distance = (
                (valence - v) ** 2
                + (arousal - a) ** 2
                + (dominance - d) ** 2
            )
            if distance < min_distance:
                min_distance = distance
                closest_emotion = emotion

        return closest_emotion

    @property
    def emotional_intensity(self) -> float:
        """Calculate overall emotional intensity (0-1).

        Based on distance from neutral point in PAD space.
        """
        import math
        distance = math.sqrt(
            self.valence ** 2
            + self.arousal ** 2
            + self.dominance ** 2
        )
        max_distance = math.sqrt(3)
        return min(1.0, distance / max_distance)

    def is_flashbulb_candidate(self) -> bool:
        """Check if this memory has flashbulb memory characteristics.

        Flashbulb memories are vivid, detailed memories of surprising,
        consequential events (Brown & Kulik, 1977).
        """
        return (
            self.surprise >= 0.6
            and self.consequentiality >= 0.5
            and abs(self.arousal) >= 0.5
        )
