"""
Cortex Memory SDK - Type Definitions
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from datetime import datetime


@dataclass
class Memory:
    """A memory stored in Cortex"""
    id: str
    user_id: str
    content: str
    source: str
    container_tag: str
    created_at: str
    updated_at: str
    version: int = 1
    is_latest: bool = True
    processing_status: str = "done"
    importance_score: Optional[float] = None
    memory_type: Optional[str] = None
    event_date: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class Entity:
    """An entity (person, place, thing) extracted from memories"""
    id: str
    name: str
    entity_type: str
    canonical_name: str
    user_id: str
    container_tag: str
    importance_score: float
    first_seen: str
    last_seen: str
    memory_count: int
    attributes: Optional[Dict[str, Any]] = None


@dataclass
class EntityRelationship:
    """A relationship between two entities"""
    id: str
    source_entity_id: str
    target_entity_id: str
    relationship_type: str
    confidence: float
    source_memory_ids: List[str]
    created_at: str
    updated_at: str


@dataclass
class Learning:
    """An auto-extracted learning about the user"""
    id: str
    category: str
    statement: str
    confidence: float
    status: str
    source_memory_ids: List[str]
    created_at: str
    updated_at: str


@dataclass
class Belief:
    """A Bayesian belief formed from evidence"""
    id: str
    domain: str
    belief_type: str
    statement: str
    confidence: float
    evidence_count: int
    status: str
    created_at: str
    updated_at: str


@dataclass
class Commitment:
    """A tracked commitment or promise"""
    id: str
    title: str
    description: Optional[str]
    commitment_type: str
    status: str
    due_date: Optional[str]
    entity_id: Optional[str]
    entity_name: Optional[str]
    source_memory_id: str
    created_at: str
    updated_at: str
    completed_at: Optional[str] = None
    cancelled_at: Optional[str] = None


@dataclass
class Nudge:
    """A proactive nudge for relationship maintenance"""
    id: str
    nudge_type: str
    priority: str
    title: str
    message: str
    entity_id: Optional[str]
    entity_name: Optional[str]
    suggested_action: Optional[str]
    scheduled_for: str
    status: str
    created_at: str


@dataclass
class RelationshipHealth:
    """Health score for a relationship with an entity"""
    entity_id: str
    entity_name: str
    entity_type: str
    health_score: float
    health_status: str
    total_interactions: int
    last_interaction_date: Optional[str]
    days_since_last_interaction: Optional[int]
    pending_commitments: int
    recommendations: List[str] = field(default_factory=list)
    risk_factors: List[str] = field(default_factory=list)


@dataclass
class ProfileData:
    """User profile with static and dynamic facts"""
    static_facts: List[str]
    dynamic_facts: List[str]
    summary: Optional[str] = None


@dataclass
class DailyBriefing:
    """Generated daily briefing"""
    date: str
    summary: str
    priorities: List[Dict[str, Any]]
    calendar: List[Dict[str, Any]]
    commitments: List[Dict[str, Any]]
    nudges: List[Dict[str, Any]]
    weather: Optional[Dict[str, Any]] = None


@dataclass
class SearchResult:
    """Search result from memory search"""
    memories: List[Dict[str, Any]]
    chunks: List[Dict[str, Any]]
    total: int
    timing: int


@dataclass
class RecallResult:
    """Result from recall operation"""
    context: str
    memories: List[Dict[str, Any]]
    profile: Optional[ProfileData] = None
    entities: Optional[List[Dict[str, Any]]] = None


@dataclass
class SyncConnection:
    """A connected sync source (Gmail, Calendar, etc.)"""
    id: str
    provider: str
    account_id: str
    is_active: bool
    sync_enabled: bool
    last_sync_at: Optional[str]
    sync_frequency: str
    created_at: str


@dataclass
class SyncStatus:
    """Overall sync status"""
    active_connections: int
    last_sync_times: Dict[str, str]
    next_sync_times: Dict[str, str]
    total_items_synced: int


@dataclass
class TimelineEvent:
    """An event on the temporal timeline"""
    date: str
    event_type: str
    title: str
    description: str
    memory_id: Optional[str] = None
    entity_id: Optional[str] = None


@dataclass
class GraphStats:
    """Statistics about the entity graph"""
    total_entities: int
    total_relationships: int
    entities_by_type: Dict[str, int]
    average_connections: float


class CortexError(Exception):
    """Custom exception for Cortex API errors"""

    def __init__(
        self,
        message: str,
        status_code: int = 0,
        code: Optional[str] = None,
        details: Optional[Any] = None
    ):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.details = details

    def __str__(self) -> str:
        if self.code:
            return f"[{self.code}] {super().__str__()} (status: {self.status_code})"
        return f"{super().__str__()} (status: {self.status_code})"
