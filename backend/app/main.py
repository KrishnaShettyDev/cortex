from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import sentry_sdk
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import get_settings
from app.database import init_db
from app.api import auth, memories, chat, integrations, upload, notifications, people, connections, feedback, reminders, advanced, reviews, context, emotions, autobiography, intentions, patterns, benchmark, smart_rescheduling, autonomous_actions
from app.services.scheduler_service import scheduler_service
from app.services.intelligence_implementations import set_composio_toolset
from app.rate_limiter import limiter

logger = logging.getLogger(__name__)

settings = get_settings()

# Initialize Sentry if DSN is provided
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        traces_sample_rate=0.1,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    await init_db()

    # Initialize Composio toolset for intelligence services
    if settings.composio_api_key:
        try:
            from composio import ComposioToolSet
            toolset = ComposioToolSet(api_key=settings.composio_api_key)
            set_composio_toolset(toolset, settings.composio_api_key)
            logger.info("Composio toolset initialized for intelligence services")
        except Exception as e:
            logger.warning(f"Failed to initialize Composio toolset: {e}")

    # Initialize scheduler for notifications
    scheduler = AsyncIOScheduler()

    # Morning briefings at 8am
    scheduler.add_job(
        scheduler_service.send_morning_briefings,
        CronTrigger(hour=8, minute=0),
        id="morning_briefings",
        name="Send morning briefings",
    )

    # Evening briefings at 6pm
    scheduler.add_job(
        scheduler_service.send_evening_briefings,
        CronTrigger(hour=18, minute=0),
        id="evening_briefings",
        name="Send evening briefings",
    )

    # Smart reminders every 5 minutes
    scheduler.add_job(
        scheduler_service.check_and_send_reminders,
        CronTrigger(minute="*/5"),
        id="smart_reminders",
        name="Check and send smart reminders",
    )

    # Memory insights at 10am
    scheduler.add_job(
        scheduler_service.send_memory_insights,
        CronTrigger(hour=10, minute=0),
        id="memory_insights",
        name="Send memory insights",
    )

    # Connection notifications - check twice daily (morning and evening)
    scheduler.add_job(
        scheduler_service.send_connection_notifications,
        CronTrigger(hour="9,18", minute=30),
        id="connection_notifications",
        name="Send connection notifications",
    )

    # Meeting prep notifications every 15 minutes
    scheduler.add_job(
        scheduler_service.send_meeting_prep_notifications,
        CronTrigger(minute="*/15"),
        id="meeting_prep_notifications",
        name="Send meeting preparation notifications",
    )

    # Update person profiles daily at 2am
    scheduler.add_job(
        scheduler_service.update_person_profiles,
        CronTrigger(hour=2, minute=0),
        id="update_person_profiles",
        name="Update person profiles",
    )

    # === ADAPTIVE LEARNING JOBS ===

    # Memory decay - run daily at 3am (after profile updates)
    scheduler.add_job(
        scheduler_service.apply_memory_decay,
        CronTrigger(hour=3, minute=0),
        id="memory_decay",
        name="Apply memory strength decay",
    )

    # Pattern extraction - run daily at 4am
    scheduler.add_job(
        scheduler_service.extract_user_patterns,
        CronTrigger(hour=4, minute=0),
        id="pattern_extraction",
        name="Extract patterns and generate insights",
    )

    # Emotional weight analysis for new memories - every 6 hours
    scheduler.add_job(
        scheduler_service.analyze_emotional_weights,
        CronTrigger(hour="*/6", minute=30),
        id="emotional_analysis",
        name="Analyze emotional weights for recent memories",
    )

    # === ADVANCED MEMORY FEATURES ===

    # Memory consolidation - run weekly at 2am Sunday
    scheduler.add_job(
        scheduler_service.consolidate_memories,
        CronTrigger(day_of_week="sun", hour=2, minute=0),
        id="memory_consolidation",
        name="Consolidate similar memories",
    )

    # Temporal pattern detection - run weekly at 3am Sunday
    scheduler.add_job(
        scheduler_service.detect_temporal_patterns,
        CronTrigger(day_of_week="sun", hour=3, minute=0),
        id="temporal_patterns",
        name="Detect temporal patterns in memories",
    )

    # Initialize spaced repetition - run daily at 5am
    scheduler.add_job(
        scheduler_service.initialize_spaced_repetition,
        CronTrigger(hour=5, minute=0),
        id="spaced_repetition_init",
        name="Initialize spaced repetition for new memories",
    )

    # Decision outcome tracking - run weekly at 10am Monday
    scheduler.add_job(
        scheduler_service.check_decision_outcomes,
        CronTrigger(day_of_week="mon", hour=10, minute=0),
        id="decision_outcomes",
        name="Check for decisions needing outcome tracking",
    )

    # === PROSPECTIVE MEMORY JOBS ===

    # Process intentions (update statuses, scan fulfillment) - every hour
    scheduler.add_job(
        scheduler_service.process_intentions,
        CronTrigger(minute=30),  # 30 minutes past every hour
        id="process_intentions",
        name="Process user intentions",
    )

    # Send intention nudges - twice daily (9am and 7pm)
    scheduler.add_job(
        scheduler_service.send_intention_nudges,
        CronTrigger(hour="9,19", minute=0),
        id="intention_nudges",
        name="Send intention reminder nudges",
    )

    # === BEHAVIORAL PATTERN JOBS ===

    # Extract behavioral patterns - weekly Sunday at 1am
    scheduler.add_job(
        scheduler_service.extract_behavioral_patterns,
        CronTrigger(day_of_week="sun", hour=1, minute=0),
        id="behavioral_patterns",
        name="Extract behavioral patterns from memories",
    )

    # Send pattern warnings - twice daily (11am and 8pm)
    scheduler.add_job(
        scheduler_service.send_pattern_warnings,
        CronTrigger(hour="11,20", minute=0),
        id="pattern_warnings",
        name="Send pattern trigger warnings",
    )

    # === REAL-TIME SYNC JOBS ===

    # Auto-sync Gmail every 5 minutes
    scheduler.add_job(
        scheduler_service.sync_gmail_all_users,
        CronTrigger(minute="*/5"),
        id="auto_sync_gmail",
        name="Auto-sync Gmail for all users",
    )

    # Auto-sync Calendar every 5 minutes
    scheduler.add_job(
        scheduler_service.sync_calendar_all_users,
        CronTrigger(minute="*/5"),
        id="auto_sync_calendar",
        name="Auto-sync Calendar for all users",
    )

    # Create memories from calendar events - daily at 6am
    scheduler.add_job(
        scheduler_service.process_calendar_memories,
        CronTrigger(hour=6, minute=0),
        id="calendar_memories",
        name="Create memories from calendar events",
    )

    # === AUTONOMOUS EMAIL JOBS ===

    # Send scheduled emails - every 1 minute
    scheduler.add_job(
        scheduler_service.send_scheduled_emails,
        CronTrigger(minute="*"),
        id="send_scheduled_emails",
        name="Send scheduled emails",
    )

    # Process snoozed emails - every 5 minutes
    scheduler.add_job(
        scheduler_service.process_snoozed_emails,
        CronTrigger(minute="*/5"),
        id="process_snoozed_emails",
        name="Process snoozed email reminders",
    )

    # Process auto follow-ups - every 2 hours
    scheduler.add_job(
        scheduler_service.process_auto_followups,
        CronTrigger(hour="*/2", minute=15),
        id="process_auto_followups",
        name="Process automatic email follow-ups",
    )

    # Generate proactive drafts - every 6 hours
    scheduler.add_job(
        scheduler_service.generate_proactive_drafts,
        CronTrigger(hour="*/6", minute=45),
        id="generate_proactive_drafts",
        name="Generate proactive email drafts",
    )

    # === RELATIONSHIP INTELLIGENCE JOBS ===

    # Update relationship health scores - daily at 4am
    scheduler.add_job(
        scheduler_service.update_relationship_health,
        CronTrigger(hour=4, minute=30),
        id="update_relationship_health",
        name="Update relationship health scores",
    )

    # Send reconnection nudges - twice daily (10am and 6pm)
    scheduler.add_job(
        scheduler_service.send_reconnection_nudges,
        CronTrigger(hour="10,18", minute=0),
        id="reconnection_nudges",
        name="Send reconnection nudges",
    )

    # Send important date reminders - daily at 8am
    scheduler.add_job(
        scheduler_service.send_important_date_reminders,
        CronTrigger(hour=8, minute=15),
        id="important_date_reminders",
        name="Send important date reminders",
    )

    # Log interactions from memories - every 2 hours
    scheduler.add_job(
        scheduler_service.log_interactions_from_memories,
        CronTrigger(hour="*/2", minute=20),
        id="log_interactions",
        name="Extract interactions from memories",
    )

    # Generate relationship insights - daily at 5am
    scheduler.add_job(
        scheduler_service.generate_relationship_insights,
        CronTrigger(hour=5, minute=15),
        id="relationship_insights",
        name="Generate relationship insights",
    )

    # Send promise reminders - daily at 9am
    scheduler.add_job(
        scheduler_service.send_promise_reminders,
        CronTrigger(hour=9, minute=15),
        id="promise_reminders",
        name="Send promise reminders",
    )

    # === PROACTIVE ORCHESTRATOR JOBS ===
    # These coordinate all notifications through a central system
    # that respects daily budgets, quiet hours, and consolidation

    # Main orchestrator - processes queued notifications every 15 minutes
    scheduler.add_job(
        scheduler_service.process_proactive_notifications,
        CronTrigger(minute="*/15"),
        id="proactive_orchestrator",
        name="Process proactive notification queue",
    )

    # Queue urgent emails - every 30 minutes
    scheduler.add_job(
        scheduler_service.queue_urgent_emails,
        CronTrigger(minute="5,35"),
        id="queue_urgent_emails",
        name="Scan and queue urgent email notifications",
    )

    # Queue meeting preps - every 10 minutes
    scheduler.add_job(
        scheduler_service.queue_meeting_preps,
        CronTrigger(minute="*/10"),
        id="queue_meeting_preps",
        name="Scan and queue meeting prep notifications",
    )

    # Queue commitment reminders - twice daily (8am and 5pm)
    scheduler.add_job(
        scheduler_service.queue_commitment_reminders,
        CronTrigger(hour="8,17", minute=0),
        id="queue_commitments",
        name="Scan and queue commitment reminders",
    )

    # Queue morning briefings - at 7:45am (processed by orchestrator at 8:00)
    scheduler.add_job(
        scheduler_service.queue_morning_briefings,
        CronTrigger(hour=7, minute=45),
        id="queue_morning_briefings",
        name="Queue morning briefings",
    )

    # Queue evening briefings - at 5:45pm (processed by orchestrator at 6:00)
    scheduler.add_job(
        scheduler_service.queue_evening_briefings,
        CronTrigger(hour=17, minute=45),
        id="queue_evening_briefings",
        name="Queue evening briefings",
    )

    # Queue pattern warnings - twice daily (10:45am and 7:45pm)
    scheduler.add_job(
        scheduler_service.queue_pattern_warnings,
        CronTrigger(hour="10,19", minute=45),
        id="queue_pattern_warnings",
        name="Scan and queue pattern warnings",
    )

    # === AUTONOMOUS ACTIONS JOBS ===

    # Generate autonomous actions - every 30 minutes
    scheduler.add_job(
        scheduler_service.generate_autonomous_actions,
        CronTrigger(minute="10,40"),  # At 10 and 40 minutes past each hour
        id="generate_autonomous_actions",
        name="Generate autonomous action suggestions",
    )

    # Expire old autonomous actions - hourly
    scheduler.add_job(
        scheduler_service.expire_autonomous_actions,
        CronTrigger(minute=55),  # At 55 minutes past each hour
        id="expire_autonomous_actions",
        name="Expire old autonomous actions",
    )

    scheduler.start()
    logger.info("Notification scheduler started with proactive orchestrator, advanced memory, autonomous email, and relationship intelligence features")

    yield

    # Shutdown
    scheduler.shutdown()
    logger.info("Notification scheduler stopped")


