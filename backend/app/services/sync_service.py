import logging
from uuid import UUID
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import Optional
import json
import base64
import hashlib
import httpx

from composio import Composio, ComposioToolSet
from app.models.integration import ConnectedAccount, SyncState
from app.services.memory_service import MemoryService
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Simple in-memory cache for calendar events (shared across instances)
_calendar_cache: dict[str, tuple[dict, datetime]] = {}
_CALENDAR_CACHE_TTL = timedelta(minutes=2)


class SyncService:
    """Service for syncing data from external providers via Composio."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.memory_service = MemoryService(db)

        # Initialize Composio clients with error handling
        if not settings.composio_api_key:
            logger.warning("COMPOSIO_API_KEY not set - integrations will not work")
            self.composio = None
            self.toolset = None
        else:
            try:
                self.composio = Composio(api_key=settings.composio_api_key)
                self.toolset = ComposioToolSet(api_key=settings.composio_api_key)
            except Exception as e:
                logger.error(f"Error initializing Composio: {e}")
                self.composio = None
                self.toolset = None

    async def _execute_composio_action(self, action: str, params: dict, connected_account_id: str) -> dict:
        """
        Execute a Composio action via REST API directly.

        This bypasses the SDK's app-specific connection validation, allowing
        us to use a 'googlesuper' connection with 'GOOGLECALENDAR' actions.
        """
        url = f"https://backend.composio.dev/api/v2/actions/{action}/execute"
        headers = {
            "X-API-Key": settings.composio_api_key,
            "Content-Type": "application/json"
        }
        data = {
            "connectedAccountId": connected_account_id,
            "input": params
        }

        logger.debug(f"Action: {action}")
        logger.debug(f"Params: {json.dumps(params, indent=2, default=str)}")

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, headers=headers, json=data)
            result = response.json()
            logger.debug(f"Response status: {response.status_code}")
            logger.debug(f"Response: {json.dumps(result, indent=2, default=str)}")

            # Check for HTTP errors
            if response.status_code >= 400:
                error_msg = result.get("error") or result.get("message") or str(result)
                raise Exception(f"Composio action failed: {error_msg}")

            # Composio returns data in different formats, normalize it
            if result.get("successful") or result.get("successfull"):
                return result.get("data", result)
            else:
                error = result.get("error") or result.get("message") or "Unknown error"
                raise Exception(f"Composio action failed: {error}")

        except httpx.RequestError as e:
            logger.debug(f"Request error: {e}")
            raise Exception(f"Composio API request failed: {e}")

    # ==================== CONNECTION MANAGEMENT ====================

    async def get_connection_status(self, user_id: UUID) -> dict:
        """Get status of all provider connections."""
        result = await self.db.execute(
            select(ConnectedAccount).where(ConnectedAccount.user_id == user_id)
        )
        accounts = result.scalars().all()

        # Build status response
        # Look for unified googlesuper connection OR legacy separate connections
        google_super = None
        google_gmail = None
        google_calendar = None

        for account in accounts:
            if account.provider == "google":
                if account.service == "googlesuper":
                    google_super = account
                elif account.service == "gmail":
                    google_gmail = account
                elif account.service in ("calendar", "googlecalendar"):
                    google_calendar = account

        # Unified googlesuper connection provides both Gmail and Calendar
        if google_super:
            google_connected = True
            google_email = google_super.email
            google_last_sync = google_super.last_sync_at.isoformat() if google_super.last_sync_at else None
            google_status = google_super.status if google_super.status != "active" else "active"
            gmail_connected = True
            calendar_connected = True
        else:
            # Legacy: separate connections
            google_connected = google_gmail is not None
            google_email = google_gmail.email if google_gmail else None
            google_last_sync = google_gmail.last_sync_at.isoformat() if google_gmail and google_gmail.last_sync_at else None
            google_status = "active"
            if google_gmail and google_gmail.status == "expired":
                google_status = "expired"
            if google_calendar and google_calendar.status == "expired":
                google_status = "expired"
            gmail_connected = google_gmail is not None
            calendar_connected = google_calendar is not None

        return {
            "google": {
                "connected": google_connected,
                "email": google_email,
                "last_sync": google_last_sync,
                "status": google_status,
                "gmail_connected": gmail_connected,
                "calendar_connected": calendar_connected,
            },
            "microsoft": {
                "connected": False,
                "email": None,
                "last_sync": None,
                "status": "not_connected",
            },
        }

    async def get_oauth_url(
        self,
        user_id: UUID,
        provider: str,
        redirect_url: str,
        service: str = "googlesuper",  # Use unified googlesuper for all Google services
        app_return_url: str = None,  # Deep link to return to app
    ) -> str:
        """
        Get OAuth URL for connecting a service via Composio.

        For Google, we use 'googlesuper' which provides unified access to
        Gmail, Calendar, Drive, and all other Google services in one OAuth flow.
        """
        # Check if Composio is initialized
        if not self.composio:
            raise ValueError("Composio not initialized - check COMPOSIO_API_KEY")

        try:
            entity = self.composio.get_entity(id=str(user_id))

            # Normalize service name - always use googlesuper for Google
            if provider == "google" and service in ("gmail", "googlecalendar", "calendar"):
                service = "googlesuper"

            # Encode user_id, service, and app_return_url in state
            state_data = json.dumps({
                "user_id": str(user_id),
                "service": service,
                "app_return_url": app_return_url or "cortex://oauth/success",
            })
            state = base64.b64encode(state_data.encode()).decode()

            # Initiate connection with googlesuper for unified Google access
            logger.debug(f"Initiating Composio connection for user {user_id}, service: {service}")
            connection_request = entity.initiate_connection(
                app_name=service,  # 'googlesuper' for unified Google services
                redirect_url=redirect_url,
            )

            oauth_url = connection_request.redirectUrl
            logger.debug(f"Got OAuth URL: {oauth_url[:100]}...")

            # Add state parameter
            if "state=" not in oauth_url:
                separator = "&" if "?" in oauth_url else "?"
                oauth_url = f"{oauth_url}{separator}state={state}"

            return oauth_url

        except Exception as e:
            logger.error(f"Error getting OAuth URL from Composio: {type(e).__name__}: {e}", exc_info=True)
            raise ValueError(f"Failed to get OAuth URL: {str(e)}")

    async def handle_oauth_callback_by_connection_id(
        self,
        connected_account_id: str,
        provider: str,
        service: str,
    ) -> Optional[ConnectedAccount]:
        """
        Handle OAuth callback using Composio's connectedAccountId.
        This is the new Composio callback format.
        """
        if not self.composio:
            logger.debug("Composio not initialized - cannot handle callback")
            return None

        try:
            # Get connection details from Composio using connected_accounts.get()
            connection = self.composio.connected_accounts.get(connected_account_id)
            logger.debug(f"Got Composio connection: {connection}")
            logger.debug(f"  Connection attributes: {dir(connection)}")

            # The user_id is in clientUniqueUserId (entityId is 'default')
            entity_id = None
            # Check clientUniqueUserId first (this contains the actual user UUID)
            if hasattr(connection, 'clientUniqueUserId') and connection.clientUniqueUserId:
                entity_id = connection.clientUniqueUserId
            elif hasattr(connection, 'entityId') and connection.entityId != 'default':
                entity_id = connection.entityId
            elif hasattr(connection, 'entity_id') and connection.entity_id != 'default':
                entity_id = connection.entity_id

            if not entity_id:
                logger.debug(f"No user_id found in Composio connection")
                return None

            logger.debug(f"Using clientUniqueUserId as user_id: {entity_id}")
            user_id = UUID(entity_id)
            logger.debug(f"Found user_id from Composio entity: {user_id}")

            # Get email from connection params if available
            email = None
            if hasattr(connection, 'connectionParams') and connection.connectionParams:
                email = getattr(connection.connectionParams, 'email', None)
                if not email:
                    email = getattr(connection.connectionParams, 'user_email', None)

            conn_status = getattr(connection, 'status', 'ACTIVE')
            status = "active" if conn_status == "ACTIVE" else "expired"

            # Save to our database
            return await self._save_connected_account(
                user_id=user_id,
                provider=provider,
                service=service,
                composio_connection_id=connected_account_id,
                email=email,
                status=status,
            )

        except Exception as e:
            logger.error(f"Error handling Composio callback: {type(e).__name__}: {e}", exc_info=True)
            return None

    async def _save_connected_account(
        self,
        user_id: UUID,
        provider: str,
        service: str,
        composio_connection_id: str,
        email: Optional[str],
        status: str,
    ) -> ConnectedAccount:
        """Save or update a connected account in our database."""
        # Check if connection already exists
        result = await self.db.execute(
            select(ConnectedAccount).where(
                and_(
                    ConnectedAccount.user_id == user_id,
                    ConnectedAccount.provider == provider,
                    ConnectedAccount.service == service,
                )
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.composio_connection_id = composio_connection_id
            existing.email = email
            existing.status = status
            await self.db.commit()
            logger.debug(f"Updated existing connection for {service}")
            return existing

        # Create new connection
        account = ConnectedAccount(
            user_id=user_id,
            provider=provider,
            service=service,
            composio_connection_id=composio_connection_id,
            email=email,
            status=status,
        )
        self.db.add(account)
        await self.db.commit()
        await self.db.refresh(account)
        logger.debug(f"Created new connection for {service}")
        return account

    async def handle_oauth_callback(
        self,
        user_id: UUID,
        provider: str,
        service: str,
    ) -> Optional[ConnectedAccount]:
        """
        Handle OAuth callback and store connection (legacy method).
        """
        if not self.composio:
            logger.debug("Composio not initialized - cannot handle callback")
            return None

        try:
            # Get entity connections from Composio
            entity = self.composio.get_entity(id=str(user_id))
            connections = entity.get_connections()

            logger.debug(f"Found {len(connections)} connections for user {user_id}")
            for conn in connections:
                logger.debug(f"  - Connection: app={conn.appName}, id={conn.id}, status={conn.status}")

            # Find the connection for this service
            composio_connection_id = None
            email = None
            status = "active"

            for conn in connections:
                if conn.appName == service:
                    composio_connection_id = conn.id
                    status = "active" if conn.status == "ACTIVE" else "expired"
                    # Try to get email from connection params
                    if hasattr(conn, 'connectionParams') and conn.connectionParams:
                        email = getattr(conn.connectionParams, 'email', None)
                        if not email and hasattr(conn.connectionParams, 'user_email'):
                            email = conn.connectionParams.user_email
                    break

            if not composio_connection_id:
                logger.debug(f"No Composio connection found for {service}")
                return None

            # Save to our database using helper
            return await self._save_connected_account(
                user_id=user_id,
                provider=provider,
                service=service,
                composio_connection_id=composio_connection_id,
                email=email,
                status=status,
            )

        except Exception as e:
            logger.error(f"Error getting Composio connection: {type(e).__name__}: {e}", exc_info=True)
            return None

    async def refresh_connection_status(self, user_id: UUID) -> None:
        """Check Composio for connection status and update our database."""
        try:
            entity = self.composio.get_entity(id=str(user_id))
            connections = entity.get_connections()

            for conn in connections:
                # Find matching local connection
                result = await self.db.execute(
                    select(ConnectedAccount).where(
                        and_(
                            ConnectedAccount.user_id == user_id,
                            ConnectedAccount.composio_connection_id == conn.id,
                        )
                    )
                )
                account = result.scalar_one_or_none()

                if account:
                    new_status = "active" if conn.status == "ACTIVE" else "expired"
                    if account.status != new_status:
                        account.status = new_status
                        await self.db.commit()

        except Exception as e:
            logger.error(f"Error refreshing connection status: {e}")

    async def disconnect_provider(self, user_id: UUID, provider: str) -> bool:
        """Disconnect all services for a provider."""
        result = await self.db.execute(
            select(ConnectedAccount).where(
                and_(
                    ConnectedAccount.user_id == user_id,
                    ConnectedAccount.provider == provider,
                )
            )
        )
        accounts = result.scalars().all()

        if not accounts:
            return False

        for account in accounts:
            try:
                entity = self.composio.get_entity(id=str(user_id))
                connections = entity.get_connections()
                for conn in connections:
                    if conn.id == account.composio_connection_id:
                        conn.delete()
                        break
            except Exception as e:
                logger.error(f"Error revoking Composio connection: {e}")

            await self.db.delete(account)

        await self.db.commit()
        return True

    # ==================== HELPER: Get Connection ID ====================

    async def _get_connection_id(self, user_id: UUID, service: str) -> Optional[str]:
        """Get Composio connection ID for a specific service.

        First checks for unified 'googlesuper' connection, then falls back
        to legacy service-specific connections.
        """
        # First, check for unified googlesuper connection (provides all Google services)
        result = await self.db.execute(
            select(ConnectedAccount).where(
                and_(
                    ConnectedAccount.user_id == user_id,
                    ConnectedAccount.provider == "google",
                    ConnectedAccount.service == "googlesuper",
                    ConnectedAccount.status == "active",
                )
            )
        )
        account = result.scalar_one_or_none()
        if account:
            return account.composio_connection_id

        # Fallback: check for legacy service-specific connection
        result = await self.db.execute(
            select(ConnectedAccount).where(
                and_(
                    ConnectedAccount.user_id == user_id,
                    ConnectedAccount.provider == "google",
                    ConnectedAccount.service == service,
                    ConnectedAccount.status == "active",
                )
            )
        )
        account = result.scalar_one_or_none()
        return account.composio_connection_id if account else None

    # ==================== SYNC ====================

    async def sync_gmail(self, user_id: UUID) -> tuple[int, list[str]]:
        """Sync emails from Gmail."""
        connection_id = await self._get_connection_id(user_id, "gmail")
        if not connection_id:
            return 0, ["Gmail not connected"]

        if not self.toolset:
            return 0, ["Composio not initialized"]

        sync_state = await self._get_sync_state(user_id, "google", "email")
        memories_added = 0
        errors = []

        try:
            # Calculate date range
            if sync_state and sync_state.last_sync_at:
                after_date = sync_state.last_sync_at
            else:
                after_date = datetime.utcnow() - timedelta(days=7)

            after_str = after_date.strftime("%Y/%m/%d")

            logger.debug(f"Syncing Gmail for user {user_id}, connection_id: {connection_id}")

            # Fetch emails via Composio - use entity_id (user's UUID)
            response = await self._execute_composio_action(
                action="GMAIL_FETCH_EMAILS",
                params={
                    "max_results": 50,
                    "query": f"after:{after_str}",
                },
                connected_account_id=connection_id,
            )
            logger.debug(f"Gmail fetch response: {str(response)[:500]}")

            # Parse response - Composio response can have different formats
            data = response if isinstance(response, dict) else {}

            # Try different response structures
            messages = (
                data.get("messages") or
                data.get("data", {}).get("messages", []) or
                data.get("response_data", {}).get("messages", []) or
                []
            )

            # If response has emails directly (list)
            if isinstance(data.get("data"), list):
                messages = data["data"]

            logger.debug(f"Found {len(messages)} messages to process")
            if messages:
                logger.debug(f"First message structure: {messages[0] if messages else 'N/A'}")

            for msg in messages:
                try:
                    # Get message ID - try different field names
                    msg_id = (
                        msg.get("id") or
                        msg.get("messageId") or
                        msg.get("message_id") or
                        msg.get("threadId")  # Fallback
                    )

                    if not msg_id:
                        logger.debug(f"No ID found in message: {msg}")
                        continue

                    # Check if already synced
                    if await self._check_existing_memory(user_id, "email", msg_id):
                        continue

                    # Try to extract email content directly from the message
                    # Composio might return full email content in the list response
                    sender = msg.get("from") or msg.get("sender", "Unknown")
                    subject = msg.get("subject", "No Subject")
                    body = msg.get("body") or msg.get("snippet") or msg.get("preview", "")
                    date_str = msg.get("date") or msg.get("receivedAt") or msg.get("internalDate")

                    # If we don't have content, fetch the full email
                    if not body:
                        email_resp = await self._execute_composio_action(
                            action="GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
                            params={"message_id": msg_id},
                            connected_account_id=connection_id,
                        )
                        email_data = email_resp if isinstance(email_resp, dict) else {}
                        email = email_data.get("data", email_data)
                        if email:
                            sender = email.get("from", sender)
                            subject = email.get("subject", subject)
                            body = email.get("body", email.get("snippet", ""))
                            date_str = email.get("date", date_str)

                    try:
                        if date_str:
                            if isinstance(date_str, (int, float)):
                                # Unix timestamp (milliseconds)
                                email_date = datetime.fromtimestamp(int(date_str) / 1000)
                            else:
                                email_date = datetime.fromisoformat(
                                    str(date_str).replace("Z", "+00:00")
                                )
                        else:
                            email_date = datetime.utcnow()
                    except Exception:
                        email_date = datetime.utcnow()

                    content = f"Email from {sender}\nSubject: {subject}\n\n{body}"

                    await self.memory_service.create_memory(
                        user_id=user_id,
                        content=content[:50000],
                        memory_type="email",
                        memory_date=email_date,
                        source_id=msg_id,
                        source_url=f"https://mail.google.com/mail/u/0/#inbox/{msg_id}",
                    )
                    memories_added += 1
                    logger.debug(f"Saved email: {subject[:50]}")

                except Exception as e:
                    errors.append(f"Failed to sync email: {str(e)[:100]}")

        except Exception as e:
            errors.append(f"Gmail sync error: {str(e)}")

        # Update sync state
        await self._update_sync_state(user_id, "google", "email")
        return memories_added, errors

    async def sync_calendar(self, user_id: UUID) -> tuple[int, list[str]]:
        """Sync events from Google Calendar."""
        connection_id = await self._get_connection_id(user_id, "googlecalendar")
        if not connection_id:
            return 0, ["Calendar not connected"]

        sync_state = await self._get_sync_state(user_id, "google", "calendar")
        memories_added = 0
        errors = []

        try:
            if sync_state and sync_state.last_sync_at:
                time_min = sync_state.last_sync_at
            else:
                time_min = datetime.utcnow() - timedelta(days=30)

            time_max = datetime.utcnow() + timedelta(days=30)

            # Format dates without microseconds - Composio expects clean ISO format
            response = await self._execute_composio_action(
                action="GOOGLECALENDAR_FIND_EVENT",
                params={
                    "time_min": time_min.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "time_max": time_max.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "max_results": 100,
                },
                connected_account_id=connection_id,
            )

            data = response if isinstance(response, dict) else {}
            events = data.get("items") or data.get("data", {}).get("items", [])

            for event in events:
                try:
                    event_id = event.get("id")
                    if not event_id:
                        continue

                    if await self._check_existing_memory(user_id, "calendar", event_id):
                        continue

                    title = event.get("summary", "Untitled Event")
                    description = event.get("description", "")
                    location = event.get("location", "")

                    attendees = event.get("attendees", [])
                    attendee_names = [
                        a.get("displayName", a.get("email", "Unknown"))
                        for a in attendees
                    ]

                    start = event.get("start", {})
                    start_time = start.get("dateTime") or start.get("date")
                    try:
                        if "T" in str(start_time):
                            event_date = datetime.fromisoformat(
                                start_time.replace("Z", "+00:00")
                            )
                        else:
                            event_date = datetime.strptime(start_time, "%Y-%m-%d")
                    except Exception:
                        event_date = datetime.utcnow()

                    content_parts = [f"Calendar Event: {title}"]
                    content_parts.append(f"When: {start_time}")
                    if location:
                        content_parts.append(f"Location: {location}")
                    if attendee_names:
                        content_parts.append(f"Attendees: {', '.join(attendee_names)}")
                    if description:
                        content_parts.append(f"\nDetails:\n{description}")

                    await self.memory_service.create_memory(
                        user_id=user_id,
                        content="\n".join(content_parts)[:50000],
                        memory_type="calendar",
                        memory_date=event_date,
                        source_id=event_id,
                        source_url=event.get("htmlLink", ""),
                    )
                    memories_added += 1

                except Exception as e:
                    errors.append(f"Failed to sync event: {str(e)[:100]}")

        except Exception as e:
            errors.append(f"Calendar sync error: {str(e)}")

        await self._update_sync_state(user_id, "google", "calendar")
        return memories_added, errors

    # ==================== CALENDAR ACTIONS ====================

    async def get_calendar_events(
        self,
        user_id: UUID,
        start_date: datetime,
        end_date: datetime,
    ) -> dict:
        """Fetch calendar events for display (without saving as memories)."""
        global _calendar_cache

        connection_id = await self._get_connection_id(user_id, "googlecalendar")
        if not connection_id:
            return {
                "success": False,
                "events": [],
                "message": "Calendar not connected",
            }

        if not self.toolset:
            return {
                "success": False,
                "events": [],
                "message": "Composio not initialized",
            }

        # Check cache first
        cache_key = hashlib.md5(
            f"{user_id}:{start_date.isoformat()}:{end_date.isoformat()}".encode()
        ).hexdigest()

        if cache_key in _calendar_cache:
            cached_result, cached_time = _calendar_cache[cache_key]
            if datetime.utcnow() - cached_time < _CALENDAR_CACHE_TTL:
                return cached_result

        try:
            # Use REST API directly to bypass SDK's app-specific validation
            # Format dates without microseconds - Composio expects clean ISO format
            time_min = start_date.strftime("%Y-%m-%dT%H:%M:%SZ")
            time_max = end_date.strftime("%Y-%m-%dT%H:%M:%SZ")

            response = await self._execute_composio_action(
                action="GOOGLECALENDAR_FIND_EVENT",
                params={
                    "time_min": time_min,
                    "time_max": time_max,
                    "max_results": 250,
                    "single_events": True,
                    "order_by": "startTime",
                },
                connected_account_id=connection_id,
            )

            data = response if isinstance(response, dict) else {}

            # Try different response structures from Composio
            event_data = data.get("event_data", data)
            items = (
                event_data.get("event_data") or
                event_data.get("items") or
                data.get("items") or
                data.get("data", {}).get("items") or
                data.get("response_data", {}).get("items") or
                []
            )

            # If data is a list directly
            if isinstance(data.get("data"), list):
                items = data["data"]

            events = []
            for event in items:
                try:
                    event_id = event.get("id")
                    if not event_id:
                        continue

                    title = event.get("summary", "Untitled Event")
                    description = event.get("description", "")
                    location = event.get("location", "")
                    html_link = event.get("htmlLink", "")
                    color_id = event.get("colorId", "")

                    # Extract Google Meet link from hangoutLink or conferenceData
                    meet_link = event.get("hangoutLink", "")
                    if not meet_link:
                        # Check conferenceData for video conference links
                        conference_data = event.get("conferenceData", {})
                        entry_points = conference_data.get("entryPoints", [])
                        for entry in entry_points:
                            if entry.get("entryPointType") == "video":
                                meet_link = entry.get("uri", "")
                                break

                    # Also check description and location for Meet/Zoom links
                    if not meet_link:
                        import re
                        # Regex to find video conference links
                        video_link_pattern = r'(https?://(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com)/[^\s<>"\']+)'

                        # Check description
                        if description:
                            match = re.search(video_link_pattern, description)
                            if match:
                                meet_link = match.group(1)

                        # Check location
                        if not meet_link and location:
                            match = re.search(video_link_pattern, location)
                            if match:
                                meet_link = match.group(1)

                    # Detect meeting type based on video link
                    meeting_type = "offline"  # Default
                    if meet_link:
                        if "meet.google.com" in meet_link:
                            meeting_type = "google_meet"
                        elif "zoom.us" in meet_link or "zoom.com" in meet_link:
                            meeting_type = "zoom"
                        elif "teams.microsoft.com" in meet_link:
                            meeting_type = "teams"
                        elif "webex" in meet_link:
                            meeting_type = "webex"
                        else:
                            meeting_type = "video"  # Generic video call
                    elif location and ("http" in location.lower() or "meet" in location.lower() or "zoom" in location.lower()):
                        # Check location for video links
                        if "meet.google.com" in location:
                            meeting_type = "google_meet"
                            meet_link = location
                        elif "zoom" in location.lower():
                            meeting_type = "zoom"
                        elif "teams" in location.lower():
                            meeting_type = "teams"

                    # Parse start time
                    start = event.get("start", {})
                    start_datetime_str = start.get("dateTime")
                    start_date_str = start.get("date")
                    is_all_day = start_date_str is not None and start_datetime_str is None

                    if start_datetime_str:
                        event_start_time = datetime.fromisoformat(
                            start_datetime_str.replace("Z", "+00:00")
                        )
                    elif start_date_str:
                        event_start_time = datetime.strptime(start_date_str, "%Y-%m-%d")
                    else:
                        continue

                    # Parse end time
                    end = event.get("end", {})
                    end_datetime_str = end.get("dateTime")
                    end_date_str = end.get("date")

                    if end_datetime_str:
                        event_end_time = datetime.fromisoformat(
                            end_datetime_str.replace("Z", "+00:00")
                        )
                    elif end_date_str:
                        event_end_time = datetime.strptime(end_date_str, "%Y-%m-%d")
                    else:
                        event_end_time = event_start_time + timedelta(hours=1)

                    # Get attendees
                    attendees_list = event.get("attendees", [])
                    attendee_names = [
                        a.get("displayName", a.get("email", ""))
                        for a in attendees_list
                        if a.get("displayName") or a.get("email")
                    ]

                    # Map color ID to hex color
                    color_map = {
                        "1": "#7986cb",  # Lavender
                        "2": "#33b679",  # Sage
                        "3": "#8e24aa",  # Grape
                        "4": "#e67c73",  # Flamingo
                        "5": "#f6c026",  # Banana
                        "6": "#f5511d",  # Tangerine
                        "7": "#039be5",  # Peacock
                        "8": "#616161",  # Graphite
                        "9": "#3f51b5",  # Blueberry
                        "10": "#0b8043", # Basil
                        "11": "#d50000", # Tomato
                    }
                    color = color_map.get(color_id, "#4285f4")  # Default to Google blue

                    events.append({
                        "id": event_id,
                        "title": title,
                        "start_time": event_start_time,
                        "end_time": event_end_time,
                        "is_all_day": is_all_day,
                        "location": location if location else None,
                        "description": description if description else None,
                        "attendees": attendee_names,
                        "color": color,
                        "html_link": html_link if html_link else None,
                        "meet_link": meet_link if meet_link else None,
                        "meeting_type": meeting_type,  # google_meet, zoom, teams, webex, video, offline
                    })

                except Exception as e:
                    logger.error(f"Error parsing event: {e}")
                    continue

            result = {
                "success": True,
                "events": events,
                "message": None,
            }

            # Cache the successful result
            _calendar_cache[cache_key] = (result, datetime.utcnow())

            return result

        except Exception as e:
            logger.error(f"Error fetching calendar events: {e}", exc_info=True)
            return {
                "success": False,
                "events": [],
                "message": f"Error: {str(e)}",
            }

    async def create_calendar_event(
        self,
        user_id: UUID,
        title: str,
        start_time: datetime,
        end_time: datetime,
        description: str | None = None,
        location: str | None = None,
        attendees: list[dict] | None = None,
        send_notifications: bool = True,
        add_google_meet: bool = True,  # Automatically add Google Meet
    ) -> dict:
        """Create a new calendar event."""
        connection_id = await self._get_connection_id(user_id, "googlecalendar")
        if not connection_id:
            return {
                "success": False,
                "event_id": None,
                "event_url": None,
                "message": "Calendar not connected",
            }

        try:
            import uuid as uuid_lib

            # Format datetime for Composio (ISO format without microseconds)
            start_dt_str = start_time.strftime("%Y-%m-%dT%H:%M:%SZ")
            end_dt_str = end_time.strftime("%Y-%m-%dT%H:%M:%SZ")

            # Use Composio's expected parameter names
            event_params = {
                "summary": title,
                "start_datetime": start_dt_str,
                "end_datetime": end_dt_str,
                "timezone": "UTC",
                "send_updates": send_notifications,  # Boolean
            }

            if description:
                event_params["description"] = description
            if location:
                event_params["location"] = location
            if attendees:
                event_params["attendees"] = [a["email"] for a in attendees]

            # Add Google Meet conferencing by default
            # Composio uses 'create_meeting_room' parameter (defaults to True)
            if add_google_meet:
                event_params["create_meeting_room"] = True

            logger.debug(f"Attempting to create event with params: {json.dumps(event_params, indent=2, default=str)}")

            response = await self._execute_composio_action(
                action="GOOGLECALENDAR_CREATE_EVENT",
                params=event_params,
                connected_account_id=connection_id,
            )

            logger.debug(f"Response: {json.dumps(response, indent=2, default=str)[:2000]}")

            # Parse response - Composio nests data under response_data
            data = response if isinstance(response, dict) else {}
            event_data = data.get("response_data") or data.get("data", {}).get("response_data") or data

            if event_data and event_data.get("id"):
                event_id = event_data["id"]
                event_url = event_data.get("htmlLink", "")

                # Extract Google Meet link from response
                meet_link = event_data.get("hangoutLink", "")
                if not meet_link:
                    conference_data = event_data.get("conferenceData", {})
                    entry_points = conference_data.get("entryPoints", [])
                    for entry in entry_points:
                        if entry.get("entryPointType") == "video":
                            meet_link = entry.get("uri", "")
                            break

                if meet_link:
                    logger.debug(f"Created event '{title}' with meet_link: {meet_link}")

                # Create memory
                content = f"Calendar Event Created: {title}\nWhen: {start_time} - {end_time}"
                if location:
                    content += f"\nLocation: {location}"
                if meet_link:
                    content += f"\nGoogle Meet: {meet_link}"

                await self.memory_service.create_memory(
                    user_id=user_id,
                    content=content,
                    memory_type="calendar",
                    memory_date=start_time,
                    source_id=event_id,
                    source_url=event_url,
                )

                return {
                    "success": True,
                    "event_id": event_id,
                    "event_url": event_url,
                    "meet_link": meet_link if meet_link else None,
                    "message": f"Event '{title}' created" + (" with Google Meet" if meet_link else ""),
                }
            else:
                return {
                    "success": False,
                    "event_id": None,
                    "event_url": None,
                    "meet_link": None,
                    "message": str(data.get("error", "Failed to create event")),
                }

        except Exception as e:
            return {
                "success": False,
                "event_id": None,
                "event_url": None,
                "meet_link": None,
                "message": f"Error: {str(e)}",
            }

    async def update_calendar_event(
        self,
        user_id: UUID,
        event_id: str,
        title: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        description: str | None = None,
        location: str | None = None,
        attendees: list[dict] | None = None,
        send_notifications: bool = True,
    ) -> dict:
        """Update a calendar event."""
        connection_id = await self._get_connection_id(user_id, "googlecalendar")
        if not connection_id:
            return {
                "success": False,
                "event_id": event_id,
                "event_url": None,
                "message": "Calendar not connected",
            }

        try:
            # Use Composio's expected parameter names
            update_params = {
                "event_id": event_id,
                "send_updates": send_notifications,  # Boolean
            }

            if title is not None:
                update_params["summary"] = title
            if description is not None:
                update_params["description"] = description
            if location is not None:
                update_params["location"] = location
            if start_time is not None:
                update_params["start_datetime"] = start_time.strftime("%Y-%m-%dT%H:%M:%SZ")
            if end_time is not None:
                update_params["end_datetime"] = end_time.strftime("%Y-%m-%dT%H:%M:%SZ")
            if attendees is not None:
                update_params["attendees"] = [a["email"] for a in attendees]

            response = await self._execute_composio_action(
                action="GOOGLECALENDAR_UPDATE_EVENT",
                params=update_params,
                connected_account_id=connection_id,
            )

            # Parse response - Composio nests data under response_data
            data = response if isinstance(response, dict) else {}
            event_data = data.get("response_data") or data.get("data", {}).get("response_data") or data

            return {
                "success": True,
                "event_id": event_id,
                "event_url": event_data.get("htmlLink", ""),
                "message": "Event updated",
            }

        except Exception as e:
            return {
                "success": False,
                "event_id": event_id,
                "event_url": None,
                "message": f"Error: {str(e)}",
            }

    async def delete_calendar_event(
        self,
        user_id: UUID,
        event_id: str,
        send_notifications: bool = True,
    ) -> dict:
        """Delete a calendar event."""
        connection_id = await self._get_connection_id(user_id, "googlecalendar")
        if not connection_id:
            return {
                "success": False,
                "event_id": event_id,
                "event_url": None,
                "message": "Calendar not connected",
            }

        try:
            await self._execute_composio_action(
                action="GOOGLECALENDAR_DELETE_EVENT",
                params={
                    "event_id": event_id,
                    "send_updates": send_notifications,  # Boolean
                },
                connected_account_id=connection_id,
            )

            return {
                "success": True,
                "event_id": event_id,
                "event_url": None,
                "message": "Event deleted",
            }

        except Exception as e:
            return {
                "success": False,
                "event_id": event_id,
                "event_url": None,
                "message": f"Error: {str(e)}",
            }

    # ==================== EMAIL ACTIONS ====================

    async def send_email(
        self,
        user_id: UUID,
        to: list[dict],
        subject: str,
        body: str,
        cc: list[dict] | None = None,
        bcc: list[dict] | None = None,
        is_html: bool = False,
        reply_to_message_id: str | None = None,
    ) -> dict:
        """Send an email via Gmail."""
        connection_id = await self._get_connection_id(user_id, "gmail")
        if not connection_id:
            return {
                "success": False,
                "message_id": None,
                "thread_id": None,
                "message": "Gmail not connected",
            }

        try:
            # Use Composio's expected parameter names
            recipient_emails = [r["email"] for r in to]
            email_params = {
                "recipient_email": recipient_emails[0] if len(recipient_emails) == 1 else recipient_emails[0],
                "subject": subject,
                "body": body,
            }

            # Add CC recipients if provided
            if cc:
                email_params["cc"] = ",".join([r["email"] for r in cc])
            if bcc:
                email_params["bcc"] = ",".join([r["email"] for r in bcc])
            if is_html:
                email_params["is_html"] = True
            if reply_to_message_id:
                email_params["thread_id"] = reply_to_message_id

            response = await self._execute_composio_action(
                action="GMAIL_SEND_EMAIL",
                params=email_params,
                connected_account_id=connection_id,
            )

            # Parse response - Composio nests data under response_data
            data = response if isinstance(response, dict) else {}
            email_data = data.get("response_data") or data.get("data", {}).get("response_data") or data

            if email_data and email_data.get("id"):
                message_id = email_data["id"]
                thread_id = email_data.get("threadId", "")

                # Create memory
                recipients = ", ".join([r.get("name", r["email"]) for r in to])
                content = f"Email sent to {recipients}\nSubject: {subject}\n\n{body}"

                await self.memory_service.create_memory(
                    user_id=user_id,
                    content=content[:50000],
                    memory_type="email",
                    memory_date=datetime.utcnow(),
                    source_id=message_id,
                    source_url=f"https://mail.google.com/mail/u/0/#sent/{message_id}",
                )

                return {
                    "success": True,
                    "message_id": message_id,
                    "thread_id": thread_id,
                    "message": f"Email sent to {recipients}",
                }
            else:
                return {
                    "success": False,
                    "message_id": None,
                    "thread_id": None,
                    "message": str(data.get("error", "Failed to send email")),
                }

        except Exception as e:
            return {
                "success": False,
                "message_id": None,
                "thread_id": None,
                "message": f"Error: {str(e)}",
            }

    # ==================== ADVANCED CALENDAR ACTIONS ====================

    async def find_free_slots(
        self,
        user_id: UUID,
        time_min: datetime,
        time_max: datetime,
        duration_minutes: int = 30,
    ) -> dict:
        """
        Find free time slots in the user's calendar.

        Args:
            user_id: User's UUID
            time_min: Start of time range to search
            time_max: End of time range to search
            duration_minutes: Minimum slot duration needed

        Returns:
            Dict with free_slots list and busy_slots list
        """
        # Normalize time_min and time_max to naive datetimes (strip timezone if present)
        if time_min.tzinfo is not None:
            time_min = time_min.replace(tzinfo=None)
        if time_max.tzinfo is not None:
            time_max = time_max.replace(tzinfo=None)

        connection_id = await self._get_connection_id(user_id, "googlecalendar")
        if not connection_id:
            return {
                "success": False,
                "free_slots": [],
                "busy_slots": [],
                "message": "Calendar not connected",
            }

        try:
            # Use GOOGLECALENDAR_FIND_FREE_SLOTS action
            # Format dates without microseconds - Composio expects clean ISO format
            response = await self._execute_composio_action(
                action="GOOGLECALENDAR_FIND_FREE_SLOTS",
                params={
                    "time_min": time_min.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "time_max": time_max.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "items": [{"id": "primary"}],
                },
                connected_account_id=connection_id,
            )

            data = response if isinstance(response, dict) else {}

            # Parse free/busy data
            calendars = data.get("calendars", data.get("data", {}).get("calendars", {}))
            primary_cal = calendars.get("primary", {})
            busy_periods = primary_cal.get("busy", [])

            # Convert busy periods to datetime objects (naive UTC for comparison)
            busy_slots = []
            for period in busy_periods:
                start = datetime.fromisoformat(period["start"].replace("Z", "+00:00"))
                end = datetime.fromisoformat(period["end"].replace("Z", "+00:00"))
                # Convert to naive datetime for comparison with time_min/time_max
                start = start.replace(tzinfo=None)
                end = end.replace(tzinfo=None)
                busy_slots.append({"start": start, "end": end})

            # Calculate free slots
            free_slots = []
            current_time = time_min

            # Sort busy slots by start time
            busy_slots.sort(key=lambda x: x["start"])

            for busy in busy_slots:
                if current_time < busy["start"]:
                    gap_minutes = (busy["start"] - current_time).total_seconds() / 60
                    if gap_minutes >= duration_minutes:
                        free_slots.append({
                            "start": current_time,
                            "end": busy["start"],
                            "duration_minutes": int(gap_minutes),
                        })
                current_time = max(current_time, busy["end"])

            # Check for free time after last busy period
            if current_time < time_max:
                gap_minutes = (time_max - current_time).total_seconds() / 60
                if gap_minutes >= duration_minutes:
                    free_slots.append({
                        "start": current_time,
                        "end": time_max,
                        "duration_minutes": int(gap_minutes),
                    })

            # Convert datetime objects to ISO strings for JSON serialization
            serialized_free_slots = []
            for slot in free_slots:
                serialized_free_slots.append({
                    "start": slot["start"].isoformat() if isinstance(slot["start"], datetime) else slot["start"],
                    "end": slot["end"].isoformat() if isinstance(slot["end"], datetime) else slot["end"],
                    "duration_minutes": slot["duration_minutes"],
                })

            serialized_busy_slots = []
            for slot in busy_slots:
                serialized_busy_slots.append({
                    "start": slot["start"].isoformat() if isinstance(slot["start"], datetime) else slot["start"],
                    "end": slot["end"].isoformat() if isinstance(slot["end"], datetime) else slot["end"],
                })

            return {
                "success": True,
                "free_slots": serialized_free_slots,
                "busy_slots": serialized_busy_slots,
                "message": f"Found {len(free_slots)} free slots",
            }

        except Exception as e:
            logger.error(f"Error finding free slots: {e}", exc_info=True)
            # Fallback: Get events and calculate manually
            events_result = await self.get_calendar_events(user_id, time_min, time_max)
            if not events_result["success"]:
                return {
                    "success": False,
                    "free_slots": [],
                    "busy_slots": [],
                    "message": str(e),
                }

            # Calculate from events
            busy_slots = []
            for event in events_result["events"]:
                start = event["start_time"]
                end = event["end_time"]
                # Convert to naive datetime for comparison
                if isinstance(start, str):
                    start = datetime.fromisoformat(start.replace("Z", "+00:00")).replace(tzinfo=None)
                elif isinstance(start, datetime) and start.tzinfo is not None:
                    start = start.replace(tzinfo=None)
                if isinstance(end, str):
                    end = datetime.fromisoformat(end.replace("Z", "+00:00")).replace(tzinfo=None)
                elif isinstance(end, datetime) and end.tzinfo is not None:
                    end = end.replace(tzinfo=None)
                busy_slots.append({
                    "start": start,
                    "end": end,
                })

            busy_slots.sort(key=lambda x: x["start"])

            free_slots = []
            current_time = time_min

            for busy in busy_slots:
                if current_time < busy["start"]:
                    gap_minutes = (busy["start"] - current_time).total_seconds() / 60
                    if gap_minutes >= duration_minutes:
                        free_slots.append({
                            "start": current_time,
                            "end": busy["start"],
                            "duration_minutes": int(gap_minutes),
                        })
                current_time = max(current_time, busy["end"])

            if current_time < time_max:
                gap_minutes = (time_max - current_time).total_seconds() / 60
                if gap_minutes >= duration_minutes:
                    free_slots.append({
                        "start": current_time,
                        "end": time_max,
                        "duration_minutes": int(gap_minutes),
                    })

            # Convert datetime objects to ISO strings for JSON serialization
            serialized_free_slots = []
            for slot in free_slots:
                serialized_free_slots.append({
                    "start": slot["start"].isoformat() if isinstance(slot["start"], datetime) else slot["start"],
                    "end": slot["end"].isoformat() if isinstance(slot["end"], datetime) else slot["end"],
                    "duration_minutes": slot["duration_minutes"],
                })

            serialized_busy_slots = []
            for slot in busy_slots:
                serialized_busy_slots.append({
                    "start": slot["start"].isoformat() if isinstance(slot["start"], datetime) else slot["start"],
                    "end": slot["end"].isoformat() if isinstance(slot["end"], datetime) else slot["end"],
                })

            return {
                "success": True,
                "free_slots": serialized_free_slots,
                "busy_slots": serialized_busy_slots,
                "message": f"Found {len(free_slots)} free slots",
            }

    async def batch_reschedule_events(
        self,
        user_id: UUID,
        event_updates: list[dict],
        send_notifications: bool = True,
    ) -> dict:
        """
        Reschedule multiple calendar events at once.

        Args:
            user_id: User's UUID
            event_updates: List of {event_id, new_start_time, new_end_time}
            send_notifications: Whether to notify attendees

        Returns:
            Dict with results for each event
        """
        connection_id = await self._get_connection_id(user_id, "googlecalendar")
        if not connection_id:
            return {
                "success": False,
                "results": [],
                "message": "Calendar not connected",
            }

        results = []
        success_count = 0

        for update in event_updates:
            event_id = update.get("event_id")
            new_start = update.get("new_start_time")
            new_end = update.get("new_end_time")

            if not event_id or not new_start:
                results.append({
                    "event_id": event_id,
                    "success": False,
                    "message": "Missing event_id or new_start_time",
                })
                continue

            try:
                # Use PATCH for partial update (more efficient)
                params = {
                    "event_id": event_id,
                    "calendar_id": "primary",
                    "start_time": new_start.isoformat() if isinstance(new_start, datetime) else new_start,
                }

                if new_end:
                    params["end_time"] = new_end.isoformat() if isinstance(new_end, datetime) else new_end

                response = await self._execute_composio_action(
                    action="GOOGLECALENDAR_PATCH_EVENT",
                    params=params,
                    connected_account_id=connection_id,
                )

                data = response if isinstance(response, dict) else {}

                if data.get("successful", True):
                    results.append({
                        "event_id": event_id,
                        "success": True,
                        "message": "Rescheduled",
                    })
                    success_count += 1
                else:
                    results.append({
                        "event_id": event_id,
                        "success": False,
                        "message": data.get("error", "Unknown error"),
                    })

            except Exception as e:
                # Fallback to UPDATE_EVENT if PATCH fails
                try:
                    result = await self.update_calendar_event(
                        user_id=user_id,
                        event_id=event_id,
                        start_time=new_start if isinstance(new_start, datetime) else datetime.fromisoformat(new_start),
                        end_time=new_end if isinstance(new_end, datetime) else (datetime.fromisoformat(new_end) if new_end else None),
                        send_notifications=send_notifications,
                    )
                    results.append({
                        "event_id": event_id,
                        "success": result["success"],
                        "message": result["message"],
                    })
                    if result["success"]:
                        success_count += 1
                except Exception as e2:
                    results.append({
                        "event_id": event_id,
                        "success": False,
                        "message": str(e2),
                    })

        return {
            "success": success_count > 0,
            "results": results,
            "message": f"Rescheduled {success_count}/{len(event_updates)} events",
        }

    # ==================== ADVANCED EMAIL ACTIONS ====================

    async def get_email_thread(
        self,
        user_id: UUID,
        thread_id: str,
    ) -> dict:
        """
        Get all messages in an email thread.

        Args:
            user_id: User's UUID
            thread_id: Gmail thread ID

        Returns:
            Dict with thread messages
        """
        connection_id = await self._get_connection_id(user_id, "gmail")
        if not connection_id:
            return {
                "success": False,
                "messages": [],
                "message": "Gmail not connected",
            }

        try:
            response = await self._execute_composio_action(
                action="GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
                params={"thread_id": thread_id},
                connected_account_id=connection_id,
            )

            data = response if isinstance(response, dict) else {}
            messages_data = data.get("messages", data.get("data", {}).get("messages", []))

            messages = []
            for msg in messages_data:
                messages.append({
                    "id": msg.get("id"),
                    "thread_id": msg.get("threadId", thread_id),
                    "from": msg.get("from", "Unknown"),
                    "to": msg.get("to", []),
                    "subject": msg.get("subject", ""),
                    "body": msg.get("body", msg.get("snippet", "")),
                    "date": msg.get("date", msg.get("internalDate")),
                })

            return {
                "success": True,
                "messages": messages,
                "thread_id": thread_id,
                "message": f"Found {len(messages)} messages in thread",
            }

        except Exception as e:
            return {
                "success": False,
                "messages": [],
                "message": f"Error: {str(e)}",
            }

    async def reply_to_thread(
        self,
        user_id: UUID,
        thread_id: str,
        body: str,
        to: list[str] | None = None,
        cc: list[str] | None = None,
        is_html: bool = False,
    ) -> dict:
        """
        Reply to an email thread.

        Args:
            user_id: User's UUID
            thread_id: Gmail thread ID to reply to
            body: Reply message body
            to: Optional override recipients (defaults to thread participants)
            cc: Optional CC recipients
            is_html: Whether body is HTML

        Returns:
            Dict with sent message info
        """
        connection_id = await self._get_connection_id(user_id, "gmail")
        if not connection_id:
            return {
                "success": False,
                "message_id": None,
                "thread_id": thread_id,
                "message": "Gmail not connected",
            }

        try:
            params = {
                "thread_id": thread_id,
                "message_body": body,
                "is_html": is_html,
            }

            if to:
                params["recipient_email"] = to[0] if len(to) == 1 else to
                if len(to) > 1:
                    params["extra_recipients"] = to[1:]

            if cc:
                params["cc"] = cc

            response = await self._execute_composio_action(
                action="GMAIL_REPLY_TO_THREAD",
                params=params,
                connected_account_id=connection_id,
            )

            data = response if isinstance(response, dict) else {}
            result_data = data.get("data", data)

            if result_data and result_data.get("id"):
                message_id = result_data["id"]

                # Create memory for the reply
                content = f"Email reply in thread {thread_id}\n\n{body}"
                await self.memory_service.create_memory(
                    user_id=user_id,
                    content=content[:50000],
                    memory_type="email",
                    memory_date=datetime.utcnow(),
                    source_id=message_id,
                    source_url=f"https://mail.google.com/mail/u/0/#sent/{message_id}",
                )

                return {
                    "success": True,
                    "message_id": message_id,
                    "thread_id": thread_id,
                    "message": "Reply sent",
                }
            else:
                return {
                    "success": False,
                    "message_id": None,
                    "thread_id": thread_id,
                    "message": str(data.get("error", "Failed to send reply")),
                }

        except Exception as e:
            return {
                "success": False,
                "message_id": None,
                "thread_id": thread_id,
                "message": f"Error: {str(e)}",
            }

    async def search_emails(
        self,
        user_id: UUID,
        query: str,
        max_results: int = 10,
    ) -> dict:
        """
        Search emails with Gmail query syntax.

        Args:
            user_id: User's UUID
            query: Gmail search query (e.g., "from:john subject:meeting")
            max_results: Maximum results to return

        Returns:
            Dict with matching emails
        """
        connection_id = await self._get_connection_id(user_id, "gmail")
        if not connection_id:
            return {
                "success": False,
                "emails": [],
                "message": "Gmail not connected",
            }

        try:
            response = await self._execute_composio_action(
                action="GMAIL_FETCH_EMAILS",
                params={
                    "query": query,
                    "max_results": max_results,
                },
                connected_account_id=connection_id,
            )

            data = response if isinstance(response, dict) else {}
            messages = data.get("messages", data.get("data", []))

            if isinstance(data.get("data"), list):
                messages = data["data"]

            emails = []
            for msg in messages:
                # Check for sender in multiple fields - Composio returns it differently
                sender = msg.get("from") or msg.get("sender") or msg.get("preview", {}).get("from") or "Unknown"
                if isinstance(sender, dict):
                    sender = sender.get("email") or sender.get("name") or "Unknown"

                emails.append({
                    "id": msg.get("id"),
                    "thread_id": msg.get("threadId"),
                    "from": sender,
                    "subject": msg.get("subject") or msg.get("preview", {}).get("subject") or "No Subject",
                    "snippet": msg.get("snippet") or msg.get("body", "")[:200] or msg.get("preview", {}).get("body", "")[:200],
                    "date": msg.get("date", msg.get("receivedAt")),
                })

            return {
                "success": True,
                "emails": emails,
                "message": f"Found {len(emails)} emails",
            }

        except Exception as e:
            return {
                "success": False,
                "emails": [],
                "message": f"Error: {str(e)}",
            }

    # ==================== LOCATION SERVICES ====================

    async def search_places(
        self,
        user_id: UUID,
        query: str,
        location: tuple[float, float] | None = None,
        radius_meters: int = 5000,
    ) -> dict:
        """
        Search for places using Google Places API.

        Args:
            user_id: User's UUID
            query: Search query (e.g., "coffee shop", "quiet restaurant")
            location: Optional (lat, lng) to search near. If not provided,
                      uses the user's stored location from the database.
            radius_meters: Search radius in meters

        Returns:
            Dict with matching places
        """
        import httpx
        from app.models.user import User

        # If no location provided, try to get user's stored location
        if location is None:
            try:
                result = await self.db.execute(
                    select(User).where(User.id == user_id)
                )
                user = result.scalar_one_or_none()

                if user and user.location_lat and user.location_lng:
                    # Check if location is fresh (< 1 hour old)
                    if user.location_updated_at:
                        from datetime import timezone
                        age = datetime.utcnow() - user.location_updated_at.replace(tzinfo=None)
                        if age < timedelta(hours=1):
                            location = (user.location_lat, user.location_lng)
                            logger.debug(f"Using stored location for user {user_id}: {location}")
                        else:
                            logger.debug(f"User location is stale ({age}), searching without location bias")
                    else:
                        # No timestamp, use location anyway
                        location = (user.location_lat, user.location_lng)
                        logger.debug(f"Using stored location (no timestamp) for user {user_id}: {location}")
            except Exception as e:
                logger.error(f"Error fetching user location: {e}")

        # Use Google Places API directly if API key is available
        if settings.google_maps_api_key:
            try:
                async with httpx.AsyncClient() as client:
                    # Use Google Places Text Search API
                    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
                    params = {
                        "query": query,
                        "key": settings.google_maps_api_key,
                    }

                    # Add location bias if provided
                    if location:
                        params["location"] = f"{location[0]},{location[1]}"
                        params["radius"] = radius_meters

                    response = await client.get(url, params=params, timeout=10.0)
                    data = response.json()

                    if data.get("status") != "OK" and data.get("status") != "ZERO_RESULTS":
                        return {
                            "success": False,
                            "places": [],
                            "message": f"Google Places API error: {data.get('status')}",
                        }

                    results = data.get("results", [])
                    places = []

                    for place in results[:5]:
                        place_id = place.get("place_id", "")
                        places.append({
                            "name": place.get("name", "Unknown"),
                            "address": place.get("formatted_address", ""),
                            "location": place.get("geometry", {}).get("location", {}),
                            "rating": place.get("rating"),
                            "price_level": place.get("price_level"),
                            "types": place.get("types", []),
                            "google_maps_url": f"https://www.google.com/maps/place/?q=place_id:{place_id}" if place_id else "",
                            "open_now": place.get("opening_hours", {}).get("open_now"),
                        })

                    return {
                        "success": True,
                        "places": places,
                        "message": f"Found {len(places)} places",
                    }

            except Exception as e:
                logger.error(f"Google Places API error: {e}")
                # Fall through to Composio attempt

        # Fallback to Composio if available
        if self.toolset:
            try:
                params = {
                    "text_query": query,
                    "max_results": 5,
                }

                if location:
                    params["location_bias"] = {
                        "circle": {
                            "center": {"latitude": location[0], "longitude": location[1]},
                            "radius": radius_meters,
                        }
                    }

                response = await self._execute_composio_action(
                    action="GOOGLE_MAPS_TEXT_SEARCH",
                    params=params,
                    connected_account_id=connection_id,
                )

                data = response if isinstance(response, dict) else {}
                results = data.get("places", data.get("data", {}).get("places", []))

                places = []
                for place in results:
                    places.append({
                        "name": place.get("displayName", {}).get("text", place.get("name", "Unknown")),
                        "address": place.get("formattedAddress", place.get("address", "")),
                        "location": place.get("location", {}),
                        "rating": place.get("rating"),
                        "price_level": place.get("priceLevel"),
                        "types": place.get("types", []),
                        "google_maps_url": place.get("googleMapsUri", ""),
                    })

                return {
                    "success": True,
                    "places": places,
                    "message": f"Found {len(places)} places",
                }

            except Exception as e:
                logger.error(f"Composio Google Maps error: {e}")

        return {
            "success": False,
            "places": [],
            "message": "Google Maps not configured. Add GOOGLE_MAPS_API_KEY to .env",
        }

    # ==================== HELPERS ====================

    async def _check_existing_memory(
        self,
        user_id: UUID,
        memory_type: str,
        source_id: str,
    ) -> bool:
        """Check if a memory with this source already exists."""
        from app.models.memory import Memory

        result = await self.db.execute(
            select(Memory).where(
                and_(
                    Memory.user_id == user_id,
                    Memory.memory_type == memory_type,
                    Memory.source_id == source_id,
                )
            )
        )
        return result.scalar_one_or_none() is not None

    async def _get_sync_state(
        self,
        user_id: UUID,
        provider: str,
        resource_type: str,
    ) -> SyncState | None:
        """Get sync state for a resource."""
        result = await self.db.execute(
            select(SyncState).where(
                and_(
                    SyncState.user_id == user_id,
                    SyncState.provider == provider,
                    SyncState.resource_type == resource_type,
                )
            )
        )
        return result.scalar_one_or_none()

    async def _update_sync_state(
        self,
        user_id: UUID,
        provider: str,
        resource_type: str,
        sync_token: str | None = None,
    ) -> SyncState:
        """Update or create sync state."""
        state = await self._get_sync_state(user_id, provider, resource_type)

        if state:
            state.last_sync_at = datetime.utcnow()
            if sync_token:
                state.last_sync_token = sync_token
        else:
            state = SyncState(
                user_id=user_id,
                provider=provider,
                resource_type=resource_type,
                last_sync_at=datetime.utcnow(),
                last_sync_token=sync_token,
            )
            self.db.add(state)

        await self.db.commit()
        return state
