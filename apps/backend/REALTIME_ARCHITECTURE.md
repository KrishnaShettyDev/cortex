# Cortex Real-Time Architecture Design

## Executive Summary

**Recommended Architecture: Option C - Hybrid Push + SSE**

- **Foreground**: SSE connection for instant updates (sub-second latency)
- **Background**: Silent push notifications (best-effort, ~85% delivery)
- **Fallback**: Pull-to-refresh for manual recovery (no polling)

This is what production apps actually do. Polling is never the answer.

---

## 1. Research Findings

### 1.1 How Production Apps Do Real-Time

| App | Foreground | Background | Protocol | Scale |
|-----|------------|------------|----------|-------|
| **WhatsApp** | Persistent WebSocket | Push (APNs/FCM) | Modified XMPP | 2B+ users |
| **Slack** | WebSocket to edge | HTTP requests (not WS) | Custom | 20M+ DAU |
| **Discord** | WebSocket (Elixir/Cowboy) | Push | Custom gateway | 12M concurrent |
| **Notion** | WebSocket + CRDT | Push for mentions | Hybrid OT/CRDT | 30M+ users |

**Key insight**: ALL production apps use WebSocket or SSE when app is open. NONE poll.

### 1.2 Cloudflare Capabilities

| Feature | Capability | Limit |
|---------|------------|-------|
| **Workers SSE** | Supported | 100s timeout without data, send heartbeat every 30s |
| **Workers duration** | Standard: 30s CPU, Unbound: 15min wall | Need Unbound for SSE |
| **Durable Objects WebSocket** | Full duplex supported | 32,768 connections per DO |
| **DO requests/sec** | Soft limit | 1,000 RPS per DO |
| **DO WebSocket billing** | 20:1 ratio | 1M WS messages = 50K billable requests |

**Cloudflare can do real-time.** Durable Objects are the right primitive for user-scoped real-time.

### 1.3 Push Notification Reality

| Platform | Silent Push Limit | Delivery Rate | Latency |
|----------|-------------------|---------------|---------|
| **iOS (APNs)** | ~1-2/hour (throttled) | ~85% with FCM combo | 1-10 min |
| **Android (FCM)** | 240/min per device | ~85% with APNs combo | Seconds |
| **Combined** | - | ~85% (vs 30-50% single) | Variable |

**Push is NOT reliable for real-time.** It's best-effort delivery with no SLA.

### 1.4 Battery Impact

| Method | Battery/hour (foreground) | Battery/hour (background) |
|--------|---------------------------|---------------------------|
| **Polling (2 min)** | High (30 requests/hour) | High (radio wake every 2 min) |
| **Polling (15 min)** | Medium (4 requests/hour) | Medium |
| **WebSocket/SSE** | Low (1 connection, idle) | N/A (closed in background) |
| **Push only** | None | Minimal (OS manages) |

**SSE/WebSocket is MORE battery efficient than polling** when app is open.

---

## 2. Current State Analysis

### What We Have
```
Mobile App:
- useChat.ts: 2-minute auto-refresh for suggestions
- useAutonomousActions.ts: 2-minute auto-refresh
- useProactivePolling.ts: 15-minute fallback (just created)
- notifications.ts: Push token registration (untested)

Backend:
- No SSE endpoints
- No WebSocket support
- No Durable Objects
- Push notification sending (via Expo)
```

### Problems with Current Approach
1. **2-minute polling is 720 requests/day per user** - wasteful
2. **Push tokens are registered but never tested** - unknown reliability
3. **No way to know if push failed** - silent failures
4. **Polling continues even when push works** - double cost

---

## 3. Recommended Architecture

### 3.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           MOBILE APP                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │  RealtimeContext │───▶│  SSE Connection  │───▶│ EventHandler  │ │
│  │                  │    │  (foreground)    │    │               │ │
│  └──────────────────┘    └──────────────────┘    └───────────────┘ │
│           │                       │                      │          │
│           │              ┌────────▼────────┐            │          │
│           │              │  Auto-reconnect │            │          │
│           │              │  with backoff   │            │          │
│           │              └─────────────────┘            │          │
│           │                                              │          │
│           ▼                                              ▼          │
│  ┌──────────────────┐                        ┌───────────────────┐ │
│  │  PushHandler     │◀───────────────────────│  UI Components    │ │
│  │  (background)    │                        │                   │ │
│  └──────────────────┘                        └───────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE WORKERS                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │  /v3/realtime    │───▶│  SSE Handler     │───▶│ Durable Object│ │
│  │  (SSE endpoint)  │    │  (per-user)      │    │ (user state)  │ │
│  └──────────────────┘    └──────────────────┘    └───────────────┘ │
│                                                          │          │
│                                                          ▼          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │  Webhook Handler │───▶│  Event Router    │───▶│ Push Service  │ │
│  │  (Composio)      │    │                  │    │ (Expo)        │ │
│  └──────────────────┘    └──────────────────┘    └───────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
NEW EMAIL ARRIVES:

