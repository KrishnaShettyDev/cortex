from uuid import UUID
from fastapi import APIRouter, HTTPException, status, Query, Path, Request

from app.api.deps import Database, CurrentUser
from app.services.sync_service import SyncService
from datetime import datetime, timedelta

from app.schemas.integration import (
    IntegrationsStatusResponse,
    IntegrationStatus,
    OAuthRedirectResponse,
    SyncRequest,
    SyncResponse,
    CreateCalendarEventRequest,
    UpdateCalendarEventRequest,
    CalendarEventResponse,
    CalendarEventsResponse,
    CalendarEventItem,
    SendEmailRequest,
    EmailResponse,
)

router = APIRouter()


@router.get("/status", response_model=IntegrationsStatusResponse)
async def get_integrations_status(
    current_user: CurrentUser,
    db: Database,
):
    """
    Get the connection status of all integrations.
    """
    sync_service = SyncService(db)
    status_dict = await sync_service.get_connection_status(current_user.id)

    return IntegrationsStatusResponse(
        google=IntegrationStatus(**status_dict["google"]),
        microsoft=IntegrationStatus(**status_dict["microsoft"]),
    )


@router.get("/google/connect", response_model=OAuthRedirectResponse)
async def connect_google(
    request: Request,
    current_user: CurrentUser,
    db: Database,
    service: str = Query(default="googlesuper", description="Service to connect (googlesuper for unified Google access)"),
    app_return_url: str = Query(default=None, description="Deep link URL to return to app after OAuth"),
):
    """
    Get the OAuth URL for connecting Google account.

    Uses 'googlesuper' for unified access to Gmail, Calendar, Drive, and
    all other Google services with a single OAuth flow.

    The mobile app should open this URL in a browser for the user
    to authorize access.
    """
    # Build backend callback URL dynamically
    base_url = str(request.base_url).rstrip("/")
    callback_url = f"{base_url}/integrations/google/callback"

    sync_service = SyncService(db)

    try:
        oauth_url = await sync_service.get_oauth_url(
            user_id=current_user.id,
            provider="google",
            redirect_url=callback_url,
            service="googlesuper",  # Always use unified googlesuper
            app_return_url=app_return_url,  # Pass through for final redirect
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except Exception as e:
        print(f"Unexpected error in connect_google: {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to initialize OAuth: {str(e)}",
        )

    return OAuthRedirectResponse(redirect_url=oauth_url)


@router.get("/google/callback")
async def google_oauth_callback(
    request: Request,
    db: Database,
    # Composio callback parameters
    status: str = Query(default=None),
    connectedAccountId: str = Query(default=None),
    appName: str = Query(default=None),
    # Legacy/state parameters
    code: str = Query(default=None),
    state: str = Query(default=None),
):
    """
    Handle the OAuth callback from Composio.

    With googlesuper, a single OAuth flow connects Gmail, Calendar, Drive, etc.
    Composio returns: ?status=success&connectedAccountId=xxx&appName=googlesuper
    """
    from fastapi.responses import HTMLResponse, RedirectResponse
    import base64
    import json as json_module

    # Debug: Log callback parameters
    print(f"=== OAuth Callback Hit ===")
    print(f"  status: {status}")
    print(f"  connectedAccountId: {connectedAccountId}")
    print(f"  appName: {appName}")
    print(f"  full URL: {request.url}")

    user_id = None
    # Use appName from Composio, normalize to googlesuper
    service = appName or "googlesuper"
    if service in ("gmail", "googlecalendar", "calendar"):
        service = "googlesuper"
    app_return_url = "cortex://oauth/success"  # Default fallback

    # Try to extract user_id from state (if provided)
    if state:
        try:
            try:
                decoded = base64.b64decode(state).decode('utf-8')
                state_data = json_module.loads(decoded)
                user_id = state_data.get('user_id')
                # Always use googlesuper regardless of what's in state
                app_return_url = state_data.get('app_return_url', app_return_url)
                print(f"  Decoded state: user_id={user_id}, service={service}")
            except:
                from uuid import UUID as UUIDType
                user_id = str(UUIDType(state))
                print(f"  Parsed as plain UUID: {user_id}")
        except Exception as e:
            print(f"Failed to parse state: {e}")

    # If no user_id from state, try to get it from Composio connection
    connection_saved = False
    if connectedAccountId and status == "success":
        try:
            sync_service = SyncService(db)
            # Get user_id from Composio connection's entity
            account = await sync_service.handle_oauth_callback_by_connection_id(
                connected_account_id=connectedAccountId,
                provider="google",
                service=service,  # 'googlesuper' for unified access
            )
            connection_saved = account is not None
            if account:
                user_id = str(account.user_id)
            print(f"OAuth callback: {service} connection saved: {connection_saved}, user_id: {user_id}")
        except Exception as e:
            print(f"Error handling OAuth callback: {e}")
            import traceback
            traceback.print_exc()
    elif user_id:
        # Fallback to old method if we have user_id from state
        try:
            sync_service = SyncService(db)
            account = await sync_service.handle_oauth_callback(
                user_id=UUID(str(user_id)),
                provider="google",
                service=service,
            )
            connection_saved = account is not None
            print(f"OAuth callback (legacy): {service} connection saved: {connection_saved}")
        except Exception as e:
            print(f"Error handling OAuth callback: {e}")

    # With googlesuper, everything is connected in one flow - show success page
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Google Connected</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            * {{ box-sizing: border-box; }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                background: #0A0A0A;
                color: white;
            }}
            .container {{
                text-align: center;
                padding: 32px 24px;
                max-width: 340px;
                width: 100%;
            }}
            .icon-container {{
                width: 88px;
                height: 88px;
                margin: 0 auto 28px;
                background: linear-gradient(135deg, #7DD3C0 0%, #A78BFA 50%, #F472B6 100%);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 0 60px rgba(167, 139, 250, 0.4);
                animation: pulse 2s ease-in-out infinite;
            }}
            @keyframes pulse {{
                0%, 100% {{ box-shadow: 0 0 40px rgba(167, 139, 250, 0.3); }}
                50% {{ box-shadow: 0 0 60px rgba(167, 139, 250, 0.5); }}
            }}
            .checkmark {{
                font-size: 40px;
                color: #0A0A0A;
            }}
            h1 {{
                margin: 0 0 8px 0;
                font-size: 26px;
                font-weight: 600;
                color: #FFFFFF;
            }}
            p {{
                color: #8E8E93;
                margin: 0 0 36px 0;
                font-size: 15px;
                line-height: 1.5;
            }}
            .btn {{
                display: inline-block;
                padding: 14px 32px;
                background: linear-gradient(135deg, #7DD3C0 0%, #A78BFA 50%, #F472B6 100%);
                color: #0A0A0A;
                text-decoration: none;
                border-radius: 14px;
                font-weight: 600;
                font-size: 16px;
                transition: transform 0.2s, box-shadow 0.2s;
            }}
            .btn:active {{
                transform: scale(0.98);
            }}
            .progress-container {{
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 16px;
                padding: 16px 20px;
                margin-bottom: 32px;
            }}
            .progress-item {{
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 6px 0;
            }}
            .progress-icon {{
                width: 28px;
                height: 28px;
                border-radius: 8px;
                background: rgba(52, 199, 89, 0.15);
                color: #34C759;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 13px;
            }}
            .progress-text {{
                flex: 1;
                text-align: left;
                font-size: 15px;
                color: #FFFFFF;
            }}
            .auto-redirect {{
                margin-top: 24px;
                font-size: 13px;
                color: #48484A;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon-container">
                <span class="checkmark">✓</span>
            </div>
            <h1>All Set!</h1>
            <p>Google account connected successfully.</p>
            <div class="progress-container">
                <div class="progress-item">
                    <div class="progress-icon">✓</div>
                    <span class="progress-text">Gmail</span>
                </div>
                <div class="progress-item">
                    <div class="progress-icon">✓</div>
                    <span class="progress-text">Google Calendar</span>
                </div>
                <div class="progress-item">
                    <div class="progress-icon">✓</div>
                    <span class="progress-text">Google Drive</span>
                </div>
            </div>
            <a href="{app_return_url}" class="btn">Return to Cortex</a>
            <p class="auto-redirect">Redirecting automatically...</p>
        </div>
        <script>
            setTimeout(function() {{
                window.location.href = '{app_return_url}';
            }}, 2500);
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)


@router.delete("/google")
async def disconnect_google(
    current_user: CurrentUser,
    db: Database,
):
    """
    Disconnect Google account.
    """
    sync_service = SyncService(db)
    disconnected = await sync_service.disconnect_provider(current_user.id, "google")

    if not disconnected:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Google account not connected",
        )

    return {"success": True}


@router.post("/sync", response_model=SyncResponse)
async def sync_provider(
    request: SyncRequest,
    current_user: CurrentUser,
    db: Database,
):
    """
    Trigger a sync for a specific provider.

    This will fetch new emails and calendar events since the last sync
    and create memories for them.
    """
    sync_service = SyncService(db)

    if request.provider not in ["google", "microsoft"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid provider. Must be 'google' or 'microsoft'",
        )

    total_memories = 0
    all_errors = []

    if request.provider == "google":
        # Sync Gmail
        gmail_count, gmail_errors = await sync_service.sync_gmail(current_user.id)
        total_memories += gmail_count
        all_errors.extend(gmail_errors)

        # Sync Calendar
        calendar_count, calendar_errors = await sync_service.sync_calendar(current_user.id)
        total_memories += calendar_count
        all_errors.extend(calendar_errors)

    return SyncResponse(
        memories_added=total_memories,
        errors=all_errors,
    )


# ============== Calendar Actions ==============


@router.get("/google/calendar/events", response_model=CalendarEventsResponse)
async def get_calendar_events(
    current_user: CurrentUser,
    db: Database,
    start_date: datetime = Query(default=None, description="Start of date range (ISO format)"),
    end_date: datetime = Query(default=None, description="End of date range (ISO format)"),
):
    """
    Get calendar events for a date range.

    If no dates provided, returns events for current day.
    """
    sync_service = SyncService(db)

    # Default to current day if no dates provided
    if start_date is None:
        start_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    if end_date is None:
        end_date = start_date + timedelta(days=1)

    result = await sync_service.get_calendar_events(
        user_id=current_user.id,
        start_date=start_date,
        end_date=end_date,
    )

    if not result["success"]:
        # Return empty list with message instead of error for UI
        return CalendarEventsResponse(
            success=False,
            events=[],
            message=result["message"],
        )

    # Convert to response model
    events = [
        CalendarEventItem(**event)
        for event in result["events"]
    ]

    return CalendarEventsResponse(
        success=True,
        events=events,
        message=None,
    )


@router.post("/google/calendar/events", response_model=CalendarEventResponse)
async def create_calendar_event(
    request: CreateCalendarEventRequest,
    current_user: CurrentUser,
    db: Database,
):
    """
    Create a new Google Calendar event.

    The event will also be saved as a memory for future reference.
    """
    sync_service = SyncService(db)

    # Convert attendees to dict format
    attendees = [
        {"email": a.email, "name": a.name}
        for a in request.attendees
    ] if request.attendees else None

    result = await sync_service.create_calendar_event(
        user_id=current_user.id,
        title=request.title,
        start_time=request.start_time,
        end_time=request.end_time,
        description=request.description,
        location=request.location,
        attendees=attendees,
        send_notifications=request.send_notifications,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"],
        )

    return CalendarEventResponse(**result)


@router.put("/google/calendar/events/{event_id}", response_model=CalendarEventResponse)
async def update_calendar_event(
    request: UpdateCalendarEventRequest,
    current_user: CurrentUser,
    db: Database,
    event_id: str = Path(..., description="The Google Calendar event ID"),
):
    """
    Update/reschedule a Google Calendar event.

    Only provide the fields you want to update.
    """
    sync_service = SyncService(db)

    # Convert attendees to dict format if provided
    attendees = None
    if request.attendees is not None:
        attendees = [
            {"email": a.email, "name": a.name}
            for a in request.attendees
        ]

    result = await sync_service.update_calendar_event(
        user_id=current_user.id,
        event_id=event_id,
        title=request.title,
        start_time=request.start_time,
        end_time=request.end_time,
        description=request.description,
        location=request.location,
        attendees=attendees,
        send_notifications=request.send_notifications,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"],
        )

    return CalendarEventResponse(**result)


@router.delete("/google/calendar/events/{event_id}", response_model=CalendarEventResponse)
async def delete_calendar_event(
    current_user: CurrentUser,
    db: Database,
    event_id: str = Path(..., description="The Google Calendar event ID"),
    send_notifications: bool = Query(default=True, description="Send cancellation notifications to attendees"),
):
    """
    Delete a Google Calendar event.
    """
    sync_service = SyncService(db)

    result = await sync_service.delete_calendar_event(
        user_id=current_user.id,
        event_id=event_id,
        send_notifications=send_notifications,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"],
        )

    return CalendarEventResponse(**result)


# ============== Email Actions ==============


@router.post("/google/gmail/send", response_model=EmailResponse)
async def send_email(
    request: SendEmailRequest,
    current_user: CurrentUser,
    db: Database,
):
    """
    Send an email via Gmail.

    The sent email will also be saved as a memory for future reference.
    """
    sync_service = SyncService(db)

    # Convert recipients to dict format
    to = [{"email": r.email, "name": r.name} for r in request.to]
    cc = [{"email": r.email, "name": r.name} for r in request.cc] if request.cc else None
    bcc = [{"email": r.email, "name": r.name} for r in request.bcc] if request.bcc else None

    result = await sync_service.send_email(
        user_id=current_user.id,
        to=to,
        subject=request.subject,
        body=request.body,
        cc=cc,
        bcc=bcc,
        is_html=request.is_html,
        reply_to_message_id=request.reply_to_message_id,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"],
        )

    return EmailResponse(**result)


# ============== Advanced Calendar Actions ==============


@router.get("/google/calendar/availability")
async def get_calendar_availability(
    current_user: CurrentUser,
    db: Database,
    date: str = Query(default=None, description="Date to check (YYYY-MM-DD). Defaults to today."),
    duration_minutes: int = Query(default=30, description="Minimum slot duration needed"),
    start_hour: int = Query(default=9, description="Start hour of search range (0-23)"),
    end_hour: int = Query(default=18, description="End hour of search range (0-23)"),
):
    """
    Find available time slots in the user's calendar.

    Returns free slots between meetings for the specified date and time range.
    """
    sync_service = SyncService(db)

    # Parse date or use today
    if date:
        search_date = datetime.fromisoformat(date)
    else:
        search_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    time_min = search_date.replace(hour=start_hour, minute=0)
    time_max = search_date.replace(hour=end_hour, minute=0)

    result = await sync_service.find_free_slots(
        user_id=current_user.id,
        time_min=time_min,
        time_max=time_max,
        duration_minutes=duration_minutes,
    )

    # Format slots for response
    if result["success"] and result["free_slots"]:
        formatted_slots = []
        for slot in result["free_slots"]:
            start = slot["start"]
            end = slot["end"]
            formatted_slots.append({
                "start": start.isoformat() if isinstance(start, datetime) else start,
                "end": end.isoformat() if isinstance(end, datetime) else end,
                "duration_minutes": slot["duration_minutes"],
            })
        result["free_slots"] = formatted_slots

    if result.get("busy_slots"):
        formatted_busy = []
        for slot in result["busy_slots"]:
            start = slot["start"]
            end = slot["end"]
            formatted_busy.append({
                "start": start.isoformat() if isinstance(start, datetime) else start,
                "end": end.isoformat() if isinstance(end, datetime) else end,
            })
        result["busy_slots"] = formatted_busy

    return result


@router.post("/google/calendar/batch-reschedule")
async def batch_reschedule_events(
    current_user: CurrentUser,
    db: Database,
    events: list[dict] = None,
    notify_attendees: bool = Query(default=True, description="Notify attendees of changes"),
):
    """
    Reschedule multiple calendar events at once.

    Body should contain a list of events with:
    - event_id: The event ID to reschedule
    - new_start_time: New start time (ISO 8601)
    - new_end_time: Optional new end time (ISO 8601)
    """
    sync_service = SyncService(db)

    if not events:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No events provided",
        )

    # Convert string times to datetime
    event_updates = []
    for event in events:
        update = {"event_id": event["event_id"]}
        if event.get("new_start_time"):
            update["new_start_time"] = datetime.fromisoformat(
                event["new_start_time"].replace("Z", "+00:00")
            )
        if event.get("new_end_time"):
            update["new_end_time"] = datetime.fromisoformat(
                event["new_end_time"].replace("Z", "+00:00")
            )
        event_updates.append(update)

    result = await sync_service.batch_reschedule_events(
        user_id=current_user.id,
        event_updates=event_updates,
        send_notifications=notify_attendees,
    )

    return result


# ============== Advanced Email Actions ==============


@router.get("/google/gmail/thread/{thread_id}")
async def get_email_thread(
    current_user: CurrentUser,
    db: Database,
    thread_id: str = Path(..., description="Gmail thread ID"),
):
    """
    Get all messages in an email thread.

    Returns the full conversation history for a thread.
    """
    sync_service = SyncService(db)

    result = await sync_service.get_email_thread(
        user_id=current_user.id,
        thread_id=thread_id,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"],
        )

    return result


@router.post("/google/gmail/reply")
async def reply_to_email_thread(
    current_user: CurrentUser,
    db: Database,
    thread_id: str = Query(..., description="Gmail thread ID to reply to"),
    body: str = Query(..., description="Reply message body"),
    cc: list[str] = Query(default=None, description="CC email addresses"),
):
    """
    Reply to an email thread.

    Sends a reply within the existing thread, preserving conversation context.
    """
    sync_service = SyncService(db)

    result = await sync_service.reply_to_thread(
        user_id=current_user.id,
        thread_id=thread_id,
        body=body,
        cc=cc,
    )

    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["message"],
        )

    return result


