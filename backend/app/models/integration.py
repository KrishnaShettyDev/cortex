import uuid
from datetime import datetime
from sqlalchemy import String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, ARRAY

from app.database import Base


class ConnectedAccount(Base):
    """Connected external accounts (Google, etc.) for integrations."""

    __tablename__ = "cortex_connected_accounts"

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

    # Provider info
    provider: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )  # 'google', 'microsoft'
    service: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="all",
    )  # 'gmail', 'calendar', 'all' (for combined connections)
    composio_connection_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="active",
    )  # 'active', 'expired', 'revoked'

    # OAuth details
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Connected account email
    scopes: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="connected_accounts")

    __table_args__ = (
        UniqueConstraint("user_id", "provider", "service", name="uq_cortex_connected_account_user_provider_service"),
    )

    def __repr__(self) -> str:
        return f"<ConnectedAccount {self.provider} for user {self.user_id}>"


class SyncState(Base):
    """Tracks sync state for incremental syncing."""

    __tablename__ = "cortex_sync_state"

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

    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )  # 'email', 'calendar'

    # Sync tokens for incremental sync
    last_sync_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "provider", "resource_type",
            name="uq_cortex_sync_state_user_provider_resource",
        ),
    )

    def __repr__(self) -> str:
        return f"<SyncState {self.provider}/{self.resource_type}>"
