import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class PushToken(Base):
    """Push notification tokens for users."""

    __tablename__ = "cortex_push_tokens"

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
    push_token: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
    )
    platform: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )  # 'ios' or 'android'
    device_name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="push_tokens",
    )

    __table_args__ = (
        Index("idx_cortex_push_tokens_user_active", "user_id", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<PushToken {self.platform} for user {self.user_id}>"
