import jwt
import httpx
from datetime import datetime, timedelta
from uuid import UUID
from jose import JWTError
from jwt import PyJWKClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import get_settings
from app.models.user import User

settings = get_settings()

# Apple's public keys endpoint
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
# Google's token info endpoint
GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"

# Cache Apple's JWK client for performance
_apple_jwk_client: PyJWKClient | None = None


def _get_apple_jwk_client() -> PyJWKClient:
    """Get or create Apple JWK client with caching."""
    global _apple_jwk_client
    if _apple_jwk_client is None:
        _apple_jwk_client = PyJWKClient(APPLE_KEYS_URL, cache_keys=True)
    return _apple_jwk_client


class AuthService:
    """Service for authentication and JWT token management."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def verify_apple_token(self, identity_token: str) -> dict:
        """
        Verify Apple identity token and return claims.

        In production:
        1. Fetches Apple's public keys
        2. Verifies the JWT signature
        3. Validates claims (iss, aud, exp)

        In development: Falls back to unverified decoding for testing.
        """
        try:
            if settings.environment == "production":
                # Production: Full signature verification with Apple's public keys
                jwk_client = _get_apple_jwk_client()
                signing_key = jwk_client.get_signing_key_from_jwt(identity_token)

                claims = jwt.decode(
                    identity_token,
                    signing_key.key,
                    algorithms=["RS256"],
                    audience=settings.apple_client_id,
                    issuer="https://appleid.apple.com",
                )
            else:
                # Development: Decode without verification for testing
                # Still validate claims manually
                claims = jwt.decode(
                    identity_token,
                    options={"verify_signature": False},
                )

                # Validate issuer
                if claims.get("iss") != "https://appleid.apple.com":
                    raise ValueError("Invalid token issuer")

                # Validate audience (your app's client ID)
                if claims.get("aud") != settings.apple_client_id:
                    raise ValueError("Invalid token audience")

                # Check expiration
                exp = claims.get("exp", 0)
                if datetime.utcnow().timestamp() > exp:
                    raise ValueError("Token expired")

            return {
                "sub": claims.get("sub"),  # Apple user ID
                "email": claims.get("email"),
            }
        except jwt.exceptions.DecodeError:
            raise ValueError("Invalid token format")
        except jwt.exceptions.InvalidTokenError as e:
            raise ValueError(f"Token validation failed: {str(e)}")

    async def verify_google_token(self, id_token: str) -> dict:
        """
        Verify Google ID token and return claims.

        Uses Google's tokeninfo endpoint to verify the token.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    GOOGLE_TOKEN_INFO_URL,
                    params={"id_token": id_token},
                )

                if response.status_code != 200:
                    raise ValueError("Invalid Google token")

                data = response.json()

                # Validate the token
                if "error" in data:
                    raise ValueError(data.get("error_description", "Token validation failed"))

                return {
                    "sub": data.get("sub"),  # Google user ID
                    "email": data.get("email"),
                    "name": data.get("name"),
                    "email_verified": data.get("email_verified") == "true",
                }
        except httpx.RequestError:
            raise ValueError("Failed to verify token with Google")

    async def get_or_create_user(
        self,
        oauth_id: str,
        email: str,
        name: str | None = None,
    ) -> tuple[User, bool]:
        """
        Get existing user or create new one.
        Returns (user, is_new_user).

        Args:
            oauth_id: OAuth provider ID (e.g., Apple sub, Google sub with prefix)
            email: User's email address
            name: User's display name (optional)
        """
        # Try to find existing user
        result = await self.db.execute(
            select(User).where(User.oauth_id == oauth_id)
        )
        user = result.scalar_one_or_none()

        if user:
            # Update email if changed
            if user.email != email:
                user.email = email
                await self.db.commit()
            return user, False

        # Create new user
        user = User(
            oauth_id=oauth_id,
            email=email,
            name=name,
        )
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)

        return user, True

    def create_access_token(self, user_id: UUID) -> str:
        """Create a JWT access token."""
        expires = datetime.utcnow() + timedelta(
            minutes=settings.access_token_expire_minutes
        )
        payload = {
            "sub": str(user_id),
            "exp": expires,
            "type": "access",
        }
        return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    def create_refresh_token(self, user_id: UUID) -> str:
        """Create a JWT refresh token."""
        expires = datetime.utcnow() + timedelta(
            days=settings.refresh_token_expire_days
        )
        payload = {
            "sub": str(user_id),
            "exp": expires,
            "type": "refresh",
        }
        return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    def verify_token(self, token: str, token_type: str = "access") -> UUID:
        """
        Verify a JWT token and return the user ID.
        Raises JWTError if invalid.
        """
        try:
            payload = jwt.decode(
                token,
                settings.jwt_secret,
                algorithms=[settings.jwt_algorithm],
            )

            if payload.get("type") != token_type:
                raise JWTError("Invalid token type")

            user_id = payload.get("sub")
            if not user_id:
                raise JWTError("Invalid token payload")

            return UUID(user_id)
        except jwt.ExpiredSignatureError:
            raise JWTError("Token expired")
        except jwt.InvalidTokenError as e:
            raise JWTError(f"Invalid token: {str(e)}")

    async def get_user_by_id(self, user_id: UUID) -> User | None:
        """Get user by ID."""
        result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def delete_user(self, user_id: UUID) -> bool:
        """Delete user and all associated data."""
        user = await self.get_user_by_id(user_id)
        if not user:
            return False

        await self.db.delete(user)
        await self.db.commit()
        return True
