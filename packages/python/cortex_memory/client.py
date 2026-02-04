"""
Cortex Memory SDK - Main Client

Usage:
    from cortex_memory import CortexClient

    cortex = CortexClient(api_key="ctx_...")

    # Add a memory
    memory = cortex.memories.add("User prefers dark mode")

    # Search memories
    results = cortex.memories.search("user preferences")

    # Get beliefs
    beliefs = cortex.cognitive.beliefs()
"""

from typing import Any, Dict, List, Optional
import httpx

from .types import (
    CortexError,
    Memory,
    Entity,
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
)


DEFAULT_BASE_URL = "https://askcortex.plutas.in"
DEFAULT_TIMEOUT = 30.0


class CortexClient:
    """
    Cortex Memory SDK Client

    Args:
        api_key: Your Cortex API key (starts with 'ctx_')
        base_url: API base URL (default: https://askcortex.plutas.in)
        container_tag: Multi-tenant container tag (default: 'default')
        timeout: Request timeout in seconds (default: 30)

    Example:
        >>> from cortex_memory import CortexClient
        >>> cortex = CortexClient(api_key="ctx_...")
        >>> memory = cortex.memories.add("User prefers TypeScript")
        >>> results = cortex.memories.search("programming preferences")
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        container_tag: str = "default",
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self.base_url = base_url.rstrip("/")
        self.container_tag = container_tag
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self._client = httpx.Client(headers=self._headers, timeout=timeout)

        # Initialize sub-clients
        self.memories = MemoriesClient(self)
        self.entities = EntitiesClient(self)
        self.cognitive = CognitiveClient(self)
        self.proactive = ProactiveClient(self)
        self.relationships = RelationshipsClient(self)
        self.sync = SyncClient(self)

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Make an API request"""
        url = f"{self.base_url}{path}"

        # Add container_tag to params
        if params is None:
            params = {}
        if "container_tag" not in params:
            params["container_tag"] = self.container_tag

        # Filter out None values
        params = {k: v for k, v in params.items() if v is not None}

        try:
            response = self._client.request(
                method=method,
                url=url,
                params=params,
                json=json,
            )

            if not response.is_success:
                error_data = response.json() if response.content else {}
                raise CortexError(
                    message=error_data.get("message", error_data.get("error", response.reason_phrase)),
                    status_code=response.status_code,
                    code=error_data.get("code"),
                    details=error_data.get("details"),
                )

            return response.json()

        except httpx.TimeoutException:
            raise CortexError("Request timeout", 408, "TIMEOUT")
        except httpx.RequestError as e:
            raise CortexError(str(e), 0, "NETWORK_ERROR")

    def recall(
        self,
        query: str,
        limit: int = 10,
        include_profile: bool = True,
        include_entities: bool = False,
    ) -> RecallResult:
        """
        Recall memories with context building.

        Args:
            query: What to recall
            limit: Maximum memories to return
            include_profile: Include user profile in response
            include_entities: Include related entities

        Returns:
            RecallResult with context and memories
        """
        result = self._request("POST", "/v3/recall", json={
            "query": query,
            "limit": limit,
            "include_profile": include_profile,
            "include_entities": include_entities,
        })
        return RecallResult(
            context=result.get("context", ""),
            memories=result.get("memories", []),
            profile=ProfileData(**result["profile"]) if result.get("profile") else None,
            entities=result.get("entities"),
        )

    def get_profile(self) -> ProfileData:
        """Get user profile with static and dynamic facts."""
        result = self._request("GET", "/v3/profile")
        return ProfileData(
            static_facts=result.get("static", []),
            dynamic_facts=result.get("dynamic", []),
            summary=result.get("summary"),
        )

    def get_briefing(
        self,
        location: Optional[Dict[str, float]] = None,
        timezone: Optional[str] = None,
    ) -> DailyBriefing:
        """
        Generate a daily briefing.

        Args:
            location: Optional location with lat/lon
            timezone: Optional timezone string

        Returns:
            DailyBriefing with priorities, calendar, nudges
        """
        body = {}
        if location:
            body["location"] = location
        if timezone:
            body["timezone"] = timezone

        result = self._request("POST", "/v3/briefing/generate", json=body)
        return DailyBriefing(**result)

    def health(self) -> Dict[str, Any]:
        """Check API health status."""
        return self._request("GET", "/health")

    def close(self):
        """Close the HTTP client."""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class MemoriesClient:
    """Client for memory operations"""

    def __init__(self, client: CortexClient):
        self._client = client

    def add(
        self,
        content: str,
        source: str = "sdk",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Memory:
        """
        Add a new memory.

        Args:
            content: The memory content
            source: Source identifier (e.g., 'sdk', 'api', 'import')
            metadata: Optional metadata dict

        Returns:
            The created Memory
        """
        body = {"content": content, "source": source}
        if metadata:
            body["metadata"] = metadata

        result = self._client._request("POST", "/v3/memories", json=body)
        return Memory(**result.get("memory", result))

    def get(self, memory_id: str) -> Memory:
        """Get a memory by ID."""
        result = self._client._request("GET", f"/v3/memories/{memory_id}")
        return Memory(**result)

    def list(
        self,
        limit: int = 20,
        offset: int = 0,
        sort: str = "created_at",
        order: str = "desc",
    ) -> List[Memory]:
        """
        List memories with pagination.

        Args:
            limit: Max memories to return
            offset: Pagination offset
            sort: Sort field
            order: Sort order (asc/desc)

        Returns:
            List of Memory objects
        """
        result = self._client._request("GET", "/v3/memories", params={
            "limit": limit,
            "offset": offset,
            "sort": sort,
            "order": order,
        })
        return [Memory(**m) for m in result.get("memories", [])]

    def update(
        self,
        memory_id: str,
        content: Optional[str] = None,
        importance_score: Optional[float] = None,
    ) -> Memory:
        """Update a memory."""
        body = {}
        if content is not None:
            body["content"] = content
        if importance_score is not None:
            body["importance_score"] = importance_score

        result = self._client._request("PUT", f"/v3/memories/{memory_id}", json=body)
        return Memory(**result)

    def delete(self, memory_id: str) -> None:
        """Delete (forget) a memory."""
        self._client._request("DELETE", f"/v3/memories/{memory_id}")

    def search(
        self,
        query: str,
        limit: int = 10,
        mode: str = "hybrid",
        min_importance: Optional[float] = None,
    ) -> SearchResult:
        """
        Search memories.

        Args:
            query: Search query
            limit: Max results
            mode: Search mode (hybrid, vector, keyword)
            min_importance: Minimum importance score filter

        Returns:
            SearchResult with memories and chunks
        """
        body = {
            "query": query,
            "limit": limit,
            "mode": mode,
        }
        if min_importance is not None:
            body["min_importance"] = min_importance

        result = self._client._request("POST", "/v3/search", json=body)
        return SearchResult(
            memories=result.get("memories", []),
            chunks=result.get("chunks", []),
            total=result.get("total", 0),
            timing=result.get("timing", 0),
        )


class EntitiesClient:
    """Client for entity operations"""

    def __init__(self, client: CortexClient):
        self._client = client

    def list(
        self,
        entity_type: Optional[str] = None,
        min_importance: Optional[float] = None,
        limit: int = 20,
    ) -> List[Entity]:
        """
        List entities.

        Args:
            entity_type: Filter by type (person, organization, place, concept)
            min_importance: Minimum importance score
            limit: Max entities to return

        Returns:
            List of Entity objects
        """
        params = {"limit": limit}
        if entity_type:
            params["type"] = entity_type
        if min_importance is not None:
            params["min_importance"] = min_importance

        result = self._client._request("GET", "/v3/entities", params=params)
        return [Entity(**e) for e in result.get("entities", [])]

    def get(self, entity_id: str) -> Entity:
        """Get an entity by ID."""
        result = self._client._request("GET", f"/v3/entities/{entity_id}")
        return Entity(**result)

    def get_relationships(self, entity_id: str) -> List[Dict[str, Any]]:
        """Get relationships for an entity."""
        result = self._client._request("GET", f"/v3/entities/{entity_id}/relationships")
        return result.get("relationships", [])

    def get_memories(self, entity_id: str, limit: int = 10) -> List[Memory]:
        """Get memories mentioning an entity."""
        result = self._client._request(
            "GET",
            f"/v3/entities/{entity_id}/memories",
            params={"limit": limit}
        )
        return [Memory(**m) for m in result.get("memories", [])]

    def search(self, query: str, limit: int = 10) -> List[Entity]:
        """Search entities by name."""
        result = self._client._request(
            "GET",
            "/v3/graph/search",
            params={"q": query, "limit": limit}
        )
        return [Entity(**e) for e in result.get("entities", [])]

    def get_stats(self) -> Dict[str, Any]:
        """Get entity graph statistics."""
        return self._client._request("GET", "/v3/graph/stats")


class CognitiveClient:
    """Client for cognitive layer operations (learnings, beliefs, commitments)"""

    def __init__(self, client: CortexClient):
        self._client = client

    def learnings(
        self,
        category: Optional[str] = None,
        status: str = "active",
        limit: int = 20,
    ) -> List[Learning]:
        """
        Get auto-extracted learnings.

        Args:
            category: Filter by category (preferences, habits, skills, etc.)
            status: Filter by status (active, superseded)
            limit: Max results

        Returns:
            List of Learning objects
        """
        params = {"status": status, "limit": limit}
        if category:
            params["category"] = category

        result = self._client._request("GET", "/v3/learnings", params=params)
        return [Learning(**l) for l in result.get("learnings", [])]

    def beliefs(
        self,
        domain: Optional[str] = None,
        belief_type: Optional[str] = None,
        limit: int = 20,
    ) -> List[Belief]:
        """
        Get Bayesian beliefs.

        Args:
            domain: Filter by domain (work, personal, health, etc.)
            belief_type: Filter by type (preference, fact, prediction)
            limit: Max results

        Returns:
            List of Belief objects
        """
        params = {"limit": limit}
        if domain:
            params["domain"] = domain
        if belief_type:
            params["type"] = belief_type

        result = self._client._request("GET", "/v3/beliefs", params=params)
        return [Belief(**b) for b in result.get("beliefs", [])]

    def commitments(
        self,
        status: str = "pending",
        commitment_type: Optional[str] = None,
        limit: int = 20,
    ) -> List[Commitment]:
        """
        Get tracked commitments.

        Args:
            status: Filter by status (pending, completed, overdue)
            commitment_type: Filter by type (deadline, promise, task)
            limit: Max results

        Returns:
            List of Commitment objects
        """
        params = {"status": status, "limit": limit}
        if commitment_type:
            params["type"] = commitment_type

        result = self._client._request("GET", "/v3/commitments", params=params)
        return [Commitment(**c) for c in result.get("commitments", [])]

    def complete_commitment(self, commitment_id: str) -> Commitment:
        """Mark a commitment as completed."""
        result = self._client._request("POST", f"/v3/commitments/{commitment_id}/complete")
        return Commitment(**result)

    def cancel_commitment(self, commitment_id: str, reason: Optional[str] = None) -> Commitment:
        """Cancel a commitment."""
        body = {}
        if reason:
            body["reason"] = reason
        result = self._client._request(
            "POST",
            f"/v3/commitments/{commitment_id}/cancel",
            json=body
        )
        return Commitment(**result)


class ProactiveClient:
    """Client for proactive intelligence (nudges, briefings)"""

    def __init__(self, client: CortexClient):
        self._client = client

    def nudges(
        self,
        priority: Optional[str] = None,
        limit: int = 10,
    ) -> List[Nudge]:
        """
        Get proactive nudges.

        Args:
            priority: Filter by priority (high, medium, low)
            limit: Max results

        Returns:
            List of Nudge objects
        """
        params = {"limit": limit}
        if priority:
            params["priority"] = priority

        result = self._client._request("GET", "/v3/relationships/nudges", params=params)
        return [Nudge(**n) for n in result.get("nudges", [])]

    def dismiss_nudge(self, nudge_id: str) -> None:
        """Dismiss a nudge."""
        self._client._request("POST", f"/v3/relationships/nudges/{nudge_id}/dismiss")

    def briefing(
        self,
        location: Optional[Dict[str, float]] = None,
        timezone: Optional[str] = None,
    ) -> DailyBriefing:
        """Generate a daily briefing."""
        return self._client.get_briefing(location=location, timezone=timezone)


class RelationshipsClient:
    """Client for relationship intelligence"""

    def __init__(self, client: CortexClient):
        self._client = client

    def health(self, entity_id: Optional[str] = None) -> List[RelationshipHealth]:
        """
        Get relationship health scores.

        Args:
            entity_id: Get health for specific entity (optional)

        Returns:
            List of RelationshipHealth objects
        """
        path = f"/v3/relationships/health/{entity_id}" if entity_id else "/v3/relationships/health"
        result = self._client._request("GET", path)

        # Handle both single and list responses
        if "health_scores" in result:
            return [RelationshipHealth(**h) for h in result["health_scores"]]
        elif "relationships" in result:
            return [RelationshipHealth(**h) for h in result["relationships"]]
        return []


class SyncClient:
    """Client for sync operations"""

    def __init__(self, client: CortexClient):
        self._client = client

    def connections(self) -> List[SyncConnection]:
        """Get all sync connections."""
        result = self._client._request("GET", "/v3/sync/connections")
        return [SyncConnection(**c) for c in result.get("connections", [])]

    def status(self) -> SyncStatus:
        """Get overall sync status."""
        result = self._client._request("GET", "/v3/sync/status")
        return SyncStatus(**result)

    def trigger(self, connection_id: str) -> Dict[str, Any]:
        """Trigger sync for a connection."""
        return self._client._request("POST", f"/v3/sync/connections/{connection_id}/sync")
