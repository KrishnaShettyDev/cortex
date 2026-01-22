from uuid import UUID
from typing import Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from jose import JWTError

from app.database import get_db
from app.models.user import User
from app.services.auth_service import AuthService

# HTTP Bearer token security
security = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """
    Dependency that extracts and validates the JWT token,
    then returns the current user.
    """
    token = credentials.credentials

    auth_service = AuthService(db)

    try:
        user_id = auth_service.verify_token(token, token_type="access")
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = await auth_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


# Type alias for cleaner dependency injection
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db)]