1. Composio ──webhook──▶ /proactive/webhook
                              │
2.                            ▼
                        Event Router
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
3.      Store in D1    Check SSE conn    Queue Push
              │               │               │
              │               ▼               ▼
4.            │         User online?    User offline?
              │               │               │
              │       ┌───────┴───────┐       │
              │       ▼               ▼       ▼
5. ─────────▶ │   SSE push        Push via
              │   (instant)       Expo
              │       │               │
              ▼       ▼               ▼
6.         Mobile receives event
           (via SSE or Push)
                    │
                    ▼
7.         UI updates immediately
```

### 3.3 Connection State Machine

```
                    ┌─────────────────┐
                    │   APP LAUNCH    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Check Auth      │
                    └────────┬────────┘
                             │ authenticated
                             ▼
              ┌──────────────────────────────┐
              │     OPEN SSE CONNECTION      │
              │   GET /v3/realtime/stream    │
              └──────────────┬───────────────┘
                             │
            success          │           failure
       ┌─────────────────────┼─────────────────────┐
       ▼                     │                     ▼
┌─────────────┐              │              ┌─────────────┐
│  CONNECTED  │              │              │   BACKOFF   │
│             │              │              │ (1s,2s,4s..)│
└──────┬──────┘              │              └──────┬──────┘
       │                     │                     │
       │ event received      │                     │ retry
       ▼                     │                     │
┌─────────────┐              │              ┌──────┴──────┐
│ HANDLE EVENT│              │              │ max retries?│
│ Update UI   │              │              └──────┬──────┘
└──────┬──────┘              │                     │ yes
       │                     │                     ▼
       │                     │              ┌─────────────┐
       │ connection lost     │              │ PUSH ONLY   │
       ├─────────────────────┘              │ (degraded)  │
       ▼                                    └─────────────┘
┌─────────────┐
│ APP BACKGROUND│
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ CLOSE SSE   │
│ RELY ON PUSH│
└─────────────┘
```

---

## 4. Implementation Plan

### Phase 1: Ship Push Properly (Week 1)
**Goal**: Get reliable push notifications working before adding SSE.

#### 4.1.1 Backend Changes
```typescript
// src/lib/notifications/push.ts
export async function sendPushNotification(
  db: D1Database,
  userId: string,
  event: ProactiveEvent
): Promise<{ success: boolean; error?: string }> {
  // Get user's push token
  const token = await db.prepare(
    'SELECT push_token FROM users WHERE id = ?'
  ).bind(userId).first<{ push_token: string }>();

  if (!token?.push_token) {
    return { success: false, error: 'no_token' };
  }

  // Send via Expo
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token.push_token,
      title: event.title,
      body: event.body,
      data: {
        type: 'proactive_event',
        eventId: event.id,
        urgency: event.urgency,
      },
      priority: event.urgency === 'critical' ? 'high' : 'default',
      channelId: getChannelForUrgency(event.urgency),
    }),
  });

  const result = await response.json();

  // Track delivery for analytics
  await db.prepare(`
    INSERT INTO push_delivery_log (id, user_id, event_id, status, error, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).bind(nanoid(), userId, event.id, result.data?.status || 'sent', result.data?.details?.error).run();

  return { success: !result.data?.details?.error };
}
```

#### 4.1.2 Mobile Changes
- Test push token registration flow
- Add push delivery confirmation (silent push that ACKs receipt)
- Track push reliability metrics in analytics

#### 4.1.3 Deliverables
- [ ] Push sending from webhook handler
- [ ] Push delivery logging
- [ ] Push reliability dashboard
- [ ] Tested on real iOS/Android devices

---

### Phase 2: Add SSE for Foreground (Week 2)
**Goal**: Instant updates when app is open.

#### 4.2.1 Backend: SSE Endpoint
```typescript
// src/handlers/realtime.ts
export async function handleRealtimeStream(c: Context): Promise<Response> {
  const userId = c.get('jwtPayload')?.sub;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  // Create SSE stream
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Register this connection
  const connectionId = nanoid();
  await c.env.CACHE.put(
    `sse:${userId}:${connectionId}`,
    JSON.stringify({ connectedAt: Date.now() }),
    { expirationTtl: 3600 }
  );

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(async () => {
    try {
      await writer.write(encoder.encode(': heartbeat\n\n'));
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Send initial connection event
  await writer.write(encoder.encode(
    `event: connected\ndata: ${JSON.stringify({ connectionId })}\n\n`
  ));

  // Subscribe to user's event stream (via Durable Object or KV polling)
  // For Phase 2, we use KV-based event queue
  const pollInterval = setInterval(async () => {
    const events = await getUndeliveredEvents(c.env.DB, userId, connectionId);
    for (const event of events) {
      await writer.write(encoder.encode(
        `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
      ));
      await markEventDelivered(c.env.DB, event.id, connectionId);
    }
  }, 1000); // Check every 1s

  // Cleanup on disconnect
  c.executionCtx.waitUntil((async () => {
    // Wait for client disconnect
    try {
      await readable.pipeTo(new WritableStream());
    } catch {
      // Client disconnected
    }
    clearInterval(heartbeat);
    clearInterval(pollInterval);
    await c.env.CACHE.delete(`sse:${userId}:${connectionId}`);
  })());

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

