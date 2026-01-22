"""Service for surfacing memory insights (on this day, weekly summaries, etc.)."""

from datetime import datetime, timedelta
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import Memory


class InsightService:
    """Service for generating memory insights and surfacing relevant past memories."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_on_this_day(self, user_id: str) -> list[dict]:
        """
        Get memories from this day in previous years.
        Returns up to 3 insights from 1, 2, and 3 years ago.
        """
        today = datetime.now()
        insights = []

        for years_ago in [1, 2, 3]:
            target_date = today - timedelta(days=365 * years_ago)
            start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1)

            result = await self.db.execute(
                select(Memory).where(
                    and_(
                        Memory.user_id == user_id,
                        Memory.memory_date >= start,
                        Memory.memory_date < end,
                        Memory.memory_type.in_(["text", "voice", "photo"]),
                    )
                ).limit(2)
            )
            memories = result.scalars().all()

            for memory in memories:
                summary = memory.summary or memory.content[:80]
                year_label = f"{years_ago} year{'s' if years_ago > 1 else ''} ago"

                insights.append({
                    "type": "on_this_day",
                    "title": year_label,
                    "body": summary,
                    "data": {
                        "type": "memory_insight",
                        "memory_id": str(memory.id),
                        "topic": summary[:30],
                        "years_ago": years_ago,
                    },
                })

        # Return max 2 insights
        return insights[:2]

    async def get_weekly_summary(self, user_id: str) -> dict | None:
        """
        Generate a weekly summary insight.
        Only available on Sundays.
        """
        if datetime.now().weekday() != 6:  # Not Sunday
            return None

        week_ago = datetime.now() - timedelta(days=7)

        # Count memories by type
        result = await self.db.execute(
            select(Memory.memory_type, func.count(Memory.id)).where(
                and_(
                    Memory.user_id == user_id,
                    Memory.created_at >= week_ago,
                )
            ).group_by(Memory.memory_type)
        )
        counts = dict(result.all())

        total = sum(counts.values())
        if total == 0:
            return None

        # Build summary text
        parts = []
        if counts.get("voice", 0) > 0:
            parts.append(f"{counts['voice']} voice notes")
        if counts.get("text", 0) > 0:
            parts.append(f"{counts['text']} notes")
        if counts.get("photo", 0) > 0:
            parts.append(f"{counts['photo']} photos")

        body = ", ".join(parts) if parts else f"{total} memories"

        return {
            "type": "weekly_summary",
            "title": "Your week",
            "body": body,
            "data": {
                "type": "memory_insight",
                "topic": "my week",
                "counts": counts,
            },
        }

    async def get_random_memory(self, user_id: str) -> dict | None:
        """
        Get a random meaningful memory to surface.
        Prioritizes memories with summaries (more meaningful).
        """
        # Get memories from more than 30 days ago with summaries
        cutoff = datetime.now() - timedelta(days=30)

        result = await self.db.execute(
            select(Memory).where(
                and_(
                    Memory.user_id == user_id,
                    Memory.created_at < cutoff,
                    Memory.summary.isnot(None),
                    Memory.memory_type.in_(["text", "voice", "photo"]),
                )
            ).order_by(func.random()).limit(1)
        )
        memory = result.scalar_one_or_none()

        if not memory:
            return None

        return {
            "type": "memory_surface",
            "title": "A past thought",
            "body": memory.summary or memory.content[:80],
            "data": {
                "type": "memory_insight",
                "memory_id": str(memory.id),
                "topic": (memory.summary or memory.content)[:30],
            },
        }

    async def get_all_insights(self, user_id: str) -> list[dict]:
        """Get all available insights for a user."""
        insights = []

        # On this day
        on_this_day = await self.get_on_this_day(user_id)
        insights.extend(on_this_day)

        # Weekly summary (Sundays only)
        weekly = await self.get_weekly_summary(user_id)
        if weekly:
            insights.append(weekly)

        return insights
