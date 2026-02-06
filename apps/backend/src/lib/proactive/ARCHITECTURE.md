# Proactive Monitoring Architecture

## Overview

Real-time event processing system that monitors user's email/calendar and proactively
notifies them of important events. Designed for security, scale, and maintainability.

## Design Principles

1. **Security First**: Webhook signature verification, rate limiting, no PII in logs
2. **Graceful Degradation**: System continues if classification fails (falls back to rules)
3. **User Control**: Preferences respected, quiet hours honored, easy opt-out
4. **Cost Conscious**: Fast-path rules before LLM, batching for non-urgent
5. **Observable**: Comprehensive logging, metrics, audit trail

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    WEBHOOK INGESTION LAYER                      │
│  POST /webhooks/composio/events                                 │
│  ├─ Signature verification (HMAC-SHA256)                        │
│  ├─ Rate limiting (per-user, per-source)                        │
│  ├─ Schema validation                                           │
│  └─ Queue to processing (Cloudflare Queue)                      │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EVENT PROCESSOR                              │
│  ├─ Event normalization (email/calendar → unified format)       │
│  ├─ User context loading (preferences, VIPs, recent events)     │
│  ├─ Deduplication (content hash + time window)                  │
│  └─ Enrichment (entity linking, memory search)                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLASSIFICATION ENGINE                        │
│  ├─ Fast-path rules (OTPs, VIP senders, keywords)               │
│  ├─ LLM classification (urgency, action_required, category)     │
│  ├─ Confidence scoring                                          │
│  └─ Classification caching (similar content)                    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NOISE FILTER (WAIT TOOL)                     │
│  ├─ Redundancy detection (similar recent notifications)         │
│  ├─ Quiet hours check                                           │
│  ├─ User preference filtering (min urgency threshold)           │
│  ├─ Batching decision (urgent=immediate, else=batch)            │
│  └─ Deferred queue for batched items                            │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NOTIFICATION DISPATCHER                      │
│  ├─ Channel selection (push, future: SMS/WhatsApp)              │
│  ├─ Message formatting (with grounded context)                  │
│  ├─ Delivery with retry (exponential backoff)                   │
│  └─ Delivery tracking and audit log                             │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
Composio Webhook
    │
    ▼
┌───────────┐     ┌───────────┐     ┌───────────┐
│  Verify   │────▶│  Validate │────▶│   Queue   │
│ Signature │     │  Schema   │     │  Message  │
└───────────┘     └───────────┘     └─────┬─────┘
                                          │
                                          ▼
                              ┌───────────────────────┐
                              │    Queue Consumer     │
                              │  (Background Worker)  │
                              └───────────┬───────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
              ┌───────────┐         ┌───────────┐         ┌───────────┐
              │   Email   │         │ Calendar  │         │  Future   │
              │ Processor │         │ Processor │         │  Sources  │
              └─────┬─────┘         └─────┬─────┘         └───────────┘
                    │                     │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌───────────────────────┐
                    │  Unified ProactiveEvent│
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
              ┌───────────┐          ┌───────────┐
              │ Fast-Path │          │    LLM    │
              │   Rules   │          │ Classify  │
              └─────┬─────┘          └─────┬─────┘
                    │                      │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌───────────────────────┐
                    │     Noise Filter      │
                    └───────────┬───────────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                    ▼           ▼           ▼
              ┌─────────┐ ┌─────────┐ ┌─────────┐
              │ Notify  │ │  Batch  │ │  Drop   │
              │  Now    │ │  Later  │ │ (Filter)│
              └─────────┘ └─────────┘ └─────────┘
```

## Security Considerations

### Webhook Verification
- HMAC-SHA256 signature verification using shared secret
- Timestamp validation (reject events > 5 minutes old)
- Source IP validation (optional, if Composio provides IP ranges)

### Rate Limiting
- Per-user: 100 events/minute (prevents abuse)
- Per-source: 1000 events/minute (prevents DOS)
- Global: 10000 events/minute (system protection)

### Data Handling
- No PII in logs (email content, names redacted)
- Encryption at rest (D1 default)
- Event retention: 30 days
- Audit trail for all notifications sent

### Input Validation
- Strict schema validation on all webhook payloads
- Content length limits (prevent memory exhaustion)
- SQL injection prevention (parameterized queries only)

## Scalability Considerations

### Cloudflare Workers Benefits
- Auto-scaling to millions of requests
- Global edge deployment
- No cold start for webhook handlers

### Queue-Based Processing
- Decouple ingestion from processing
- Handle burst traffic gracefully
- Retry failed processing automatically

### Caching Strategy
- User preferences: 5 min TTL in KV
- VIP list: 5 min TTL in KV
- Classification results: 1 hour TTL for similar content

### Database Optimization
- Indexes on user_id, created_at, status
- Partitioning by created_at (future)
- Batch inserts for high volume

## Configuration

All thresholds are configurable via environment or database:

```typescript
const PROACTIVE_CONFIG = {
  // Rate limits
  RATE_LIMIT_PER_USER: 100,      // events/minute
  RATE_LIMIT_PER_SOURCE: 1000,   // events/minute

  // Processing
  DEDUP_WINDOW_MINUTES: 5,       // Ignore duplicate events
  MAX_CONTENT_LENGTH: 10000,     // Truncate long content

  // Classification
  FAST_PATH_KEYWORDS: ['OTP', 'verification code', '2FA', ...],
  LLM_TIMEOUT_MS: 5000,          // Fallback to rules if slow

  // Noise filter
  REDUNDANCY_WINDOW_MINUTES: 30, // Similar notification window
  DEFAULT_BATCH_INTERVAL: 30,    // Minutes between batches

  // Notifications
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MS: [1000, 5000, 15000],
};
```

## File Structure

```
apps/backend/src/lib/proactive/
├── index.ts                    # Public exports
├── types.ts                    # Type definitions
├── config.ts                   # Configuration constants
├── webhook-handler.ts          # Webhook ingestion + verification
├── event-processor.ts          # Normalization + deduplication
├── classifier.ts               # Fast-path + LLM classification
├── noise-filter.ts             # Wait tool implementation
├── notification-dispatcher.ts  # Send notifications
├── batch-manager.ts            # Batch non-urgent notifications
├── user-preferences.ts         # Preferences CRUD
└── db/
    └── schema.sql              # Database migrations
```

## API Endpoints

### Webhook (Public, signature-verified)
- `POST /webhooks/composio/events` - Receive Composio events

### Preferences (Protected)
- `GET /v3/proactive/preferences` - Get user preferences
- `PATCH /v3/proactive/preferences` - Update preferences
- `GET /v3/proactive/vips` - List VIP senders
- `POST /v3/proactive/vips` - Add VIP sender
- `DELETE /v3/proactive/vips/:id` - Remove VIP sender

### Events (Protected)
- `GET /v3/proactive/events` - List recent proactive events
- `GET /v3/proactive/events/:id` - Get event details

## Metrics & Monitoring

### Key Metrics
- Events received/processed/filtered per minute
- Classification latency (p50, p95, p99)
- Notification delivery success rate
- LLM fallback rate (rules vs LLM)

### Alerting
- High filter rate (>90% filtered = config issue)
- Classification failures (>10% = LLM issue)
- Delivery failures (>5% = push service issue)

## Future Enhancements

1. **SMS/WhatsApp channels** - Twilio integration
2. **Smart batching** - ML-based batch timing
3. **User feedback loop** - Learn from dismissals
4. **Cross-device sync** - Don't notify twice
5. **Digest mode** - Daily/weekly summaries