#### 4.2.2 Mobile: SSE Client
```typescript
// src/services/realtime.ts
class RealtimeService {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  async connect(token: string): Promise<void> {
    if (this.eventSource?.readyState === EventSource.OPEN) {
      return;
    }

    const url = `${API_BASE_URL}/v3/realtime/stream`;

    // React Native doesn't have EventSource, use fetch with streaming
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('SSE connection failed');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      this.reconnectAttempts = 0;
      this.processStream(reader);
    } catch (error) {
      this.handleDisconnect();
    }
  }

  private async processStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      try {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          this.parseSSEMessage(line);
        }
      } catch (error) {
        break;
      }
    }

    this.handleDisconnect();
  }

  private parseSSEMessage(message: string) {
    const lines = message.split('\n');
    let event = 'message';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice(5).trim();
      }
    }

    if (data) {
      try {
        const parsed = JSON.parse(data);
        this.emit(event, parsed);
      } catch {
        this.emit(event, data);
      }
    }
  }

  private handleDisconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      this.reconnectAttempts++;
      setTimeout(() => this.connect(currentToken), delay);
    } else {
      // Fall back to push-only mode
      this.emit('degraded', { reason: 'max_reconnect_attempts' });
    }
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(cb => cb(data));
    this.listeners.get('*')?.forEach(cb => cb({ event, data }));
  }

  disconnect() {
    // Called when app goes to background
    this.eventSource?.close();
    this.eventSource = null;
  }
}
```

#### 4.2.3 Deliverables
- [ ] SSE endpoint with heartbeat
- [ ] Mobile SSE client with reconnection
- [ ] Event routing: SSE if connected, else push
- [ ] Connection state tracking in KV

---

### Phase 3: Durable Objects for Scale (Week 4+)
**Goal**: Handle 10,000+ concurrent connections.

#### Why Durable Objects?
- Each user gets their own DO instance
- DO maintains WebSocket connections across requests
- Hibernation API = zero cost when idle
- Automatic geographic distribution

#### 4.3.1 Durable Object Implementation
```typescript
// src/durable-objects/user-realtime.ts
export class UserRealtimeDO implements DurableObject {
  private connections: Map<string, WebSocket> = new Map();
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/connect') {
      return this.handleWebSocket(request);
    }

    if (url.pathname === '/send') {
      return this.handleSendEvent(request);
    }

    return new Response('Not found', { status: 404 });
  }

  async handleWebSocket(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const connectionId = crypto.randomUUID();
    this.connections.set(connectionId, server);

    server.accept();

    server.addEventListener('close', () => {
      this.connections.delete(connectionId);
    });

    server.addEventListener('message', (event) => {
      // Handle client messages (ping, ack, etc.)
      if (event.data === 'ping') {
        server.send('pong');
      }
    });

    // Enable hibernation - DO sleeps when no messages
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSendEvent(request: Request): Promise<Response> {
    const event = await request.json();

    // Broadcast to all connected clients
    for (const [id, socket] of this.connections) {
      try {
        socket.send(JSON.stringify(event));
      } catch {
        this.connections.delete(id);
      }
    }

    return new Response('OK');
  }

  // Called when DO wakes from hibernation
  async webSocketMessage(ws: WebSocket, message: string) {
    if (message === 'ping') {
      ws.send('pong');
    }
  }

  async webSocketClose(ws: WebSocket) {
    // Connection closed, DO can hibernate if no other connections
  }
}
```

---

## 5. Cost Analysis

### At 100 Users (Beta)

| Component | Usage | Cost |
|-----------|-------|------|
| Workers requests | ~500K/month | Free tier |
| KV reads | ~2M/month | Free tier |
| Push notifications | ~10K/month | Free (Expo) |
| **Total** | - | **$0/month** |

