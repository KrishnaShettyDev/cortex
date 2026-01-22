"""API endpoints for memory connections."""

from uuid import UUID
from fastapi import APIRouter, HTTPException, status, Query
from pydantic import BaseModel

from app.api.deps import Database, CurrentUser
from app.services.connection_service import ConnectionService


router = APIRouter()


class MemoryBrief(BaseModel):
    """Brief memory reference."""
    id: str
    content: str
    memory_type: str
    memory_date: str | None
    summary: str | None


class ConnectionResponse(BaseModel):
    """Response for a single connection."""
    id: str
    connection_type: str
    strength: float
    explanation: str | None
    created_at: str
    memory_1: MemoryBrief
    memory_2: MemoryBrief


class ConnectionListResponse(BaseModel):
    """Response for listing connections."""
    connections: list[ConnectionResponse]
    total: int


class DismissResponse(BaseModel):
    """Response for dismissing a connection."""
    success: bool
    message: str


@router.get("", response_model=ConnectionListResponse)
async def list_connections(
    current_user: CurrentUser,
    db: Database,
    limit: int = Query(20, ge=1, le=50),
    unnotified_only: bool = Query(False),
):
    """
    List discovered memory connections.

    Connections show related memories that were discovered automatically.
    Use unnotified_only=true to get only new connections.
    """
    connection_service = ConnectionService(db)
    connections = await connection_service.get_connections(
        user_id=current_user.id,
        limit=limit,
        unnotified_only=unnotified_only,
    )

    results = []
    for conn in connections:
        # Fetch the associated memories
        data = await connection_service.get_connection_with_memories(
            connection_id=conn.id,
            user_id=current_user.id,
        )
        if not data:
            continue

        connection, memory1, memory2 = data
        results.append(
            ConnectionResponse(
                id=str(connection.id),
                connection_type=connection.connection_type,
                strength=connection.strength,
                explanation=connection.explanation,
                created_at=connection.created_at.isoformat(),
                memory_1=MemoryBrief(
                    id=str(memory1.id),
                    content=memory1.content[:300],
                    memory_type=memory1.memory_type,
                    memory_date=memory1.memory_date.isoformat() if memory1.memory_date else None,
                    summary=memory1.summary,
                ),
                memory_2=MemoryBrief(
                    id=str(memory2.id),
                    content=memory2.content[:300],
                    memory_type=memory2.memory_type,
                    memory_date=memory2.memory_date.isoformat() if memory2.memory_date else None,
                    summary=memory2.summary,
                ),
            )
        )

    return ConnectionListResponse(
        connections=results,
        total=len(results),
    )


@router.get("/{connection_id}", response_model=ConnectionResponse)
async def get_connection(
    connection_id: UUID,
    current_user: CurrentUser,
    db: Database,
):
    """
    Get details of a specific connection.
    """
    connection_service = ConnectionService(db)
    data = await connection_service.get_connection_with_memories(
        connection_id=connection_id,
        user_id=current_user.id,
    )

    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Connection not found",
        )

    connection, memory1, memory2 = data
    return ConnectionResponse(
        id=str(connection.id),
        connection_type=connection.connection_type,
        strength=connection.strength,
        explanation=connection.explanation,
        created_at=connection.created_at.isoformat(),
        memory_1=MemoryBrief(
            id=str(memory1.id),
            content=memory1.content[:300],
            memory_type=memory1.memory_type,
            memory_date=memory1.memory_date.isoformat() if memory1.memory_date else None,
            summary=memory1.summary,
        ),
        memory_2=MemoryBrief(
            id=str(memory2.id),
            content=memory2.content[:300],
            memory_type=memory2.memory_type,
            memory_date=memory2.memory_date.isoformat() if memory2.memory_date else None,
            summary=memory2.summary,
        ),
    )


@router.post("/{connection_id}/dismiss", response_model=DismissResponse)
async def dismiss_connection(
    connection_id: UUID,
    current_user: CurrentUser,
    db: Database,
):
    """
    Dismiss/acknowledge a connection.

    Dismissed connections won't appear in the default list.
    """
    connection_service = ConnectionService(db)
    success = await connection_service.dismiss_connection(
        connection_id=connection_id,
        user_id=current_user.id,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Connection not found",
        )

    return DismissResponse(
        success=True,
        message="Connection dismissed",
    )