@router.get("/google/gmail/inbox")
async def get_inbox(
    current_user: CurrentUser,
    db: Database,
    max_results: int = Query(default=20, description="Maximum results to return"),
    unread_only: bool = Query(default=False, description="Only return unread emails"),
):
    """
    Get recent inbox emails.

    Returns the most recent emails from the user's Gmail inbox.
    Use this for the unified inbox view.
    """
    sync_service = SyncService(db)

    # Build inbox query
    query = "in:inbox"
    if unread_only:
        query += " is:unread"

    result = await sync_service.search_emails(
        user_id=current_user.id,
        query=query,
        max_results=max_results,
    )

    return result


@router.get("/google/gmail/search")
async def search_emails(
    current_user: CurrentUser,
    db: Database,
    query: str = Query(..., description="Gmail search query (e.g., 'from:john', 'subject:meeting')"),
    max_results: int = Query(default=10, description="Maximum results to return"),
):
    """
    Search emails using Gmail search syntax.

    Supports Gmail query operators like:
    - from:email - From specific sender
    - to:email - To specific recipient
    - subject:text - Subject contains text
    - is:unread - Unread emails
    - after:date - After date (YYYY/MM/DD)
    """
    sync_service = SyncService(db)

    result = await sync_service.search_emails(
        user_id=current_user.id,
        query=query,
        max_results=max_results,
    )

    return result


# ============== Location Services ==============


@router.get("/places/search")
async def search_places(
    current_user: CurrentUser,
    db: Database,
    query: str = Query(..., description="Search query (e.g., 'quiet coffee shop', 'Italian restaurant')"),
    latitude: float = Query(default=None, description="Optional latitude to search near"),
    longitude: float = Query(default=None, description="Optional longitude to search near"),
    radius_meters: int = Query(default=5000, description="Search radius in meters"),
):
    """
    Search for places using Google Maps.

    Returns matching places with name, address, rating, and Google Maps link.
    """
    sync_service = SyncService(db)

    location = None
    if latitude is not None and longitude is not None:
        location = (latitude, longitude)

    result = await sync_service.search_places(
        user_id=current_user.id,
        query=query,
        location=location,
        radius_meters=radius_meters,
    )

    return result