app = FastAPI(
    title="Cortex API",
    description="Your second brain - API for capturing, storing, and recalling memories",
    version="1.0.0",
    lifespan=lifespan,
    # Disable docs in production for security
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url="/redoc" if settings.environment == "development" else None,
    openapi_url="/openapi.json" if settings.environment == "development" else None,
)

# Add rate limiter to app state
app.state.limiter = limiter

# Custom rate limit exceeded handler
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Please slow down.",
            "retry_after": exc.detail,
        },
    )

# CORS middleware - configured based on environment
# In development: allows localhost origins
# In production: requires CORS_ALLOWED_ORIGINS env var
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# Include routers
app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(memories.router, prefix="/memories", tags=["Memories"])
app.include_router(chat.router, prefix="/chat", tags=["Chat"])
app.include_router(integrations.router, prefix="/integrations", tags=["Integrations"])
app.include_router(upload.router, prefix="/upload", tags=["Upload"])
app.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
app.include_router(people.router, prefix="/people", tags=["People"])
app.include_router(connections.router, prefix="/connections", tags=["Connections"])
app.include_router(feedback.router, tags=["Feedback & Learning"])
app.include_router(reminders.router, prefix="/reminders", tags=["Reminders & Tasks"])
app.include_router(advanced.router, prefix="/advanced", tags=["Advanced Memory Features"])
app.include_router(reviews.router, prefix="/reviews", tags=["Spaced Repetition"])
app.include_router(context.router, prefix="/context", tags=["Memory Context"])
app.include_router(emotions.router, prefix="/emotions", tags=["Emotional Analysis"])
app.include_router(autobiography.router, prefix="/autobiography", tags=["Life Timeline"])
app.include_router(intentions.router, prefix="/intentions", tags=["Prospective Memory"])
app.include_router(patterns.router, prefix="/patterns", tags=["Behavioral Patterns"])
app.include_router(benchmark.router, tags=["Benchmark"])
app.include_router(smart_rescheduling.router, tags=["Smart Rescheduling"])
app.include_router(autonomous_actions.router, tags=["Autonomous Actions"])


@app.get("/health")
@limiter.exempt  # Health checks should not be rate limited
async def health_check(request: Request):
    """Health check endpoint."""
    return {"status": "healthy", "version": "1.0.0"}


# Export limiter for use in route files
def get_limiter():
    return limiter
