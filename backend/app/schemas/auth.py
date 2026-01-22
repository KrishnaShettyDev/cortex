from pydantic import BaseModel, EmailStr, Field
from uuid import UUID
from datetime import datetime


class AppleAuthRequest(BaseModel):
    """Request body for Apple Sign-In authentication."""

    identity_token: str
    authorization_code: str
    name: str | None = None
    email: EmailStr | None = None


class DevAuthRequest(BaseModel):
    """Request body for development-only authentication."""

    email: EmailStr
    name: str | None = None


class GoogleAuthRequest(BaseModel):
    """Request body for Google Sign-In authentication."""

    id_token: str
    name: str | None = None
    email: EmailStr | None = None


class TokenResponse(BaseModel):
    """Response with access and refresh tokens."""

    user_id: UUID
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    is_new_user: bool = False


class RefreshTokenRequest(BaseModel):
    """Request to refresh access token."""

    refresh_token: str


class AccessTokenResponse(BaseModel):
    """Response with new access token."""

    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    """User profile response."""

    id: UUID
    email: str
    name: str | None
    created_at: str

    class Config:
        from_attributes = True


class LocationUpdateRequest(BaseModel):
    """Request to update user's location."""

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)


class LocationUpdateResponse(BaseModel):
    """Response after updating location."""

    success: bool = True


class LocationResponse(BaseModel):
    """Response with user's stored location."""

    latitude: float | None
    longitude: float | None
    updated_at: datetime | None
    is_stale: bool = False  # True if location is older than 1 hour
