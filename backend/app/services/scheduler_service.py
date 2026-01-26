"""Service for orchestrating scheduled notification jobs."""

import logging
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_maker
from datetime import datetime, timedelta
from app.models.user import User
from app.models.push_token import PushToken
from app.models.memory import Memory
from app.services.push_service import PushService
from app.services.briefing_service import BriefingService
from app.services.reminder_service import ReminderService
from app.services.insight_service import InsightService
from app.services.connection_service import ConnectionService
from app.services.people_service import PeopleService

logger = logging.getLogger(__name__)


class SchedulerService:
    """Service for running scheduled notification jobs."""

    async def _get_users_with_notifications(self, db: AsyncSession) -> list[User]:
        """Get all users with active push tokens."""
        result = await db.execute(
            select(User)
            .join(PushToken)
            .where(PushToken.is_active == True)
            .distinct()
        )
        return list(result.scalars().all())

    async def send_morning_briefings(self) -> dict:
        """Send morning briefings to all users with notifications enabled."""
        logger.info("Starting morning briefings job")
        sent = 0
        failed = 0

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            logger.info(f"Sending morning briefings to {len(users)} users")

            briefing_service = BriefingService(db)
            push_service = PushService(db)

            for user in users:
                try:
                    content = await briefing_service.generate_morning_briefing(
                        str(user.id)
                    )

                    # Parse content for notification
                    lines = content.strip().split("\n")
                    title = lines[0] if lines else "Good morning"
                    body = "\n".join(lines[1:4]).strip() if len(lines) > 1 else ""

                    result = await push_service.send_notification(
                        user_id=str(user.id),
                        title=title,
                        body=body[:150],
                        data={
                            "type": "briefing",
                            "full_content": content,
                        },
                    )

                    if result.get("sent", 0) > 0:
                        sent += 1
                    else:
                        failed += 1

                except Exception as e:
                    logger.error(f"Error sending morning briefing to {user.id}: {e}")
                    failed += 1

        logger.info(f"Morning briefings complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    async def send_evening_briefings(self) -> dict:
        """Send evening reflections to all users."""
        logger.info("Starting evening briefings job")
        sent = 0
        failed = 0

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            logger.info(f"Sending evening briefings to {len(users)} users")

            briefing_service = BriefingService(db)
            push_service = PushService(db)

            for user in users:
                try:
                    content = await briefing_service.generate_evening_briefing(
                        str(user.id)
                    )

                    lines = content.strip().split("\n")
                    title = lines[0] if lines else "Good evening"
                    body = "\n".join(lines[1:4]).strip() if len(lines) > 1 else ""

                    result = await push_service.send_notification(
                        user_id=str(user.id),
                        title=title,
                        body=body[:150],
                        data={
                            "type": "briefing",
                            "full_content": content,
                        },
                    )

                    if result.get("sent", 0) > 0:
                        sent += 1
                    else:
                        failed += 1

                except Exception as e:
                    logger.error(f"Error sending evening briefing to {user.id}: {e}")
                    failed += 1

        logger.info(f"Evening briefings complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    async def check_and_send_reminders(self) -> dict:
        """Check for pending time-based reminders and send notifications."""
        logger.info("Checking for pending reminders")
        sent = 0
        failed = 0

        async with async_session_maker() as db:
            reminder_service = ReminderService(db)

            try:
                # Get all pending time-based reminders that should be sent now
                pending_reminders = await reminder_service.get_pending_time_reminders(
                    within_minutes=5
                )

                for reminder in pending_reminders:
                    try:
                        success = await reminder_service.send_reminder_notification(reminder)
                        if success:
                            sent += 1
                        else:
                            failed += 1
                    except Exception as e:
                        logger.error(f"Error sending reminder {reminder.id}: {e}")
                        failed += 1

            except Exception as e:
                logger.error(f"Error checking reminders: {e}")

        if sent > 0 or failed > 0:
            logger.info(f"Reminders complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    async def send_memory_insights(self) -> dict:
        """Send memory insights (on this day, etc.)."""
        logger.info("Starting memory insights job")
        sent = 0
        failed = 0

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            logger.info(f"Checking memory insights for {len(users)} users")

            insight_service = InsightService(db)
            push_service = PushService(db)

            for user in users:
                try:
                    insights = await insight_service.get_all_insights(str(user.id))

                    if not insights:
                        continue

                    # Send first insight only
                    insight = insights[0]

                    result = await push_service.send_notification(
                        user_id=str(user.id),
                        title=insight["title"],
                        body=insight["body"],
                        data=insight.get("data", {}),
                    )

                    if result.get("sent", 0) > 0:
                        sent += 1
                    else:
                        failed += 1

                except Exception as e:
                    logger.error(f"Error sending insights to {user.id}: {e}")
                    failed += 1

        logger.info(f"Memory insights complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    async def discover_connections(self) -> dict:
        """Discover connections between recent memories (hourly job)."""
        logger.info("Starting connection discovery job")
        connections_found = 0
        memories_processed = 0

        async with async_session_maker() as db:
            # Get memories from the last 2 hours that haven't been processed
            cutoff = datetime.utcnow() - timedelta(hours=2)
            result = await db.execute(
                select(Memory)
                .where(Memory.created_at >= cutoff)
                .where(Memory.embedding.isnot(None))
                .order_by(Memory.created_at.desc())
                .limit(20)
            )
            recent_memories = list(result.scalars().all())

            if not recent_memories:
                logger.info("No recent memories to process for connections")
                return {"memories_processed": 0, "connections_found": 0}

            connection_service = ConnectionService(db)

            for memory in recent_memories:
                try:
                    connections = await connection_service.find_connections_for_memory(
                        user_id=memory.user_id,
                        memory=memory,
                        limit=3,
                    )
                    connections_found += len(connections)
                    memories_processed += 1
                except Exception as e:
                    logger.error(f"Error discovering connections for memory {memory.id}: {e}")

        logger.info(f"Connection discovery complete: {memories_processed} memories processed, {connections_found} connections found")
        return {"memories_processed": memories_processed, "connections_found": connections_found}

    async def send_connection_notifications(self) -> dict:
        """Send notifications for new interesting connections (every 2 hours)."""
        logger.info("Starting connection notifications job")
        sent = 0
        failed = 0

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            connection_service = ConnectionService(db)
            push_service = PushService(db)

            for user in users:
                try:
                    # Get unnotified connections
                    connections = await connection_service.get_unnotified_connections(
                        user_id=user.id,
                        limit=3,
                    )

                    if not connections:
                        continue

                    for conn in connections:
                        # Get connection with memories for notification content
                        data = await connection_service.get_connection_with_memories(
                            connection_id=conn.id,
                            user_id=user.id,
                        )
                        if not data:
                            continue

                        connection, memory1, memory2 = data

                        title = "Memory Connection"
                        body = connection.explanation or "Related memories discovered"

                        result = await push_service.send_notification(
                            user_id=str(user.id),
                            title=title,
                            body=body[:150],
                            data={
                                "type": "connection",
                                "connection_id": str(conn.id),
                            },
                        )

                        if result.get("sent", 0) > 0:
                            sent += 1
                        else:
                            failed += 1

                    # Mark connections as notified
                    await connection_service.mark_notified(user.id, [c.id for c in connections])

                except Exception as e:
                    logger.error(f"Error sending connection notifications to {user.id}: {e}")
                    failed += 1

        logger.info(f"Connection notifications complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    async def send_meeting_prep_notifications(self) -> dict:
        """Send meeting preparation context notifications (every 15 minutes)."""
        logger.info("Checking for upcoming meetings")
        sent = 0
        failed = 0

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            people_service = PeopleService(db)
            push_service = PushService(db)

            for user in users:
                try:
                    # Get meetings in the next 1 hour
                    upcoming = await people_service.get_upcoming_meetings(
                        user_id=user.id,
                        hours_ahead=1,
                    )

                    for profile, entity in upcoming:
                        # Generate context
                        context = await people_service.generate_meeting_context(
                            user_id=user.id,
                            person_name=entity.name,
                        )

                        if not context:
                            continue

                        title = f"Meeting with {entity.name} soon"
                        body = context[:150]

                        result = await push_service.send_notification(
                            user_id=str(user.id),
                            title=title,
                            body=body,
                            data={
                                "type": "meeting_prep",
                                "person_name": entity.name,
                            },
                        )

                        if result.get("sent", 0) > 0:
                            sent += 1
                            # Clear the next_meeting_date to avoid duplicate notifications
                            profile.next_meeting_date = None
                            await db.commit()
                        else:
                            failed += 1

                except Exception as e:
                    logger.error(f"Error sending meeting prep to {user.id}: {e}")
                    failed += 1

        if sent > 0 or failed > 0:
            logger.info(f"Meeting prep notifications complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    async def update_person_profiles(self) -> dict:
        """Update stale person profiles (daily job at 2am)."""
        logger.info("Starting person profiles update job")
        updated = 0
        failed = 0

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            people_service = PeopleService(db)

            for user in users:
                try:
                    # Get list of people for the user
                    people = await people_service.list_people(
                        user_id=user.id,
                        sort_by="frequent",
                        limit=20,
                    )

                    for person in people:
                        try:
                            # Regenerate profile
                            await people_service.get_person_profile(
                                user_id=user.id,
                                person_name=person["name"],
                                regenerate=True,
                            )
                            updated += 1
                        except Exception as e:
                            logger.error(f"Error updating profile for {person['name']}: {e}")
                            failed += 1

                except Exception as e:
                    logger.error(f"Error updating profiles for user {user.id}: {e}")
                    failed += 1

        logger.info(f"Person profiles update complete: {updated} updated, {failed} failed")
        return {"updated": updated, "failed": failed}

    # ==================== ADAPTIVE LEARNING JOBS ====================

    async def apply_memory_decay(self) -> dict:
        """Apply memory strength decay to all users (daily job at 3am)."""
        logger.info("Starting memory decay job")
        total_decayed = 0

        from app.services.adaptive_learning_service import AdaptiveLearningService

        async with async_session_maker() as db:
            # Get all users with memories
            result = await db.execute(
                select(User).join(Memory).distinct()
            )
            users = list(result.scalars().all())

            for user in users:
                try:
                    service = AdaptiveLearningService(db)
                    decayed = await service.apply_memory_decay(user_id=user.id)
                    total_decayed += decayed
                except Exception as e:
                    logger.error(f"Error applying decay for user {user.id}: {e}")

        logger.info(f"Memory decay complete: {total_decayed} memories updated")
        return {"memories_decayed": total_decayed}

    async def extract_user_patterns(self) -> dict:
        """Extract patterns from memories for all users (daily job at 4am)."""
        logger.info("Starting pattern extraction job")
        total_insights = 0
        users_processed = 0

        from app.services.adaptive_learning_service import AdaptiveLearningService

        async with async_session_maker() as db:
            # Get users with enough memories for pattern extraction
            result = await db.execute(
                select(User)
                .join(Memory)
                .group_by(User.id)
                .having(func.count(Memory.id) >= 10)  # Only users with 10+ memories
            )
            users = list(result.scalars().all())

            for user in users:
                try:
                    service = AdaptiveLearningService(db)
                    insights = await service.extract_patterns(user_id=user.id, days=30)
                    total_insights += len(insights)
                    users_processed += 1
                except Exception as e:
                    logger.error(f"Error extracting patterns for user {user.id}: {e}")

        logger.info(f"Pattern extraction complete: {total_insights} insights for {users_processed} users")
        return {"insights_generated": total_insights, "users_processed": users_processed}

    async def analyze_emotional_weights(self) -> dict:
        """Analyze emotional weights for recent memories (every 6 hours)."""
        logger.info("Starting emotional weight analysis job")
        analyzed = 0

        from app.services.adaptive_learning_service import AdaptiveLearningService

        async with async_session_maker() as db:
            # Get recent memories without emotional weight analysis
            # (memories with default 0.5 emotional weight that were created in last 6 hours)
            cutoff = datetime.utcnow() - timedelta(hours=6)
            result = await db.execute(
                select(Memory)
                .where(Memory.created_at >= cutoff)
                .where(Memory.emotional_weight == 0.5)  # Default value
                .limit(50)
            )
            memories = list(result.scalars().all())

            if not memories:
                logger.info("No memories need emotional weight analysis")
                return {"analyzed": 0}

            service = AdaptiveLearningService(db)

            for memory in memories:
                try:
                    await service.update_memory_emotional_weight(memory.id)
                    analyzed += 1
                except Exception as e:
                    logger.error(f"Error analyzing emotional weight for memory {memory.id}: {e}")

        logger.info(f"Emotional weight analysis complete: {analyzed} memories analyzed")
        return {"analyzed": analyzed}

    # ==================== ADVANCED MEMORY JOBS ====================

    async def consolidate_memories(self) -> dict:
        """Consolidate similar memories for all users (weekly job at 2am Sunday)."""
        logger.info("Starting memory consolidation job")

        from app.services.advanced_memory_service import AdvancedMemoryService

        async with async_session_maker() as db:
            service = AdvancedMemoryService(db)
            result = await service.run_consolidation_job()

        logger.info(f"Memory consolidation complete: {result}")
        return result

    async def detect_temporal_patterns(self) -> dict:
        """Detect temporal patterns in memories (weekly job at 3am Sunday)."""
        logger.info("Starting temporal pattern detection job")

        from app.services.advanced_memory_service import AdvancedMemoryService

        async with async_session_maker() as db:
            service = AdvancedMemoryService(db)
            result = await service.run_pattern_detection_job()

        logger.info(f"Temporal pattern detection complete: {result}")
        return result

    async def initialize_spaced_repetition(self) -> dict:
        """Initialize spaced repetition for new memories (daily job at 5am)."""
        logger.info("Starting spaced repetition initialization job")

        from app.services.advanced_memory_service import AdvancedMemoryService

        async with async_session_maker() as db:
            service = AdvancedMemoryService(db)
            result = await service.run_spaced_repetition_init_job()

        logger.info(f"Spaced repetition initialization complete: {result}")
        return result

    async def check_decision_outcomes(self) -> dict:
        """Check for decisions needing outcome tracking (weekly job at 10am Monday)."""
        logger.info("Starting decision outcome check job")
        sent = 0
        failed = 0

        from app.services.advanced_memory_service import AdvancedMemoryService

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            push_service = PushService(db)

            for user in users:
                try:
                    service = AdvancedMemoryService(db)
                    pending = await service.find_pending_decisions(user.id, min_age_days=14)

                    if pending:
                        # Send notification about pending decisions
                        decision = pending[0]
                        result = await push_service.send_notification(
                            user_id=str(user.id),
                            title="How did this decision work out?",
                            body=f"'{decision.decision_text[:50]}...' - Tap to record outcome",
                            data={
                                "type": "decision_outcome",
                                "decision_id": str(decision.id),
                                "total_pending": len(pending),
                            },
                        )

                        if result.get("sent", 0) > 0:
                            sent += 1
                        else:
                            failed += 1

                except Exception as e:
                    logger.error(f"Error checking decisions for {user.id}: {e}")
                    failed += 1

        logger.info(f"Decision outcome check complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    # ==================== REAL-TIME SYNC JOBS ====================

    async def sync_gmail_all_users(self) -> dict:
        """Sync Gmail for all users with active connections (every 5 minutes)."""
        logger.info("Starting automatic Gmail sync job")
        synced = 0
        failed = 0

        from app.services.sync_service import SyncService
        from app.models.integration import ConnectedAccount

        async with async_session_maker() as db:
            # Get all users with Gmail connected
            result = await db.execute(
                select(ConnectedAccount)
                .where(ConnectedAccount.provider == "google")
                .where(ConnectedAccount.service == "gmail")
                .where(ConnectedAccount.status == "active")
            )
            accounts = list(result.scalars().all())

            if not accounts:
                return {"synced": 0, "failed": 0, "message": "No active Gmail connections"}

            logger.info(f"Syncing Gmail for {len(accounts)} users")

            for account in accounts:
                try:
                    sync_service = SyncService(db)
                    count, errors = await sync_service.sync_gmail(account.user_id)
                    if errors and "not connected" not in str(errors):
                        logger.warning(f"Gmail sync errors for {account.user_id}: {errors}")
                    synced += 1
                except Exception as e:
                    logger.error(f"Gmail sync failed for {account.user_id}: {e}")
                    failed += 1

        logger.info(f"Gmail sync complete: {synced} users synced, {failed} failed")
        return {"synced": synced, "failed": failed}

    async def sync_calendar_all_users(self) -> dict:
        """Sync Calendar for all users with active connections (every 5 minutes)."""
        logger.info("Starting automatic Calendar sync job")
        synced = 0
        failed = 0

        from app.services.sync_service import SyncService
        from app.models.integration import ConnectedAccount

        async with async_session_maker() as db:
            # Get all users with Calendar connected
            result = await db.execute(
                select(ConnectedAccount)
                .where(ConnectedAccount.provider == "google")
                .where(ConnectedAccount.service.in_(["calendar", "googlecalendar"]))
                .where(ConnectedAccount.status == "active")
            )
            accounts = list(result.scalars().all())

            if not accounts:
                return {"synced": 0, "failed": 0, "message": "No active Calendar connections"}

            logger.info(f"Syncing Calendar for {len(accounts)} users")

            for account in accounts:
                try:
                    sync_service = SyncService(db)
                    count, errors = await sync_service.sync_calendar(account.user_id)
                    if errors and "not connected" not in str(errors):
                        logger.warning(f"Calendar sync errors for {account.user_id}: {errors}")
                    synced += 1
                except Exception as e:
                    logger.error(f"Calendar sync failed for {account.user_id}: {e}")
                    failed += 1

        logger.info(f"Calendar sync complete: {synced} users synced, {failed} failed")
        return {"synced": synced, "failed": failed}

    async def process_calendar_memories(self) -> dict:
        """
        Create memories from yesterday's calendar events.

        This allows users to ask "What happened in that meeting?" and get answers.
        Runs daily to process completed events.
        """
        logger.info("Starting calendar memory creation job")
        created = 0
        failed = 0

        from app.services.calendar_memory_service import CalendarMemoryService
        from app.models.integration import ConnectedAccount

        async with async_session_maker() as db:
            # Get all users with Calendar connected
            result = await db.execute(
                select(ConnectedAccount)
                .where(ConnectedAccount.provider == "google")
                .where(ConnectedAccount.service.in_(["calendar", "googlecalendar", "google_calendar"]))
                .where(ConnectedAccount.status == "active")
            )
            accounts = list(result.scalars().all())

            if not accounts:
                return {"created": 0, "failed": 0, "message": "No active Calendar connections"}

            logger.info(f"Processing calendar memories for {len(accounts)} users")

            for account in accounts:
                try:
                    service = CalendarMemoryService(db)
                    memories = await service.process_recent_events(
                        user_id=account.user_id,
                        days_back=1,  # Process yesterday's events
                    )
                    created += len(memories)
                except Exception as e:
                    logger.error(f"Calendar memory processing failed for {account.user_id}: {e}")
                    failed += 1

            await db.commit()

        logger.info(f"Calendar memory job complete: {created} memories created, {failed} users failed")
        return {"created": created, "failed": failed}

    # ==================== PROSPECTIVE MEMORY JOBS ====================

    async def process_intentions(self) -> dict:
        """
        Process intentions: update statuses and scan for fulfillment.
        Runs every hour.
        """
        logger.info("Starting intention processing job")
        users_processed = 0

        from app.services.intention_service import IntentionService

        async with async_session_maker() as db:
            result = await db.execute(select(User).join(Memory).distinct())
            users = list(result.scalars().all())

            for user in users:
                try:
                    service = IntentionService(db)
                    await service.update_intention_statuses(user.id)
                    await service.scan_for_fulfillment(user.id)
                    users_processed += 1
                except Exception as e:
                    logger.error(f"Error processing intentions for {user.id}: {e}")

        logger.info(f"Intention processing complete: {users_processed} users processed")
        return {"users_processed": users_processed}

    async def send_intention_nudges(self) -> dict:
        """
        Send proactive nudges for unfulfilled intentions.
        Runs twice daily (morning and evening).

        Checks BOTH:
        - cortex_intentions (memory-based extraction)
        - cortex_user_intentions (chat-based extraction)
        """
        logger.info("Starting intention nudge job")
        sent = 0
        failed = 0

        from app.services.intention_service import IntentionService

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            push_service = PushService(db)

            for user in users:
                try:
                    # === 1. Check memory-based intentions (cortex_intentions) ===
                    service = IntentionService(db)
                    unfulfilled = await service.get_unfulfilled_intentions(user.id, min_days_old=2)

                    if unfulfilled:
                        intention = unfulfilled[0]
                        message = await service.get_nudge_message(intention)

                        result = await push_service.send_notification(
                            user_id=str(user.id),
                            title="You said you'd do this",
                            body=message,
                            data={
                                "type": "intention_nudge",
                                "intention_id": str(intention.id),
                                "total_unfulfilled": len(unfulfilled),
                            },
                        )

                        if result.get("sent", 0) > 0:
                            intention.reminder_count = (intention.reminder_count or 0) + 1
                            intention.last_reminded_at = datetime.utcnow()
                            await db.commit()
                            sent += 1
                        else:
                            failed += 1
                        continue  # Don't double-notify same user

                    # === 2. Check chat-based intentions (cortex_user_intentions) ===
                    chat_intentions = await db.execute(
                        text("""
                            SELECT id, action, subject, created_at,
                                   EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 as days_old
                            FROM cortex_user_intentions
                            WHERE user_id = :user_id
                            AND status = 'pending'
                            AND created_at < NOW() - INTERVAL '2 days'
                            AND (last_reminded_at IS NULL OR last_reminded_at < NOW() - INTERVAL '1 day')
                            ORDER BY created_at ASC
                            LIMIT 5
                        """),
                        {"user_id": str(user.id)}
                    )
                    chat_unfulfilled = chat_intentions.fetchall()

                    if chat_unfulfilled:
                        intent = chat_unfulfilled[0]
                        days_old = int(intent.days_old)

                        # Natural language nudge
                        if intent.subject:
                            body = f"Still planning to {intent.action}? ({days_old} days ago)"
                        else:
                            body = f"You wanted to {intent.action} ({days_old} days)"

                        result = await push_service.send_notification(
                            user_id=str(user.id),
                            title="Open loop",
                            body=body,
                            data={
                                "type": "intention_nudge",
                                "intention_id": str(intent.id),
                                "source": "chat",
                                "total_unfulfilled": len(chat_unfulfilled),
                            },
                        )

                        if result.get("sent", 0) > 0:
                            # Update last_reminded_at
                            await db.execute(
                                text("""
                                    UPDATE cortex_user_intentions
                                    SET last_reminded_at = NOW()
                                    WHERE id = :id
                                """),
                                {"id": str(intent.id)}
                            )
                            await db.commit()
                            sent += 1
                        else:
                            failed += 1

                except Exception as e:
                    logger.error(f"Error sending intention nudge to {user.id}: {e}")
                    failed += 1

        logger.info(f"Intention nudges complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    # ==================== BEHAVIORAL PATTERN JOBS ====================

    async def extract_behavioral_patterns(self) -> dict:
        """
        Extract behavioral patterns from user memories.
        Runs weekly (Sunday night) to detect patterns like:
        - "You always overcommit after a good week"
        - "When you're stressed, you stop responding to friends"
        """
        logger.info("Starting behavioral pattern extraction job")
        patterns_extracted = 0
        users_processed = 0

        from app.services.pattern_service import PatternService

        async with async_session_maker() as db:
            # Get users with enough memories for pattern extraction
            result = await db.execute(
                select(User)
                .join(Memory)
                .group_by(User.id)
                .having(func.count(Memory.id) >= 20)  # Need 20+ memories for patterns
            )
            users = list(result.scalars().all())

            logger.info(f"Extracting patterns for {len(users)} users")

            for user in users:
                try:
                    service = PatternService(db)
                    patterns = await service.extract_patterns_for_user(user.id)
                    patterns_extracted += len(patterns)
                    users_processed += 1
                except Exception as e:
                    logger.error(f"Error extracting patterns for user {user.id}: {e}")

        logger.info(f"Pattern extraction complete: {patterns_extracted} patterns for {users_processed} users")
        return {"patterns_extracted": patterns_extracted, "users_processed": users_processed}

    async def send_pattern_warnings(self) -> dict:
        """
        Send notifications when users are exhibiting pattern triggers.
        Runs twice daily to catch patterns in action.
        """
        logger.info("Starting pattern warning job")
        sent = 0
        failed = 0

        from app.services.pattern_service import PatternService

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            push_service = PushService(db)

            for user in users:
                try:
                    service = PatternService(db)

                    # Get recent memories (last 24 hours)
                    cutoff = datetime.utcnow() - timedelta(hours=24)
                    result = await db.execute(
                        select(Memory)
                        .where(Memory.user_id == user.id)
                        .where(Memory.memory_date >= cutoff)
                        .order_by(Memory.memory_date.desc())
                        .limit(10)
                    )
                    recent_memories = list(result.scalars().all())

                    if not recent_memories:
                        continue

                    # Check for active patterns
                    active_patterns = await service.analyze_current_situation(
                        user.id, recent_memories
                    )

                    # Find patterns that should warn
                    warnings = [p for p in active_patterns if p.get("should_warn")]

                    if not warnings:
                        continue

                    # Send warning for most relevant pattern
                    warning = warnings[0]
                    message = warning.get("warning_message") or f"I notice you're about to {warning.get('pattern_name')} again."

                    result = await push_service.send_notification(
                        user_id=str(user.id),
                        title="Pattern Alert",
                        body=message[:150],
                        data={
                            "type": "pattern_warning",
                            "pattern_name": warning.get("pattern_name"),
                        },
                    )

                    if result.get("sent", 0) > 0:
                        sent += 1
                    else:
                        failed += 1

                except Exception as e:
                    logger.error(f"Error checking patterns for {user.id}: {e}")
                    failed += 1

        logger.info(f"Pattern warnings complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    # ==================== AUTONOMOUS EMAIL JOBS ====================

    async def send_scheduled_emails(self) -> dict:
        """
        Send scheduled emails that are due.
        Runs every 1 minute.
        """
        logger.info("Checking for scheduled emails to send")
        sent = 0
        failed = 0

        from app.services.autonomous_email_service import AutonomousEmailService

        async with async_session_maker() as db:
            auto_email = AutonomousEmailService(db)
            pending = await auto_email.get_pending_scheduled_emails(within_minutes=2)

            for scheduled_email in pending:
                try:
                    success = await auto_email.send_scheduled_email(scheduled_email)
                    if success:
                        sent += 1
                        logger.info(f"Sent scheduled email {scheduled_email.id}")
                    else:
                        failed += 1
                except Exception as e:
                    logger.error(f"Error sending scheduled email {scheduled_email.id}: {e}")
                    failed += 1

        if sent > 0 or failed > 0:
            logger.info(f"Scheduled emails complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    async def process_snoozed_emails(self) -> dict:
        """
        Process snoozed emails that are due and send notifications.
        Runs every 5 minutes.
        """
        logger.info("Checking for snoozed emails due")
        sent = 0
        failed = 0

        from app.services.autonomous_email_service import AutonomousEmailService

        async with async_session_maker() as db:
            auto_email = AutonomousEmailService(db)
            push_service = PushService(db)
            due_emails = await auto_email.get_due_snoozed_emails(within_minutes=10)

            for snoozed in due_emails:
                try:
                    # Send notification
                    result = await push_service.send_notification(
                        user_id=str(snoozed.user_id),
                        title="Snoozed Email",
                        body=f"Time to look at: {snoozed.subject or 'Email from ' + (snoozed.sender or 'someone')}",
                        data={
                            "type": "snoozed_email",
                            "thread_id": snoozed.thread_id,
                            "subject": snoozed.subject,
                        },
                    )

                    if result.get("sent", 0) > 0:
                        await auto_email.mark_snoozed_notified(snoozed.id)
                        sent += 1
                    else:
                        failed += 1

                except Exception as e:
                    logger.error(f"Error processing snoozed email {snoozed.id}: {e}")
                    failed += 1

        if sent > 0 or failed > 0:
            logger.info(f"Snoozed email notifications: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    async def process_auto_followups(self) -> dict:
        """
        Process auto follow-up rules: check for replies and send follow-ups.
        Runs every 2 hours.
        """
        logger.info("Processing auto follow-up rules")
        actions = 0
        errors = 0

        from app.services.autonomous_email_service import AutonomousEmailService

        async with async_session_maker() as db:
            auto_email = AutonomousEmailService(db)
            rules = await auto_email.get_active_followup_rules()

            for rule in rules:
                try:
                    result = await auto_email.process_followup_rule(rule)
                    if result.get("action") in ["followup_sent", "reply_received"]:
                        actions += 1
                        logger.info(f"Auto follow-up {rule.id}: {result.get('action')}")
                except Exception as e:
                    logger.error(f"Error processing follow-up rule {rule.id}: {e}")
                    errors += 1

        if actions > 0 or errors > 0:
            logger.info(f"Auto follow-ups: {actions} actions, {errors} errors")
        return {"actions": actions, "errors": errors}

    async def generate_proactive_drafts(self) -> dict:
        """
        Generate proactive email drafts for important unanswered emails.
        Runs every 6 hours.
        """
        logger.info("Generating proactive email drafts")
        generated = 0
        errors = 0

        from app.services.autonomous_email_service import AutonomousEmailService
        from app.services.email_intelligence_service import EmailIntelligenceService
        from app.models.integration import ConnectedAccount
        from sqlalchemy import select, and_

        async with async_session_maker() as db:
            # Get users with Gmail connected
            result = await db.execute(
                select(ConnectedAccount).where(
                    and_(
                        ConnectedAccount.provider == "google",
                        ConnectedAccount.service == "gmail",
                        ConnectedAccount.status == "active",
                    )
                )
            )
            accounts = list(result.scalars().all())

            for account in accounts:
                try:
                    email_intel = EmailIntelligenceService(db)
                    auto_email = AutonomousEmailService(db)

                    # Get emails awaiting reply
                    awaiting = await email_intel.get_awaiting_replies(
                        user_id=account.user_id,
                        days_threshold=1,  # Important emails - just 1 day
                    )

                    emails = awaiting.get("awaiting_replies", [])[:2]  # Limit to 2 per user

                    for email_data in emails:
                        # Check if we already have a draft for this thread
                        thread_id = email_data.get("thread_id")
                        if not thread_id:
                            continue

                        # Generate draft
                        draft = await auto_email.generate_auto_draft(
                            user_id=account.user_id,
                            thread_id=thread_id,
                            priority=0.7 if email_data.get("days_without_reply", 0) >= 2 else 0.5,
                            reason=f"No reply for {email_data.get('days_without_reply', 0)} days",
                        )

                        if draft:
                            generated += 1

                except Exception as e:
                    logger.error(f"Error generating drafts for user {account.user_id}: {e}")
                    errors += 1

        if generated > 0 or errors > 0:
            logger.info(f"Proactive drafts: {generated} generated, {errors} errors")
        return {"generated": generated, "errors": errors}

    # ==================== RELATIONSHIP INTELLIGENCE JOBS ====================

    async def update_relationship_health(self) -> dict:
        """
        Update relationship health scores for all users.
        Runs daily at 4am.
        """
        logger.info("Starting relationship health update job")
        users_processed = 0
        relationships_updated = 0

        from app.services.relationship_intelligence_service import RelationshipIntelligenceService

        async with async_session_maker() as db:
            result = await db.execute(select(User).join(Memory).distinct())
            users = list(result.scalars().all())

            for user in users:
                try:
                    service = RelationshipIntelligenceService(db)
                    updated = await service.update_all_health_scores(user.id)
                    relationships_updated += updated
                    users_processed += 1
                except Exception as e:
                    logger.error(f"Error updating relationship health for {user.id}: {e}")

        logger.info(f"Relationship health update complete: {relationships_updated} relationships for {users_processed} users")
        return {"relationships_updated": relationships_updated, "users_processed": users_processed}

    async def send_reconnection_nudges(self) -> dict:
        """
        Send notifications about neglected relationships.
        Runs twice daily (10am and 6pm).
        """
        logger.info("Starting reconnection nudge job")
        sent = 0
        failed = 0

        from app.services.relationship_intelligence_service import RelationshipIntelligenceService

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            push_service = PushService(db)

            for user in users:
                try:
                    service = RelationshipIntelligenceService(db)
                    neglected = await service.get_neglected_relationships(user.id, limit=3)

                    if not neglected:
                        continue

                    # Get the most neglected relationship
                    top = neglected[0]
                    days = top.get("days_since_contact", 0)
                    name = top.get("name", "someone")

                    result = await push_service.send_notification(
                        user_id=str(user.id),
                        title=f"Reconnect with {name}?",
                        body=f"It's been {days} days since you last connected. They might appreciate hearing from you.",
                        data={
                            "type": "reconnection_nudge",
                            "entity_id": str(top.get("entity_id")),
                            "person_name": name,
                            "total_neglected": len(neglected),
                        },
                    )

                    if result.get("sent", 0) > 0:
                        # Update nudge tracking
                        await service.record_nudge_sent(top.get("relationship_id"))
                        sent += 1
                    else:
                        failed += 1

                except Exception as e:
                    logger.error(f"Error sending reconnection nudge to {user.id}: {e}")
                    failed += 1

        logger.info(f"Reconnection nudges complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    async def send_important_date_reminders(self) -> dict:
        """
        Send reminders for upcoming important dates (birthdays, anniversaries).
        Runs daily at 8am.
        """
        logger.info("Starting important date reminder job")
        sent = 0
        failed = 0

        from app.services.relationship_intelligence_service import RelationshipIntelligenceService

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            push_service = PushService(db)

            for user in users:
                try:
                    service = RelationshipIntelligenceService(db)
                    upcoming = await service.get_upcoming_important_dates(user.id, days_ahead=7)

                    if not upcoming:
                        continue

                    # Find dates that should be reminded today
                    today = datetime.utcnow().date()
                    for date_info in upcoming:
                        days_until = date_info.get("days_until", 0)
                        reminder_days = date_info.get("reminder_days_before", 3)

                        # Check if we should remind today
                        if days_until > reminder_days:
                            continue

                        # Check if already reminded
                        last_reminded = date_info.get("last_reminded")
                        if last_reminded:
                            reminded_date = last_reminded.date() if hasattr(last_reminded, 'date') else last_reminded
                            if reminded_date == today:
                                continue

                        name = date_info.get("person_name", "someone")
                        date_type = date_info.get("date_type", "special day")
                        date_label = date_info.get("date_label", date_type)

                        if days_until == 0:
                            title = f"Today is {name}'s {date_label}!"
                            body = "Don't forget to reach out!"
                        else:
                            title = f"{name}'s {date_label} in {days_until} day{'s' if days_until > 1 else ''}"
                            body = date_info.get("notes") or "Time to plan something special?"

                        result = await push_service.send_notification(
                            user_id=str(user.id),
                            title=title,
                            body=body[:150],
                            data={
                                "type": "important_date_reminder",
                                "date_id": str(date_info.get("id")),
                                "person_name": name,
                                "date_type": date_type,
                            },
                        )

                        if result.get("sent", 0) > 0:
                            await service.mark_date_reminded(date_info.get("id"))
                            sent += 1
                        else:
                            failed += 1

                except Exception as e:
                    logger.error(f"Error sending date reminder to {user.id}: {e}")
                    failed += 1

        logger.info(f"Important date reminders complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}

    async def log_interactions_from_memories(self) -> dict:
        """
        Extract interaction logs from recent memories.
        Runs every 2 hours.
        """
        logger.info("Starting interaction extraction job")
        interactions_logged = 0
        memories_processed = 0

        from app.services.relationship_intelligence_service import RelationshipIntelligenceService

        async with async_session_maker() as db:
            # Get memories from last 2 hours
            cutoff = datetime.utcnow() - timedelta(hours=2)
            result = await db.execute(
                select(Memory)
                .where(Memory.created_at >= cutoff)
                .order_by(Memory.created_at.desc())
                .limit(50)
            )
            memories = list(result.scalars().all())

            if not memories:
                logger.info("No recent memories to process for interactions")
                return {"memories_processed": 0, "interactions_logged": 0}

            for memory in memories:
                try:
                    service = RelationshipIntelligenceService(db)
                    interactions = await service.extract_interactions_from_memory(memory)
                    interactions_logged += len(interactions)
                    memories_processed += 1
                except Exception as e:
                    logger.error(f"Error extracting interactions from memory {memory.id}: {e}")

        logger.info(f"Interaction extraction complete: {interactions_logged} interactions from {memories_processed} memories")
        return {"interactions_logged": interactions_logged, "memories_processed": memories_processed}

    async def generate_relationship_insights(self) -> dict:
        """
        Generate AI insights about relationships.
        Runs daily at 5am.
        """
        logger.info("Starting relationship insights generation job")
        insights_generated = 0
        users_processed = 0

        from app.services.relationship_intelligence_service import RelationshipIntelligenceService

        async with async_session_maker() as db:
            result = await db.execute(
                select(User)
                .join(Memory)
                .group_by(User.id)
                .having(func.count(Memory.id) >= 10)
            )
            users = list(result.scalars().all())

            for user in users:
                try:
                    service = RelationshipIntelligenceService(db)
                    insights = await service.generate_relationship_insights(user.id)
                    insights_generated += len(insights)
                    users_processed += 1
                except Exception as e:
                    logger.error(f"Error generating relationship insights for {user.id}: {e}")

        logger.info(f"Relationship insights complete: {insights_generated} insights for {users_processed} users")
        return {"insights_generated": insights_generated, "users_processed": users_processed}

    async def send_promise_reminders(self) -> dict:
        """
        Send reminders for pending promises.
        Runs daily at 9am.
        """
        logger.info("Starting promise reminder job")
        sent = 0
        failed = 0

        from app.services.relationship_intelligence_service import RelationshipIntelligenceService

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            push_service = PushService(db)

            for user in users:
                try:
                    service = RelationshipIntelligenceService(db)
                    pending = await service.get_pending_promises(user.id, limit=5)

                    # Filter for overdue or soon-due promises
                    today = datetime.utcnow().date()
                    urgent = []
                    for promise in pending:
                        due_date = promise.get("due_date")
                        if due_date:
                            if isinstance(due_date, str):
                                due_date = datetime.fromisoformat(due_date).date()
                            days_until = (due_date - today).days
                            if days_until <= 3:  # Due within 3 days
                                promise["days_until"] = days_until
                                urgent.append(promise)

                    if not urgent:
                        continue

                    # Send reminder for most urgent
                    top = urgent[0]
                    name = top.get("person_name", "someone")
                    description = top.get("description", "something")
                    days_until = top.get("days_until", 0)

                    if days_until < 0:
                        title = f"Overdue promise to {name}"
                        body = f"You said you'd {description[:50]}... It's past due!"
                    elif days_until == 0:
                        title = f"Promise to {name} due today"
                        body = f"You said you'd {description[:50]}..."
                    else:
                        title = f"Promise to {name} due in {days_until} day{'s' if days_until > 1 else ''}"
                        body = f"You said you'd {description[:50]}..."

                    result = await push_service.send_notification(
                        user_id=str(user.id),
                        title=title,
                        body=body[:150],
                        data={
                            "type": "promise_reminder",
                            "promise_id": str(top.get("id")),
                            "person_name": name,
                            "total_pending": len(pending),
                        },
                    )

                    if result.get("sent", 0) > 0:
                        await service.record_promise_reminder(top.get("id"))
                        sent += 1
                    else:
                        failed += 1

                except Exception as e:
                    logger.error(f"Error sending promise reminder to {user.id}: {e}")
                    failed += 1

        logger.info(f"Promise reminders complete: {sent} sent, {failed} failed")
        return {"sent": sent, "failed": failed}


    # ==================== PROACTIVE ORCHESTRATOR INTEGRATION ====================

    async def process_proactive_notifications(self) -> dict:
        """
        Main orchestrator job - processes all queued notifications.
        Runs every 15 minutes.

        This replaces direct notification sending with the orchestrated approach.
        """
        logger.info("Starting proactive notification orchestrator")

        from app.services.proactive_orchestrator import ProactiveOrchestrator

        async with async_session_maker() as db:
            orchestrator = ProactiveOrchestrator(db)

            # First, re-queue any snoozed notifications that are now due
            requeued = await orchestrator.process_snoozed_notifications()

            # Process all users
            stats = await orchestrator.process_all_users()

            stats["snoozed_requeued"] = requeued

        logger.info(f"Proactive orchestrator complete: {stats}")
        return stats

    async def queue_urgent_emails(self) -> dict:
        """
        Scan for urgent emails and queue for notification.
        Runs every 30 minutes.
        """
        logger.info("Scanning for urgent emails")

        from app.services.email_urgency_service import EmailUrgencyService

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            total_queued = 0

            for user in users:
                try:
                    service = EmailUrgencyService(db)
                    result = await service.scan_and_queue_urgent_emails(user.id)
                    total_queued += result.get("queued", 0)
                except Exception as e:
                    logger.error(f"Error scanning emails for {user.id}: {e}")

        logger.info(f"Urgent email scan complete: {total_queued} queued")
        return {"queued": total_queued}

    async def queue_meeting_preps(self) -> dict:
        """
        Scan for upcoming meetings and queue prep notifications.
        Runs every 10 minutes.
        """
        logger.info("Scanning for upcoming meetings")

        from app.services.meeting_prep_service import MeetingPrepService
        from app.models.notification_preferences import NotificationPreferences

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            total_queued = 0

            for user in users:
                try:
                    # Get user's preferred prep time
                    result = await db.execute(
                        select(NotificationPreferences).where(
                            NotificationPreferences.user_id == user.id
                        )
                    )
                    prefs = result.scalar_one_or_none()
                    minutes_before = prefs.meeting_prep_minutes_before if prefs else 30

                    service = MeetingPrepService(db)
                    result = await service.scan_and_queue_meeting_preps(
                        user.id,
                        minutes_before=minutes_before,
                    )
                    total_queued += result.get("queued", 0)
                except Exception as e:
                    logger.error(f"Error scanning meetings for {user.id}: {e}")

        logger.info(f"Meeting prep scan complete: {total_queued} queued")
        return {"queued": total_queued}

    async def queue_commitment_reminders(self) -> dict:
        """
        Scan for due/overdue commitments and queue notifications.
        Runs twice daily (morning and evening).
        """
        logger.info("Scanning for due commitments")

        from app.services.commitment_service import CommitmentService

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            total_queued = 0

            for user in users:
                try:
                    service = CommitmentService(db)
                    result = await service.scan_and_queue_commitment_notifications(user.id)
                    total_queued += result.get("queued", 0)
                except Exception as e:
                    logger.error(f"Error scanning commitments for {user.id}: {e}")

        logger.info(f"Commitment scan complete: {total_queued} queued")
        return {"queued": total_queued}

    async def queue_morning_briefings(self) -> dict:
        """
        Queue morning briefings for all users.
        Runs at configured morning time.
        """
        logger.info("Queueing morning briefings")

        from app.services.proactive_orchestrator import (
            ProactiveOrchestrator,
            QueuedNotification,
            NotificationType,
            UrgencyLevel,
        )

        queued = 0

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            briefing_service = BriefingService(db)
            orchestrator = ProactiveOrchestrator(db)

            for user in users:
                try:
                    content = await briefing_service.generate_morning_briefing(
                        str(user.id)
                    )

                    lines = content.strip().split("\n")
                    title = lines[0] if lines else "Good morning"
                    body = "\n".join(lines[1:4]).strip() if len(lines) > 1 else ""

                    notification = QueuedNotification(
                        notification_type=NotificationType.MORNING_BRIEFING,
                        title=title,
                        body=body[:150],
                        user_id=user.id,
                        urgency_level=UrgencyLevel.MEDIUM,
                        source_service="briefing_service",
                        data={
                            "type": "briefing",
                            "briefing_type": "morning",
                            "full_content": content,
                        },
                    )

                    await orchestrator.queue_notification(notification)
                    queued += 1

                except Exception as e:
                    logger.error(f"Error queueing morning briefing for {user.id}: {e}")

        logger.info(f"Morning briefings queued: {queued}")
        return {"queued": queued}

    async def queue_evening_briefings(self) -> dict:
        """
        Queue evening briefings for all users.
        Runs at configured evening time.
        """
        logger.info("Queueing evening briefings")

        from app.services.proactive_orchestrator import (
            ProactiveOrchestrator,
            QueuedNotification,
            NotificationType,
            UrgencyLevel,
        )

        queued = 0

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            briefing_service = BriefingService(db)
            orchestrator = ProactiveOrchestrator(db)

            for user in users:
                try:
                    content = await briefing_service.generate_evening_briefing(
                        str(user.id)
                    )

                    lines = content.strip().split("\n")
                    title = lines[0] if lines else "Good evening"
                    body = "\n".join(lines[1:4]).strip() if len(lines) > 1 else ""

                    notification = QueuedNotification(
                        notification_type=NotificationType.EVENING_BRIEFING,
                        title=title,
                        body=body[:150],
                        user_id=user.id,
                        urgency_level=UrgencyLevel.LOW,
                        source_service="briefing_service",
                        data={
                            "type": "briefing",
                            "briefing_type": "evening",
                            "full_content": content,
                        },
                    )

                    await orchestrator.queue_notification(notification)
                    queued += 1

                except Exception as e:
                    logger.error(f"Error queueing evening briefing for {user.id}: {e}")

        logger.info(f"Evening briefings queued: {queued}")
        return {"queued": queued}

    async def queue_pattern_warnings(self) -> dict:
        """
        Check for active patterns and queue warnings via orchestrator.
        Runs twice daily.
        """
        logger.info("Scanning for pattern warnings")

        from app.services.pattern_service import PatternService
        from app.services.proactive_orchestrator import (
            ProactiveOrchestrator,
            QueuedNotification,
            NotificationType,
            UrgencyLevel,
        )

        queued = 0

        async with async_session_maker() as db:
            users = await self._get_users_with_notifications(db)
            orchestrator = ProactiveOrchestrator(db)

            for user in users:
                try:
                    service = PatternService(db)

                    # Get recent memories
                    cutoff = datetime.utcnow() - timedelta(hours=24)
                    result = await db.execute(
                        select(Memory)
                        .where(Memory.user_id == user.id)
                        .where(Memory.memory_date >= cutoff)
                        .order_by(Memory.memory_date.desc())
                        .limit(10)
                    )
                    recent_memories = list(result.scalars().all())

                    if not recent_memories:
                        continue

                    # Check for active patterns
                    active_patterns = await service.analyze_current_situation(
                        user.id, recent_memories
                    )

                    # Queue warnings for patterns that should warn
                    for pattern in active_patterns:
                        if not pattern.get("should_warn"):
                            continue

                        message = pattern.get("warning_message") or f"I notice you're about to {pattern.get('pattern_name')} again."

                        notification = QueuedNotification(
                            notification_type=NotificationType.PATTERN_WARNING,
                            title="⚡ Pattern Alert",
                            body=message[:150],
                            user_id=user.id,
                            urgency_level=UrgencyLevel.MEDIUM,
                            source_service="pattern_service",
                            data={
                                "type": "pattern_warning",
                                "pattern_name": pattern.get("pattern_name"),
                                "confidence": pattern.get("confidence", 0),
                            },
                            confidence_score=pattern.get("confidence", 0),
                        )

                        await orchestrator.queue_notification(notification)
                        queued += 1

                except Exception as e:
                    logger.error(f"Error checking patterns for {user.id}: {e}")

        logger.info(f"Pattern warnings queued: {queued}")
        return {"queued": queued}

    # === AUTONOMOUS ACTIONS JOBS ===

    async def generate_autonomous_actions(self) -> dict:
        """Generate autonomous action suggestions for active users."""
        logger.info("Starting autonomous actions generation job")
        generated = 0
        errors = 0

        async with async_session_maker() as db:
            # Get users who were active in the last 24 hours
            result = await db.execute(
                select(User)
                .join(PushToken)
                .where(PushToken.is_active == True)
                .distinct()
            )
            users = result.scalars().all()

            logger.info(f"Generating autonomous actions for {len(users)} users")

            from app.services.autonomous_action_service import AutonomousActionService

            for user in users:
                try:
                    service = AutonomousActionService(db)
                    actions = await service.generate_actions(user.id)
                    generated += len(actions)
                except Exception as e:
                    logger.error(f"Error generating actions for {user.id}: {e}")
                    errors += 1

        logger.info(f"Autonomous actions generated: {generated}, errors: {errors}")
        return {"generated": generated, "errors": errors}

    async def expire_autonomous_actions(self) -> dict:
        """Expire old autonomous actions that were not actioned."""
        logger.info("Starting autonomous actions expiry job")

        async with async_session_maker() as db:
            from app.services.autonomous_action_service import AutonomousActionService
            service = AutonomousActionService(db)
            expired_count = await service.expire_old_actions()

        logger.info(f"Autonomous actions expired: {expired_count}")
        return {"expired": expired_count}


# Create singleton instance for scheduler jobs
scheduler_service = SchedulerService()
