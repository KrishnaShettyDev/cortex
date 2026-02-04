# Cortex Memory Python SDK

The official Python SDK for the Cortex Memory API - the cognitive memory platform for AI applications.

## Why Cortex?

Unlike traditional memory APIs that only store and retrieve, Cortex **thinks**:
- Forms **beliefs** with Bayesian confidence
- Tracks **commitments** and promises
- Scores **relationship health**
- Proactively surfaces **nudges** and insights

## Installation

```bash
pip install cortex-memory
```

## Quick Start

```python
from cortex_memory import CortexClient

# Initialize client
cortex = CortexClient(api_key="ctx_your_api_key")

# Add a memory
memory = cortex.memories.add(
    "Meeting with Sarah about Q1 goals. She prefers morning meetings.",
    source="meeting_notes"
)

# Search memories
results = cortex.memories.search("Q1 goals")
for memory in results.memories:
    print(f"- {memory['content']} (score: {memory['score']:.2f})")

# Get beliefs (unique to Cortex!)
beliefs = cortex.cognitive.beliefs()
for belief in beliefs:
    print(f"[{belief.domain}] {belief.statement} ({belief.confidence:.0%} confidence)")

# Get proactive nudges
nudges = cortex.proactive.nudges()
for nudge in nudges:
    print(f"[{nudge.priority}] {nudge.title}: {nudge.message}")
```

## Features

### Memory Management

```python
# Add memory
memory = cortex.memories.add("User prefers TypeScript over JavaScript")

# Search with hybrid mode (vector + keyword)
results = cortex.memories.search("programming preferences", mode="hybrid")

# List recent memories
memories = cortex.memories.list(limit=10)

# Get specific memory
memory = cortex.memories.get("mem_abc123")

# Update memory
cortex.memories.update("mem_abc123", importance_score=0.9)

# Delete memory
cortex.memories.delete("mem_abc123")
```

### Recall with Context

```python
# Get contextual recall for AI injection
recall = cortex.recall(
    query="What are my work preferences?",
    include_profile=True,
    include_entities=True
)

# Use recall.context in your LLM prompt
prompt = f"""
{recall.context}

User: What should I work on today?
"""
```

### Entity Graph

```python
# List people
people = cortex.entities.list(entity_type="person")

# Get entity details
entity = cortex.entities.get("ent_xyz")

# Get relationships
relationships = cortex.entities.get_relationships("ent_xyz")

# Search entities
results = cortex.entities.search("John")

# Get graph statistics
stats = cortex.entities.get_stats()
```

### Cognitive Layer

```python
# Beliefs - Bayesian confidence from evidence
beliefs = cortex.cognitive.beliefs(domain="work")
for belief in beliefs:
    print(f"{belief.statement} ({belief.confidence:.0%})")

# Learnings - auto-extracted patterns
learnings = cortex.cognitive.learnings(category="preferences")
for learning in learnings:
    print(f"[{learning.category}] {learning.statement}")

# Commitments - tracked promises and tasks
commitments = cortex.cognitive.commitments(status="pending")
for commitment in commitments:
    print(f"- {commitment.title} (due: {commitment.due_date})")

# Mark commitment complete
cortex.cognitive.complete_commitment("commit_abc")
```

### Proactive Intelligence

```python
# Get nudges (relationship maintenance reminders)
nudges = cortex.proactive.nudges(priority="high")
for nudge in nudges:
    print(f"{nudge.title}: {nudge.suggested_action}")

# Generate daily briefing
briefing = cortex.proactive.briefing(
    location={"lat": 37.7749, "lon": -122.4194},
    timezone="America/Los_Angeles"
)
print(briefing.summary)
```

### Relationship Health

```python
# Get relationship health scores
health_scores = cortex.relationships.health()
for health in health_scores:
    print(f"{health.entity_name}: {health.health_status} ({health.health_score:.0%})")
    for rec in health.recommendations:
        print(f"  - {rec}")
```

### User Profile

```python
# Get user profile
profile = cortex.get_profile()

print("About you:")
for fact in profile.static_facts:
    print(f"- {fact}")

print("\nCurrent context:")
for fact in profile.dynamic_facts:
    print(f"- {fact}")
```

## Configuration

```python
from cortex_memory import CortexClient

# Full configuration
cortex = CortexClient(
    api_key="ctx_your_api_key",
    base_url="https://askcortex.plutas.in",  # default
    container_tag="default",  # multi-tenant isolation
    timeout=30.0,  # request timeout in seconds
)
```

## Multi-Tenancy

Cortex supports multi-tenant isolation via container tags:

```python
# Work memories
work_cortex = CortexClient(api_key="ctx_...", container_tag="work")
work_cortex.memories.add("Meeting at 2pm")

# Personal memories
personal_cortex = CortexClient(api_key="ctx_...", container_tag="personal")
personal_cortex.memories.add("Dentist appointment Friday")
```

## Error Handling

```python
from cortex_memory import CortexClient, CortexError

cortex = CortexClient(api_key="ctx_...")

try:
    memory = cortex.memories.get("invalid_id")
except CortexError as e:
    print(f"Error: {e.message}")
    print(f"Status: {e.status_code}")
    print(f"Code: {e.code}")
```

## Context Manager

```python
# Auto-close client connection
with CortexClient(api_key="ctx_...") as cortex:
    memories = cortex.memories.list()
# Client is automatically closed
```

## API Reference

Full API documentation: https://docs.askcortex.in/api-reference

## Support

- GitHub Issues: https://github.com/plutaslab/cortex-py/issues
- Documentation: https://docs.askcortex.in
- Email: support@askcortex.in

## License

MIT