### At 1,000 Users (Launch)

| Component | Usage | Cost |
|-----------|-------|------|
| Workers requests | ~5M/month | $0.50 |
| KV operations | ~20M/month | $4 |
| D1 reads | ~50M/month | $0.75 |
| Push notifications | ~100K/month | Free (Expo) |
| **Total** | - | **~$5/month** |

### At 10,000 Users (Scale)

| Component | Usage | Cost |
|-----------|-------|------|
| Durable Objects | 10K DOs | $5 base |
| DO requests | ~50M/month | $7.50 |
| DO duration | ~500K GB-s | ~$6 |
| D1 reads | ~500M/month | $7.50 |
| Push notifications | ~1M/month | Free (Expo) |
| **Total** | - | **~$30/month** |

### At 100,000 Users (Growth)

| Component | Usage | Cost |
|-----------|-------|------|
| Durable Objects | 100K DOs | $5 base |
| DO requests | ~500M/month | $75 |
| DO duration (with hibernation) | ~2M GB-s | ~$25 |
| D1 reads | ~5B/month | $75 |
| Push notifications | ~10M/month | ~$50 (Expo Pro) |
| **Total** | - | **~$250/month** |

---

## 6. Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| **SSE connection drops** | No heartbeat for 60s | Auto-reconnect with backoff |
| **Push token invalid** | Expo returns error | Prompt user to re-register |
| **Push not delivered** | No ACK within 5 min | Mark as undelivered, show on next open |
| **DO overloaded** | 429 errors | Shed load to push-only |
| **User offline** | No connection, push fails | Queue events, sync on reconnect |
| **Backend down** | SSE fails, push fails | Local queue, retry with backoff |

---

## 7. Offline & Poor Connectivity

### Offline Queue
```typescript
// Mobile: Queue events when offline
class OfflineQueue {
  private queue: ProactiveEvent[] = [];

  async add(event: ProactiveEvent) {
    this.queue.push(event);
    await AsyncStorage.setItem('offline_queue', JSON.stringify(this.queue));
  }

  async sync() {
    const events = await this.getUnsynced();
    for (const event of events) {
      await api.request('/v3/events/ack', {
        method: 'POST',
        body: { eventId: event.id },
      });
    }
    this.queue = [];
    await AsyncStorage.removeItem('offline_queue');
  }
}
```

### Sync on Reconnect
```typescript
// When connection restored
realtime.on('connected', async () => {
  // Get events we missed
  const lastEventId = await storage.get('last_event_id');
  const missed = await api.request(`/v3/events/since/${lastEventId}`);

  for (const event of missed.events) {
    handleEvent(event);
  }
});
```

---

## 8. Migration Path

### Week 1: Fix Push
1. Test push token flow end-to-end
2. Add push delivery logging
3. Wire webhook → push notification
4. Remove all polling code

### Week 2: Add SSE
1. Create SSE endpoint
2. Add mobile SSE client
3. Route events: SSE if connected, else push
4. Add connection state to analytics

### Week 3: Optimize
1. Add event acknowledgment
2. Add offline queue
3. Add sync-on-reconnect
4. Performance testing

### Week 4+: Scale with Durable Objects
1. Create UserRealtimeDO
2. Migrate SSE to WebSocket via DO
3. Add hibernation for idle users
4. Load testing at 10K users

---

## 9. Decision: Why Not Just WebSocket?

**Option A: Durable Objects + WebSocket from Day 1**
- Pros: Best latency, bidirectional, scales infinitely
- Cons: $5/month minimum, complexity, overkill for <1000 users

**Option B: SSE First, WebSocket Later**
- Pros: Simpler, works with standard Workers, cheaper
- Cons: One-way only (server → client), need separate API for client → server
- Upgrade path: Easy migration to WebSocket when needed

**We choose Option B** because:
1. We only need server → client for proactive events
2. SSE works on Workers without Durable Objects
3. Lower cost until we have real scale
4. Easy to upgrade later

---

## 10. Summary

| Question | Answer |
|----------|--------|
| **What transport?** | SSE (foreground) + Push (background) |
| **Why not polling?** | 720 requests/day/user, battery drain, not real-time |
| **Why not WebSocket?** | Overkill for now, add at 10K users |
| **When to add DO?** | When SSE connection count exceeds Worker limits |
| **Push reliability?** | ~85% combined APNs+FCM, not guaranteed |
| **What about offline?** | Queue events, sync on reconnect |
| **Cost at 10K users?** | ~$30/month |
| **Cost at 100K users?** | ~$250/month |

**Delete the polling code. Ship push properly. Add SSE. Scale with DO.**
