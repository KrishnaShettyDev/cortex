from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import sentry_sdk
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import get_settings
from app.database import init_db
from app.api import auth, memories, chat, integrations, upload, notifications, people, connections, feedback, reminders
from app.services.scheduler_service import scheduler_service

logger = logging.getLogger(__name__)

settings = get_settings()

# Rate limiter configuration
# Uses client IP for rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/minute"],  # Default rate limit
    storage_uri="memory://",  # In-memory storage (use Redis for production scaling)
    strategy="fixed-window",
)

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

    scheduler.start()
    logger.info("Notification scheduler started with real-time sync enabled")

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


@app.get("/health")
@limiter.exempt  # Health checks should not be rate limited
async def health_check(request: Request):
    """Health check endpoint."""
    return {"status": "healthy", "version": "1.0.0"}


# Export limiter for use in route files
def get_limiter():
    return limiter
