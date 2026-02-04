"""
Cortex Memory SDK - Cognitive memory platform for AI applications

Usage:
    from cortex_memory import CortexClient

    cortex = CortexClient(api_key="ctx_...")

    # Add a memory
    memory = cortex.memories.add("User prefers dark mode")

    # Search memories
    results = cortex.memories.search("user preferences")

    # Get beliefs (unique to Cortex!)
    beliefs = cortex.cognitive.beliefs()

    # Get nudges
    nudges = cortex.proactive.nudges()
"""

from .client import (
    CortexClient,
    MemoriesClient,
    EntitiesClient,
    CognitiveClient,
    ProactiveClient,
    RelationshipsClient,
    SyncClient,
)
from .types import (
    CortexError,
    Memory,
    Entity,
    EntityRelationship,
    Learning,
    Belief,
    Commitment,
    Nudge,
    RelationshipHealth,
    ProfileData,
    DailyBriefing,
    SearchResult,
    RecallResult,
    SyncConnection,
    SyncStatus,
    TimelineEvent,
    GraphStats,
)

__version__ = "0.1.0"
__all__ = [
    # Main client
    "CortexClient",
    # Sub-clients
    "MemoriesClient",
    "EntitiesClient",
    "CognitiveClient",
    "ProactiveClient",
    "RelationshipsClient",
    "SyncClient",
    # Types
    "CortexError",
    "Memory",
    "Entity",
    "EntityRelationship",
    "Learning",
    "Belief",
    "Commitment",
    "Nudge",
    "RelationshipHealth",
    "ProfileData",
    "DailyBriefing",
    "SearchResult",
    "RecallResult",
    "SyncConnection",
    "SyncStatus",
    "TimelineEvent",
    "GraphStats",
]
