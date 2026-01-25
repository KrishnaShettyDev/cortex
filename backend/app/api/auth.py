from fastapi import APIRouter, HTTPException, status, Request

from app.api.deps import Database, CurrentUser
from app.rate_limiter import limiter
from app.services.auth_service import AuthService
from app.schemas.auth import (
    AppleAuthRequest,
    DevAuthRequest,
    GoogleAuthRequest,
    TokenResponse,
    RefreshTokenRequest,
    AccessTokenResponse,
    UserResponse,
    LocationUpdateRequest,
    LocationUpdateResponse,
    LocationResponse,
)
from app.config import settings

router = APIRouter()


@router.post("/apple", response_model=TokenResponse)
@limiter.limit("10/minute")
async def authenticate_with_apple(
    request: Request,
    auth_request: AppleAuthRequest,
    db: Database,
):
    """
    Authenticate with Apple Sign-In.

    Takes the identity token from Sign in with Apple and returns
    access and refresh tokens.
    """
    auth_service = AuthService(db)

    try:
        # Verify Apple token
        claims = await auth_service.verify_apple_token(auth_request.identity_token)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )

    # Get or create user
    email = auth_request.email or claims.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is required",
        )

    user, is_new_user = await auth_service.get_or_create_user(
        oauth_id=claims["sub"],
        email=email,
        name=auth_request.name,
    )

    # Create tokens
    access_token = auth_service.create_access_token(user.id)
    refresh_token = auth_service.create_refresh_token(user.id)

    return TokenResponse(
        user_id=user.id,
        access_token=access_token,
        refresh_token=refresh_token,
        is_new_user=is_new_user,
    )


@router.post("/google", response_model=TokenResponse)
@limiter.limit("10/minute")
async def authenticate_with_google(
    request: Request,
    auth_request: GoogleAuthRequest,
    db: Database,
):
    """
    Authenticate with Google Sign-In.

    Takes the ID token from Google Sign-In and returns
    access and refresh tokens.
    """
    auth_service = AuthService(db)

    try:
        # Verify Google token
        claims = await auth_service.verify_google_token(auth_request.id_token)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )

    # Get email from token or request
    email = auth_request.email or claims.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is required",
        )

    # Get or create user with Google ID (prefixed to distinguish from Apple IDs)
    google_oauth_id = f"google_{claims['sub']}"
    user, is_new_user = await auth_service.get_or_create_user(
        oauth_id=google_oauth_id,
        email=email,
        name=auth_request.name or claims.get("name"),
    )

    # Create tokens
    access_token = auth_service.create_access_token(user.id)
    refresh_token = auth_service.create_refresh_token(user.id)

    return TokenResponse(
        user_id=user.id,
        access_token=access_token,
        refresh_token=refresh_token,
        is_new_user=is_new_user,
    )


# Development-only endpoint - conditionally registered
if settings.environment == "development":
    @router.post("/dev", response_model=TokenResponse)
    @limiter.limit("20/minute")
    async def dev_authenticate(
        request: Request,
        dev_request: DevAuthRequest,
        db: Database,
    ):
        """
        Development-only authentication endpoint.

        Creates or retrieves a user by email without requiring Apple Sign-In.
        This endpoint is ONLY registered when ENVIRONMENT is 'development'.
        It does not exist in production builds.
        """
        auth_service = AuthService(db)

        # Generate a dev oauth_id from the email
        dev_oauth_id = f"dev_{dev_request.email}"

        user, is_new_user = await auth_service.get_or_create_user(
            oauth_id=dev_oauth_id,
            email=dev_request.email,
            name=dev_request.name,
        )

        # Create tokens
        access_token = auth_service.create_access_token(user.id)
        refresh_token = auth_service.create_refresh_token(user.id)

        return TokenResponse(
            user_id=user.id,
            access_token=access_token,
            refresh_token=refresh_token,
            is_new_user=is_new_user,
        )


@router.post("/refresh", response_model=AccessTokenResponse)
@limiter.limit("30/minute")
async def refresh_access_token(
    request: Request,
    refresh_request: RefreshTokenRequest,
    db: Database,
):
    """
    Refresh the access token using a refresh token.
    """
    auth_service = AuthService(db)

    try:
        user_id = auth_service.verify_token(refresh_request.refresh_token, token_type="refresh")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )

    # Verify user still exists
    user = await auth_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    access_token = auth_service.create_access_token(user.id)

    return AccessTokenResponse(access_token=access_token)


@router.get("/me", response_model=UserResponse)
@limiter.limit("60/minute")
async def get_current_user_profile(
    request: Request,
    current_user: CurrentUser,
):
    """
    Get the current user's profile.
    """
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        created_at=current_user.created_at.isoformat(),
    )


@router.delete("/account")
@limiter.limit("5/minute")
async def delete_account(
    request: Request,
    current_user: CurrentUser,
    db: Database,
):
    """
    Delete the current user's account and all associated data.

    This action is irreversible.
    """
    auth_service = AuthService(db)
    await auth_service.delete_user(current_user.id)

    return {"success": True, "message": "Account deleted successfully"}


@router.post("/location", response_model=LocationUpdateResponse)
@limiter.limit("60/minute")
async def update_user_location(
    request: Request,
    location_request: LocationUpdateRequest,
    current_user: CurrentUser,
    db: Database,
):
    """
    Update the current user's location.

    Called automatically when the app comes to foreground.
    The location is stored server-side and used for place searches.
    """
    from datetime import datetime, timezone

    current_user.location_lat = location_request.latitude
    current_user.location_lng = location_request.longitude
    current_user.location_updated_at = datetime.now(timezone.utc)

    await db.commit()

    return LocationUpdateResponse(success=True)


@router.get("/location", response_model=LocationResponse)
@limiter.limit("60/minute")
async def get_user_location(
    request: Request,
    current_user: CurrentUser,
):
    """
    Get the current user's stored location.

    Returns the location with a flag indicating if it's stale (> 1 hour old).
    """
    from datetime import datetime, timezone, timedelta

    is_stale = False
    if current_user.location_updated_at:
        age = datetime.now(timezone.utc) - current_user.location_updated_at.replace(
            tzinfo=timezone.utc
        )
        is_stale = age > timedelta(hours=1)

    return LocationResponse(
        latitude=current_user.location_lat,
        longitude=current_user.location_lng,
        updated_at=current_user.location_updated_at,
        is_stale=is_stale,
    )
