# Queue Setup Guide

## After Upgrading to Workers Paid

### Queue Architecture

```
┌─────────────────┐
│  Memory Created │
│   (via API)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ Processing Job  │────▶│ PROCESSING_QUEUE │
│   Created       │     │  (cortex-proc)   │
└─────────────────┘     └────────┬─────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Queue Consumer  │
                        │  (Batch: 10)    │
                        │  (Timeout: 30s) │
                        └────────┬────────┘
                                 │
                        ┌────────┴────────┐
                        │                 │
                    SUCCESS           FAILURE
                        │                 │
                        ▼                 ▼
                 ┌──────────┐      ┌──────────┐
                 │   DONE   │      │ DLQ (3x) │
                 └──────────┘      └──────────┘
```

### Queue Configuration

**cortex-processing** (Main Queue)
- Max batch size: 10 messages
- Max batch timeout: 30 seconds
- Max retries: 3 attempts
- Dead letter queue: cortex-dlq

**cortex-dlq** (Dead Letter Queue)
- Captures failed messages after 3 retries
- Manual inspection/retry endpoint
- Error pattern analysis

### Commands to Run

```bash
# 1. Create main processing queue
npx wrangler queues create cortex-processing

# 2. Create dead letter queue
npx wrangler queues create cortex-dlq

# 3. Verify queues created
npx wrangler queues list

# 4. Deploy with queue enabled
npx wrangler deploy --minify
```

### Benefits vs waitUntil()

| Feature | waitUntil() | Queue |
|---------|-------------|-------|
| Reliability | ⚠️ Best effort | ✅ Guaranteed |
| Retry Logic | ❌ None | ✅ 3 retries |
| Error Tracking | ⚠️ Logs only | ✅ DLQ + metrics |
| Backpressure | ❌ None | ✅ Built-in |
| Observability | ⚠️ Limited | ✅ Full visibility |
| Concurrency Control | ❌ Unbounded | ✅ Batch size limit |

### Performance Expectations

**Processing Time** (per memory):
- Document extraction: ~200ms
- Chunking: ~100ms
- Embedding: ~500ms
- Vectorize indexing: ~300ms
- Entity extraction: ~800ms
- Importance scoring: ~200ms
- **Total**: ~2.1s average

**Queue Throughput**:
- Batch size: 10 messages
- Batch timeout: 30s
- Effective throughput: ~300 memories/minute

### Monitoring

**Queue Metrics** (via Cloudflare Dashboard):
- Messages in queue
- Processing rate
- Error rate
- DLQ depth

**API Endpoints**:
```bash
# Get processing job status
GET /v3/processing/jobs/:jobId

# List all jobs
GET /v3/processing/jobs?status=done|failed|queued

# Get pipeline stats
GET /v3/processing/stats
```

### Troubleshooting

**Queue not receiving messages?**
1. Check queue binding in wrangler.toml
2. Verify PROCESSING_QUEUE environment variable
3. Check worker logs: `npx wrangler tail`

**Messages stuck in queue?**
1. Check consumer is deployed: `npx wrangler deploy`
2. Verify consumer binding in wrangler.toml
3. Check for errors in logs

**High DLQ depth?**
1. Inspect failed messages: GET /v3/processing/dlq
2. Check error patterns in logs
3. Fix root cause and retry

### Testing

```bash
# 1. Create a test memory
curl -X POST https://askcortex.plutas.in/v3/memories \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Test queue processing", "container_tag": "test"}'

# 2. Get job ID from response
JOB_ID="<from response>"

# 3. Check processing status
curl https://askcortex.plutas.in/v3/processing/jobs/$JOB_ID \
  -H "Authorization: Bearer $TOKEN"

# 4. Monitor queue in dashboard
# Go to: Workers & Pages → Queues → cortex-processing
```
