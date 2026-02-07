# Proactive Polling System Design

## Research Summary

### Sources Consulted
- [Gmail API Usage Limits](https://developers.google.com/workspace/gmail/api/reference/quota)
- [Gmail Push Notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Gmail Sync Guide](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Composio Triggers Docs](https://docs.composio.dev/docs/using-triggers)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Webhooks vs Polling Tradeoffs](https://bugfree.ai/knowledge-hub/webhook-vs-polling-system-design-tradeoffs)
- [iOS Notification Best Practices](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/EnergyGuide-iOS/NotificationBestPractices.html)

---

## Current State

### What Cortex Has Now
1. **Webhook-based proactive** (`/proactive/webhook`) - Composio fires webhooks on events
2. **Rule-based classification** - Regex patterns for urgency (critical/high/medium/low)
3. **Rate limiting** - Max 10 notifications/user/hour
4. **VIP/Blocked senders** - User-managed sender lists
5. **Hourly cleanup** - Deletes events older than 7 days

### What's Missing
1. **Fallback polling** - Webhooks can fail/delay; no safety net
2. **Incremental sync** - Not using Gmail's history API for efficient sync
3. **historyId tracking** - Not storing last synced position per user
4. **Smart batching** - Notifications sent immediately, not batched
5. **Cache layer** - Re-fetching same data repeatedly

---

## Design: Hybrid Proactive System

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     PROACTIVE PIPELINE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │   COMPOSIO   │     │   POLLING    │     │   HISTORY    │   │
│  │   WEBHOOKS   │     │   FALLBACK   │     │    SYNC      │   │
│  │  (real-time) │     │  (5-min cron)│     │ (incremental)│   │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘   │
│         │                    │                    │            │
│         └────────────────────┼────────────────────┘            │
│                              │                                  │
│                    ┌─────────▼─────────┐                       │
│                    │    DEDUPLICATOR   │                       │
│                    │  (event_hash +    │                       │
│                    │   seen_events)    │                       │
│                    └─────────┬─────────┘                       │
│                              │                                  │
│                    ┌─────────▼─────────┐                       │
│                    │    CLASSIFIER     │                       │
│                    │  (LLM for complex │                       │
│                    │   regex for fast) │                       │
│                    └─────────┬─────────┘                       │
│                              │                                  │
│                    ┌─────────▼─────────┐                       │
│                    │  NOTIFICATION     │                       │
│                    │    BATCHER        │                       │
│                    │  (1-min window)   │                       │
│                    └─────────┬─────────┘                       │
│                              │                                  │
│                    ┌─────────▼─────────┐                       │
│                    │   PUSH SERVICE    │                       │
│                    │  (APNS / FCM)     │                       │
│                    └───────────────────┘                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Database Schema Updates

```sql
-- Track last sync position per user per provider
CREATE TABLE IF NOT EXISTS sync_cursors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,  -- 'gmail', 'googlecalendar'
  history_id TEXT,         -- Gmail historyId or equivalent
  last_sync_at TEXT NOT NULL,
  created_at TEXT NOT NULL,

  UNIQUE(user_id, provider),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Deduplication cache (TTL: 24 hours)
CREATE TABLE IF NOT EXISTS seen_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_hash TEXT NOT NULL,  -- SHA256 of (provider + item_id + timestamp)
  created_at TEXT NOT NULL,

  UNIQUE(user_id, event_hash)
);

-- Notification batch queue
CREATE TABLE IF NOT EXISTS notification_batch (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  events TEXT NOT NULL,      -- JSON array of pending events
  batch_until TEXT NOT NULL, -- When to send batch
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_batch_until ON notification_batch(batch_until);
```

### Phase 2: Incremental Sync Implementation

#### Key Concepts
1. **historyId** - Gmail's cursor for incremental sync
2. **history.list** - Fetch only changes since last historyId
3. **Quota cost** - history.list = 2 units vs messages.list = 5 units

#### Polling Strategy
```
┌─────────────────────────────────────────────────────────────┐
│                    POLLING FREQUENCY                        │
├─────────────────────────────────────────────────────────────┤
│  User Activity Level    │  Poll Interval  │  Rationale     │
├─────────────────────────┼─────────────────┼────────────────┤
│  Active (last 1 hr)     │  1 minute       │  High priority │
│  Recent (last 24 hrs)   │  5 minutes      │  Normal        │
│  Inactive (>24 hrs)     │  15 minutes     │  Background    │
│  Dormant (>7 days)      │  No polling     │  Webhook only  │
└─────────────────────────────────────────────────────────────┘
```

### Phase 3: Cron Configuration

```toml
# wrangler.toml
[triggers]
crons = [
  "* * * * *",         # Every minute - notification batch flush
  "*/5 * * * *",       # Every 5 min - incremental sync (active users)
  "0 */6 * * *",       # Every 6h - trigger reconciliation
  "0 2 * * SUN",       # Weekly - consolidation
]
```

**Note**: Cloudflare allows max 3 cron triggers per worker. We need to consolidate:
- `* * * * *` - Main proactive loop (batch flush + active user sync)
- `0 */6 * * *` - Reconciliation + action generation
- `0 2 * * SUN` - Weekly consolidation

### Phase 4: Rate Limiting & Quota Management

#### Gmail API Budget
- **Per-user limit**: 250 quota units/second
- **history.list**: 2 units per call
- **messages.get**: 5 units per call

#### Our Budget Per User
```
Max calls/minute: 60 × (250 ÷ 2) = 7,500 history.list calls
Realistic budget: 1 history.list + 10 messages.get = 52 units/sync
Safe polling: 1 sync/minute = 3,120 units/hour (well under limit)
```

#### Notification Rate Limits
```
Current: 10 notifications/user/hour
Proposed:
  - Critical: No limit (OTPs, security)
  - High: 20/hour
  - Medium: 10/hour
  - Low: 5/hour (batched into digest)
```

### Phase 5: Battery & Cache Optimization

#### Server-Side Only
All polling happens on Cloudflare Workers. Mobile app:
- Receives push notifications (no background polling)
- Uses silent notifications for data sync (iOS: max every 20-21 min)
- High-priority push reserved for critical events only

#### Cache Strategy
```
┌─────────────────────────────────────────────────────────────┐
│                      CACHE LAYERS                           │
├─────────────────────────────────────────────────────────────┤
│  Layer              │  TTL        │  Storage               │
├─────────────────────┼─────────────┼────────────────────────┤
│  sync_cursors       │  Permanent  │  D1 (SQL)              │
│  seen_events        │  24 hours   │  D1 + cleanup cron     │
│  user_activity      │  1 hour     │  KV (CACHE binding)    │
│  sender_reputation  │  7 days     │  D1 (proactive_vip)    │
└─────────────────────────────────────────────────────────────┘
```

---

## API Changes

### New Endpoints
None required - all server-side.

### Modified Behavior
- `/autonomous-actions` - Now populated by both webhooks AND polling
- Push notifications - Batched with 1-minute window for non-critical

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gmail rate limit hit | Users miss emails | Exponential backoff, per-user budgets |
| Composio webhook fails | Delayed notifications | Polling fallback catches missed events |
| D1 write limits | Sync fails | Batch writes, use KV for hot data |
| Cron trigger limit (3 max) | Can't add more jobs | Consolidate into mega-cron handler |
| Duplicate notifications | User annoyance | seen_events deduplication table |

---

## Implementation Order

1. **Add database schema** (sync_cursors, seen_events)
2. **Implement history-based incremental sync** (lib/proactive/sync.ts)
3. **Add deduplication layer** (hash-based event tracking)
4. **Implement smart polling scheduler** (activity-based intervals)
5. **Add notification batching** (1-min window for non-critical)
6. **Update cron handler** (consolidate into * * * * * cron)
7. **Test with real users** (start with 1 user, expand)
8. **Monitor quota usage** (add telemetry)

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Event detection latency | Webhook-only (variable) | <2 min guaranteed |
| Missed events | Unknown | <1% |
| Duplicate notifications | Unknown | 0% |
| API quota usage | Unknown | <50% of limit |
| User battery impact | N/A (server-side) | No change |

---

## Estimated Effort

| Phase | Time | Complexity |
|-------|------|------------|
| Schema + migration | 30 min | Low |
| Incremental sync | 2 hrs | Medium |
| Deduplication | 1 hr | Low |
| Smart scheduler | 1 hr | Medium |
| Notification batching | 1 hr | Medium |
| Cron consolidation | 30 min | Low |
| Testing | 1 hr | Medium |
| **Total** | **~7 hrs** | |
