"""FSRS-6 Spaced Repetition Service.

Implementation of the Free Spaced Repetition Scheduler version 6.
FSRS-6 is state-of-the-art with 21 trainable parameters, outperforming SM-2 by ~26%.

Key formulas:
- Retrievability: R(t,S) = (1 + factor × t/S)^(-w20)
- Interval: I(r,S) = (S/factor) × (r^(1/w20) - 1)
- Stability update: S' = S × e^(w[...] × (1 - R) × ...)
- Difficulty update: D' = w7 × D0(3) + (1-w7)(D - w6(G-3))

References:
- https://github.com/open-spaced-repetition/fsrs4anki
- https://supermemo.guru/wiki/Free_Spaced_Repetition_Scheduler
"""
import logging
import math
from datetime import datetime, date, timedelta, timezone
from uuid import UUID
from typing import Optional
from dataclasses import dataclass
from enum import IntEnum

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Memory
from app.models.fsrs import FSRSParameters, ReviewLog
from app.config import settings

logger = logging.getLogger(__name__)


class Rating(IntEnum):
    """FSRS Rating scale (1-4)."""
    AGAIN = 1  # Complete blackout
    HARD = 2   # Significant difficulty
    GOOD = 3   # Correct with some effort
    EASY = 4   # Perfect recall


class State(str):
    """FSRS memory states."""
    NEW = "new"
    LEARNING = "learning"
    REVIEW = "review"
    RELEARNING = "relearning"


@dataclass
class SchedulingInfo:
    """Scheduling information for a memory at each rating."""
    again: dict
    hard: dict
    good: dict
    easy: dict


@dataclass
class ReviewResult:
    """Result of a review operation."""
    memory_id: UUID
    rating: int
    state_before: str
    state_after: str
    stability_before: float
    stability_after: float
    difficulty_before: float
    difficulty_after: float
    scheduled_days: float
    next_review_date: date
    retrievability: float


