"""API endpoints for push notification management."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import Database, CurrentUser
from app.services.push_service import PushService

router = APIRouter()


class RegisterTokenRequest(BaseModel):
    """Request to register a push notification token."""

    push_token: str
    platform: str  # 'ios' or 'android'
    device_name: str | None = None


class UnregisterTokenRequest(BaseModel):
    """Request to unregister a push notification token."""

    push_token: str


class TokenResponse(BaseModel):
    """Response after token registration."""

    success: bool
    message: str | None = None


@router.post("/register", response_model=TokenResponse)
async def register_push_token(
    request: RegisterTokenRequest,
    current_user: CurrentUser,
    db: Database,
) -> TokenResponse:
    """
    Register a push notification token for the current user.

    This endpoint should be called when:
    - User logs in on a new device
    - Push token is refreshed by the OS
    """
    push_service = PushService(db)

    await push_service.register_token(
        user_id=current_user.id,
        push_token=request.push_token,
        platform=request.platform,
        device_name=request.device_name,
    )

    return TokenResponse(success=True, message="Token registered successfully")


@router.post("/unregister", response_model=TokenResponse)
async def unregister_push_token(
    request: UnregisterTokenRequest,
    current_user: CurrentUser,
    db: Database,
) -> TokenResponse:
    """
    Unregister a push notification token.

    This endpoint should be called when:
    - User logs out
    - User disables notifications
    """
    push_service = PushService(db)

    success = await push_service.unregister_token(request.push_token)

    if success:
        return TokenResponse(success=True, message="Token unregistered successfully")
    else:
        return TokenResponse(success=False, message="Token not found")


@router.get("/status")
async def get_notification_status(
    current_user: CurrentUser,
    db: Database,
) -> dict:
    """
    Get the current user's notification status.

    Returns the number of registered devices.
    """
    push_service = PushService(db)

    tokens = await push_service.get_user_tokens(current_user.id)

    return {
        "enabled": len(tokens) > 0,
        "device_count": len(tokens),
        "devices": [
            {
                "platform": t.platform,
                "device_name": t.device_name,
                "registered_at": t.created_at.isoformat(),
            }
            for t in tokens
        ],
    }
