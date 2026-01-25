"""
Memory system configuration for MemoryBench SOTA implementation.

All thresholds and parameters are configurable here.
"""

from pydantic_settings import BaseSettings
from typing import Optional


class MemoryConfig(BaseSettings):
    """Configuration for the advanced memory system."""

    # === Fact Extraction ===
    extraction_model: str = "gpt-4o-mini"
    min_fact_confidence: float = 0.5
    max_facts_per_memory: int = 10

    # === Temporal Parsing ===
    default_timezone: str = "UTC"
    temporal_parser_model: str = "gpt-4o-mini"

    # === Conflict Resolution ===
    conflict_similarity_threshold: float = 0.85
    auto_update_threshold: float = 0.95
    enable_auto_conflict_resolution: bool = True

    # === Retrieval Weights ===
    vector_weight: float = 0.5
    entity_weight: float = 0.3
    recency_weight: float = 0.1
    temporal_weight: float = 0.1
    max_facts_per_query: int = 20

    # === Abstention ===
    abstention_threshold: float = 0.3
    low_confidence_threshold: float = 0.5
    enable_abstention: bool = True

    # === Entity Extraction ===
    entity_extraction_model: str = "gpt-4o-mini"
    min_entity_confidence: float = 0.6

    # === Performance ===
    enable_fact_caching: bool = True
    fact_cache_ttl_seconds: int = 300
    batch_extraction_size: int = 5

    class Config:
        env_prefix = "MEMORY_"


# Global instance
_memory_config: Optional[MemoryConfig] = None


def get_memory_config() -> MemoryConfig:
    """Get the memory configuration singleton."""
    global _memory_config
    if _memory_config is None:
        _memory_config = MemoryConfig()
    return _memory_config