class FSRSService:
    """FSRS-6 Spaced Repetition Algorithm Service.

    Implements the complete FSRS-6 algorithm with personalized parameters.
    """

    FACTOR = 19 / 81  # FSRS constant

    def __init__(self, db: AsyncSession):
        self.db = db
        self._params_cache: dict[UUID, dict] = {}

    async def get_parameters(self, user_id: UUID) -> dict:
        """Get FSRS parameters for a user, creating defaults if needed."""
        if user_id in self._params_cache:
            return self._params_cache[user_id]

        result = await self.db.execute(
            select(FSRSParameters).where(FSRSParameters.user_id == user_id)
        )
        params = result.scalar_one_or_none()

        if params is None:
            params = FSRSParameters(
                user_id=user_id,
                parameters=FSRSParameters.default_parameters(),
            )
            self.db.add(params)
            await self.db.flush()

        self._params_cache[user_id] = params.parameters
        return params.parameters

    def _get_param(self, params: dict, key: str) -> float:
        """Safely get a parameter with default fallback."""
        defaults = FSRSParameters.default_parameters()
        return params.get(key, defaults.get(key, 0.0))

    def _calculate_retrievability(
        self,
        elapsed_days: float,
        stability: float,
        decay: float,
    ) -> float:
        """Calculate memory retrievability using power forgetting curve.

        R(t,S) = (1 + factor × t/S)^(-decay)
        """
        if stability <= 0:
            return 0.0
        if elapsed_days <= 0:
            return 1.0
        return pow(1 + self.FACTOR * elapsed_days / stability, -decay)

    def _calculate_interval(
        self,
        retrievability: float,
        stability: float,
        decay: float,
        maximum_interval: int,
    ) -> float:
        """Calculate review interval to achieve target retrievability.

        I(r,S) = (S/factor) × (r^(1/decay) - 1)
        """
        if retrievability <= 0 or retrievability >= 1:
            return stability
        interval = (stability / self.FACTOR) * (pow(retrievability, 1 / decay) - 1)
        return min(max(1, interval), maximum_interval)

    def _initial_stability(self, params: dict, rating: int) -> float:
        """Calculate initial stability for a new card based on first rating."""
        return max(0.1, self._get_param(params, f"w{rating - 1}"))

    def _initial_difficulty(self, params: dict, rating: int) -> float:
        """Calculate initial difficulty based on first rating.

        D0(G) = w4 - e^(w5 × (G - 1)) + 1
        """
        w4 = self._get_param(params, "w4")
        w5 = self._get_param(params, "w5")
        difficulty = w4 - math.exp(w5 * (rating - 1)) + 1
        return self._constrain_difficulty(difficulty)

    def _constrain_difficulty(self, difficulty: float) -> float:
        """Keep difficulty in valid range [0.1, 1.0]."""
        return min(max(0.1, difficulty), 1.0)

    def _update_difficulty(
        self,
        params: dict,
        difficulty: float,
        rating: int,
    ) -> float:
        """Update difficulty after a review.

        D' = w7 × D0(3) + (1-w7) × (D - w6 × (G-3))
        """
        w6 = self._get_param(params, "w6")
        w7 = self._get_param(params, "w7")

        d0_good = self._initial_difficulty(params, Rating.GOOD)
        new_difficulty = w7 * d0_good + (1 - w7) * (difficulty - w6 * (rating - 3))

        return self._constrain_difficulty(new_difficulty)

    def _calculate_stability_short_term(
        self,
        params: dict,
        stability: float,
        rating: int,
    ) -> float:
        """Calculate stability for short-term scheduling (learning/relearning).

        S'_s(S, G) = S × e^(w17 × (G-3+w18))
        """
        w17 = self._get_param(params, "w17")
        w18 = self._get_param(params, "w18")
        return stability * math.exp(w17 * (rating - 3 + w18))

    def _calculate_stability_success(
        self,
        params: dict,
        difficulty: float,
        stability: float,
        retrievability: float,
        rating: int,
    ) -> float:
        """Calculate new stability after successful recall.

        S'_r(D,S,R,G) = S × (e^(w8) × (11-D) × S^(-w9) × (e^(w10×(1-R))-1) × hard_penalty × easy_bonus + 1)
        """
        w8 = self._get_param(params, "w8")
        w9 = self._get_param(params, "w9")
        w10 = self._get_param(params, "w10")
        w15 = self._get_param(params, "w15")
        w16 = self._get_param(params, "w16")

        hard_penalty = self._get_param(params, "w19") if rating == Rating.HARD else 1.0
        easy_bonus = self._get_param(params, "w16") if rating == Rating.EASY else 1.0

        new_stability = stability * (
            math.exp(w8)
            * (11 - difficulty)
            * pow(stability, -w9)
            * (math.exp(w10 * (1 - retrievability)) - 1)
            * hard_penalty
            * easy_bonus
            + 1
        )

        return max(0.1, new_stability)

    def _calculate_stability_failure(
        self,
        params: dict,
        difficulty: float,
        stability: float,
        retrievability: float,
    ) -> float:
        """Calculate new stability after forgetting (Again rating).

        S'_f(D,S,R) = w11 × D^(-w12) × ((S+1)^w13 - 1) × e^(w14×(1-R))
        """
        w11 = self._get_param(params, "w11")
        w12 = self._get_param(params, "w12")
        w13 = self._get_param(params, "w13")
        w14 = self._get_param(params, "w14")

        new_stability = (
            w11
            * pow(difficulty, -w12)
            * (pow(stability + 1, w13) - 1)
            * math.exp(w14 * (1 - retrievability))
        )

        return max(0.1, min(new_stability, stability))

    async def get_scheduling_cards(
        self,
        memory: Memory,
        user_id: UUID,
        now: Optional[datetime] = None,
    ) -> SchedulingInfo:
        """Get scheduling options for all four ratings.

        Returns interval and next review date for each possible rating.
        """
        params = await self.get_parameters(user_id)
        now = now or datetime.now(timezone.utc)
        decay = self._get_param(params, "w20")
        request_retention = self._get_param(params, "request_retention")
        max_interval = int(self._get_param(params, "maximum_interval"))

        if memory.fsrs_state == State.NEW:
            return self._schedule_new(params, request_retention, max_interval, decay)

        elapsed_days = self._get_elapsed_days(memory, now)
        retrievability = self._calculate_retrievability(
            elapsed_days, memory.fsrs_stability, decay
        )

        if memory.fsrs_state in (State.LEARNING, State.RELEARNING):
            return self._schedule_learning(
                params, memory, retrievability, request_retention, max_interval, decay
            )

        return self._schedule_review(
            params, memory, retrievability, request_retention, max_interval, decay
        )

    def _schedule_new(
        self,
        params: dict,
        request_retention: float,
        max_interval: int,
        decay: float,
    ) -> SchedulingInfo:
        """Generate scheduling for a new memory."""
        def make_schedule(rating: int) -> dict:
            stability = self._initial_stability(params, rating)
            difficulty = self._initial_difficulty(params, rating)
            interval = self._calculate_interval(
                request_retention, stability, decay, max_interval
            )

            if rating == Rating.AGAIN:
                state = State.LEARNING
                interval = 0.00694  # 10 minutes in days
            elif rating == Rating.HARD:
                state = State.LEARNING
                interval = 0.04166  # 1 hour in days
            elif rating == Rating.GOOD:
                state = State.LEARNING
                interval = 0.41666  # 10 hours in days
            else:
                state = State.REVIEW

            return {
                "stability": stability,
                "difficulty": difficulty,
                "interval_days": interval,
                "state": state,
            }

        return SchedulingInfo(
            again=make_schedule(Rating.AGAIN),
            hard=make_schedule(Rating.HARD),
            good=make_schedule(Rating.GOOD),
            easy=make_schedule(Rating.EASY),
        )

    def _schedule_learning(
        self,
        params: dict,
        memory: Memory,
        retrievability: float,
        request_retention: float,
        max_interval: int,
        decay: float,
    ) -> SchedulingInfo:
        """Generate scheduling for a memory in learning/relearning state."""
        def make_schedule(rating: int) -> dict:
            difficulty = self._update_difficulty(params, memory.fsrs_difficulty, rating)

            if rating == Rating.AGAIN:
                stability = self._calculate_stability_failure(
                    params, difficulty, memory.fsrs_stability, retrievability
                )
                state = State.RELEARNING if memory.fsrs_state == State.REVIEW else State.LEARNING
                interval = 0.00694  # 10 minutes
            else:
                stability = self._calculate_stability_short_term(
                    params, memory.fsrs_stability, rating
                )

                if rating == Rating.HARD:
                    state = memory.fsrs_state
                    interval = 0.04166  # 1 hour
                elif rating == Rating.GOOD:
                    state = State.REVIEW
                    interval = self._calculate_interval(
                        request_retention, stability, decay, max_interval
                    )
                else:  # EASY
                    state = State.REVIEW
                    interval = self._calculate_interval(
                        request_retention, stability, decay, max_interval
                    )

            return {
                "stability": stability,
                "difficulty": difficulty,
                "interval_days": interval,
                "state": state,
            }

        return SchedulingInfo(
            again=make_schedule(Rating.AGAIN),
            hard=make_schedule(Rating.HARD),
            good=make_schedule(Rating.GOOD),
            easy=make_schedule(Rating.EASY),
        )

    def _schedule_review(
        self,
        params: dict,
        memory: Memory,
        retrievability: float,
        request_retention: float,
        max_interval: int,
        decay: float,
    ) -> SchedulingInfo:
        """Generate scheduling for a memory in review state."""
        def make_schedule(rating: int) -> dict:
            difficulty = self._update_difficulty(params, memory.fsrs_difficulty, rating)

            if rating == Rating.AGAIN:
                stability = self._calculate_stability_failure(
                    params, difficulty, memory.fsrs_stability, retrievability
                )
                state = State.RELEARNING
                interval = 0.00694  # 10 minutes
            else:
                stability = self._calculate_stability_success(
                    params, difficulty, memory.fsrs_stability, retrievability, rating
                )
                state = State.REVIEW

                if rating == Rating.HARD:
                    interval = self._calculate_interval(
                        request_retention, stability, decay, max_interval
                    )
                    interval = max(interval, memory.fsrs_scheduled_days or 1)
                else:
                    interval = self._calculate_interval(
                        request_retention, stability, decay, max_interval
                    )

            return {
                "stability": stability,
                "difficulty": difficulty,
                "interval_days": interval,
                "state": state,
            }

        return SchedulingInfo(
            again=make_schedule(Rating.AGAIN),
            hard=make_schedule(Rating.HARD),
            good=make_schedule(Rating.GOOD),
            easy=make_schedule(Rating.EASY),
        )

    def _get_elapsed_days(self, memory: Memory, now: datetime) -> float:
        """Calculate days elapsed since last review."""
        if memory.fsrs_last_review is None:
            return 0

        last_review = memory.fsrs_last_review
        if last_review.tzinfo is None:
            last_review = last_review.replace(tzinfo=timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        return max(0, (now - last_review).total_seconds() / 86400)

    async def review_memory(
        self,
        memory_id: UUID,
        user_id: UUID,
        rating: int,
        review_duration_ms: Optional[int] = None,
        now: Optional[datetime] = None,
    ) -> ReviewResult:
        """Apply FSRS review to a memory.

        Args:
            memory_id: The memory to review
            user_id: The user performing the review
            rating: 1=Again, 2=Hard, 3=Good, 4=Easy
            review_duration_ms: Optional time spent on review
            now: Optional timestamp (defaults to now)

        Returns:
            ReviewResult with before/after states
        """
        now = now or datetime.now(timezone.utc)
        rating = max(1, min(4, rating))

        result = await self.db.execute(
            select(Memory)
            .where(Memory.id == memory_id)
            .where(Memory.user_id == user_id)
        )
        memory = result.scalar_one_or_none()
        if memory is None:
            raise ValueError(f"Memory {memory_id} not found")

        params = await self.get_parameters(user_id)
        decay = self._get_param(params, "w20")
        request_retention = self._get_param(params, "request_retention")
        max_interval = int(self._get_param(params, "maximum_interval"))

        state_before = memory.fsrs_state
        stability_before = memory.fsrs_stability
        difficulty_before = memory.fsrs_difficulty

        elapsed_days = self._get_elapsed_days(memory, now)
        retrievability = self._calculate_retrievability(elapsed_days, stability_before, decay)

        scheduling = await self.get_scheduling_cards(memory, user_id, now)
        schedule = getattr(scheduling, ["again", "hard", "good", "easy"][rating - 1])

        memory.fsrs_stability = schedule["stability"]
        memory.fsrs_difficulty = schedule["difficulty"]
        memory.fsrs_state = schedule["state"]
        memory.fsrs_scheduled_days = schedule["interval_days"]
        memory.fsrs_elapsed_days = elapsed_days
        memory.fsrs_last_review = now
        memory.fsrs_reps += 1

        if rating == Rating.AGAIN:
            memory.fsrs_lapses += 1

        next_review = date.today() + timedelta(days=max(1, round(schedule["interval_days"])))
        memory.next_review_date = next_review

        memory.interval_days = max(1, round(schedule["interval_days"]))
        memory.last_accessed = now
        memory.access_count += 1

        log = ReviewLog(
            user_id=user_id,
            memory_id=memory_id,
            rating=rating,
            state=state_before,
            scheduled_days=memory.fsrs_scheduled_days,
            elapsed_days=elapsed_days,
            stability_before=stability_before,
            stability_after=memory.fsrs_stability,
            difficulty_before=difficulty_before,
            difficulty_after=memory.fsrs_difficulty,
            retrievability=retrievability,
            review_duration_ms=review_duration_ms,
            review_time=now,
        )
        self.db.add(log)

        user_params = await self.db.execute(
            select(FSRSParameters).where(FSRSParameters.user_id == user_id)
        )
        params_record = user_params.scalar_one_or_none()
        if params_record:
            params_record.review_count += 1

        await self.db.commit()

        logger.info(
            f"FSRS review: memory={memory_id}, rating={rating}, "
            f"S:{stability_before:.2f}→{memory.fsrs_stability:.2f}, "
            f"D:{difficulty_before:.2f}→{memory.fsrs_difficulty:.2f}, "
            f"next={next_review}"
        )

        return ReviewResult(
            memory_id=memory_id,
            rating=rating,
            state_before=state_before,
            state_after=memory.fsrs_state,
            stability_before=stability_before,
            stability_after=memory.fsrs_stability,
            difficulty_before=difficulty_before,
            difficulty_after=memory.fsrs_difficulty,
            scheduled_days=schedule["interval_days"],
            next_review_date=next_review,
            retrievability=retrievability,
        )

    async def get_due_memories(
        self,
        user_id: UUID,
        limit: int = 20,
    ) -> list[Memory]:
        """Get memories due for review."""
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.next_review_date.isnot(None))
            .where(Memory.next_review_date <= date.today())
            .where(Memory.consolidated_into_id.is_(None))
            .order_by(Memory.next_review_date.asc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_new_memories(
        self,
        user_id: UUID,
        limit: int = 10,
    ) -> list[Memory]:
        """Get new memories that haven't been reviewed."""
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.fsrs_state == State.NEW)
            .where(Memory.consolidated_into_id.is_(None))
            .order_by(Memory.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_learning_memories(
        self,
        user_id: UUID,
    ) -> list[Memory]:
        """Get memories in learning/relearning state."""
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.fsrs_state.in_([State.LEARNING, State.RELEARNING]))
            .where(Memory.consolidated_into_id.is_(None))
            .order_by(Memory.fsrs_last_review.asc())
        )
        return list(result.scalars().all())

    async def get_review_statistics(
        self,
        user_id: UUID,
        days: int = 30,
    ) -> dict:
        """Get review statistics for a user."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        result = await self.db.execute(
            select(
                func.count(ReviewLog.id).label("total_reviews"),
                func.avg(ReviewLog.rating).label("avg_rating"),
                func.sum(func.cast(ReviewLog.rating == 1, sa.Integer)).label("again_count"),
                func.sum(func.cast(ReviewLog.rating == 4, sa.Integer)).label("easy_count"),
            )
            .where(ReviewLog.user_id == user_id)
            .where(ReviewLog.review_time >= cutoff)
        )
        stats = result.one()

        due_count = await self.db.scalar(
            select(func.count(Memory.id))
            .where(Memory.user_id == user_id)
            .where(Memory.next_review_date <= date.today())
            .where(Memory.consolidated_into_id.is_(None))
        )

        new_count = await self.db.scalar(
            select(func.count(Memory.id))
            .where(Memory.user_id == user_id)
            .where(Memory.fsrs_state == State.NEW)
            .where(Memory.consolidated_into_id.is_(None))
        )

        return {
            "total_reviews": stats.total_reviews or 0,
            "avg_rating": float(stats.avg_rating) if stats.avg_rating else None,
            "again_count": stats.again_count or 0,
            "easy_count": stats.easy_count or 0,
            "due_count": due_count or 0,
            "new_count": new_count or 0,
            "retention_rate": (
                1 - (stats.again_count or 0) / stats.total_reviews
                if stats.total_reviews
                else None
            ),
        }

    async def initialize_memory_for_review(
        self,
        memory: Memory,
        user_id: UUID,
    ) -> Memory:
        """Initialize a memory for FSRS spaced repetition."""
        params = await self.get_parameters(user_id)

        memory.fsrs_state = State.NEW
        memory.fsrs_stability = 1.0
        memory.fsrs_difficulty = self._get_param(params, "w4") / 10
        memory.fsrs_reps = 0
        memory.fsrs_lapses = 0

        days_old = (datetime.utcnow() - memory.created_at).days
        initial_interval = max(1, min(7, days_old // 7))
        memory.next_review_date = date.today() + timedelta(days=initial_interval)

        await self.db.commit()
        return memory

    async def batch_initialize_for_review(
        self,
        user_id: UUID,
        limit: int = 100,
    ) -> int:
        """Initialize multiple memories for FSRS review."""
        result = await self.db.execute(
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.fsrs_state == State.NEW)
            .where(Memory.next_review_date.is_(None))
            .where(Memory.consolidated_into_id.is_(None))
            .where(Memory.strength >= 0.5)
            .order_by(Memory.emotional_weight.desc(), Memory.strength.desc())
            .limit(limit)
        )
        memories = result.scalars().all()

        count = 0
        for memory in memories:
            await self.initialize_memory_for_review(memory, user_id)
            count += 1

        await self.db.commit()
        logger.info(f"Initialized {count} memories for FSRS review")
        return count


import sqlalchemy as sa
