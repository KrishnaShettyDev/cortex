"""Service for orchestrating scheduled notification jobs."""

import logging
from sqlalchemy import select, func
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
                    await connection_service.mark_notified([c.id for c in connections])

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


# Create singleton instance for scheduler jobs
scheduler_service = SchedulerService()
