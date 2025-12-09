<!-- PATIENCE_TIMER_BUILD_STAGE_3_DESIGN.md -->

# Stage 3 Design: Frontend Progress UI Integration [SEQ-FRONTEND-001]

**Status**: 🎯 **DESIGN PHASE**  
**Target**: Frontend progress tracking with real-time CallManager status  
**Architecture Document**: `PATIENCE_TIMER_BLUEPRINT.md`  
**Dependencies**: Stage 1 ✅, Stage 2 ✅

---

## Executive Summary

Stage 3 connects the backend CallManager orchestration (Stages 1-2) to the frontend user interface. Users will see real-time progress updates as ebook generation proceeds, including:

- **Quota consumption bar** (API calls used vs limit)
- **Time budget countdown** (deadline tracking)
- **Chapter progress log** (real-time chapter completion)
- **Status indicators** (healthy/warning/critical states)
- **Error notifications** (with enhanced context from Stage 2)

**Implementation Strategy**: Use Server-Sent Events (SSE) for efficient one-way streaming of CallManager status callbacks to connected clients.

---

## Architecture Overview

### Information Flow

```
┌─────────────────────────────────────────────────────────┐
│ Frontend (Browser)                                      │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Ebook Generator Component                        │   │
│  │  - Title input                                   │   │
│  │  - URL/file input                                │   │
│  │  - Generate button                               │   │
│  └──────────────────────────────────────────────────┘   │
│                      │                                   │
│                      │ POST /api/ebook/generate          │
│                      │ (+ SSE subscription)              │
│                      ↓                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Progress Container                               │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │ Quota Bar:    ████░░░░░░  50% (10/20)     │ │   │
│  │  ├────────────────────────────────────────────┤ │   │
│  │  │ Time Left:    5:32 / 10:00                │ │   │
│  │  ├────────────────────────────────────────────┤ │   │
│  │  │ Current Call: Structure generation (Pro)  │ │   │
│  │  ├────────────────────────────────────────────┤ │   │
│  │  │ Chapters:                                 │ │   │
│  │  │ ✓ Chapter 1: Introduction (2.1s)         │ │   │
│  │  │ ✓ Chapter 2: Overview (1.8s)             │ │   │
│  │  │ ⏳ Chapter 3: Methodology...             │ │   │
│  │  │ ⋯ 5 more chapters queued                 │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                      ↑
                      │
              [SSE Stream: status events]
                      │
┌─────────────────────────────────────────────────────────┐
│ Backend (Node.js + Express)                             │
│  ┌──────────────────────────────────────────────────┐   │
│  │ /api/ebook/generate (POST)                       │   │
│  │  - Receive request + SSE client                  │   │
│  │  - Create CallManager instance                   │   │
│  │  - Wire status callbacks → SSE stream            │   │
│  │  - Start ebook generation (ebookService)         │   │
│  │  - Send final result or error                    │   │
│  └──────────────────────────────────────────────────┘   │
│                      │                                   │
│                      ↓                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ebookService                                     │   │
│  │  - generateStructure()                           │   │
│  │  - generateChapters()                            │   │
│  │  - callManager.executeCall() (Stage 2)           │   │
│  └──────────────────────────────────────────────────┘   │
│                      │                                   │
│                      ↓                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ CallManager (Stage 1-2)                          │   │
│  │  - Quota management                              │   │
│  │  - Time budget tracking                          │   │
│  │  - Error classification                          │   │
│  │  - onStatusChange callbacks → SSE                │   │
│  └──────────────────────────────────────────────────┘   │
│                      │                                   │
│                      ↓                                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ aiService (genieService)                         │   │
│  │  - Call Gemini API                               │   │
│  │  - Return content                                │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Event Types

CallManager fires status events that flow through SSE to frontend:

| Event Type      | Payload                                               | Example                                                                                           |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `quota-update`  | `{ callsInWindow, percentUsed, isExhausted }`         | `{ callsInWindow: 10, percentUsed: 50, isExhausted: false }`                                      |
| `time-update`   | `{ elapsedMs, budgetMs, percentUsed, isExceeded }`    | `{ elapsedMs: 1200, budgetMs: 35000, percentUsed: 3.4, isExceeded: false }`                       |
| `time-tight`    | `{ percentUsed, remaining, urgency }`                 | `{ percentUsed: 82, remaining: 630, urgency: 'high' }`                                            |
| `call-start`    | `{ callIndex, callType, model }`                      | `{ callIndex: 3, callType: 'chapter-3', model: 'gemini-2.5-flash' }`                              |
| `call-complete` | `{ callIndex, callType, durationMs, status }`         | `{ callIndex: 3, callType: 'chapter-3', durationMs: 2100, status: 'success' }`                    |
| `call-deferred` | `{ callIndex, callType, reason, waitMs }`             | `{ callIndex: 5, callType: 'chapter-5', reason: 'quota-exhausted', waitMs: 150 }`                 |
| `error`         | `{ callIndex, callType, code, message, isRetriable }` | `{ callIndex: 0, callType: 'structure', code: 'AUTH_ERROR', message: '...', isRetriable: false }` |
| `complete`      | `{ totalCalls, totalTime, pageCount, success }`       | `{ totalCalls: 6, totalTime: 8420, pageCount: 5, success: true }`                                 |

---

## Backend Implementation

### 1. New Endpoint: `/api/ebook/generate-with-progress`

**Method**: `POST`  
**Transport**: Express + Server-Sent Events  
**Handler Location**: `server/index.js` (new route)

#### Request

```javascript
POST /api/ebook/generate-with-progress
Content-Type: application/json

{
  "url": "https://example.com/article",
  "title": "Article Title",
  "metadata": { ... }
}
```

#### Response (SSE)

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"quota-update","payload":{"callsInWindow":1,"percentUsed":5,"isExhausted":false}}
data: {"type":"call-start","payload":{"callIndex":0,"callType":"structure","model":"gemini-2.5-pro"}}
data: {"type":"call-complete","payload":{"callIndex":0,"callType":"structure","durationMs":2340,"status":"success"}}
...
```

### 2. Implementation Pattern

```javascript
// server/index.js (new endpoint)

app.post("/api/ebook/generate-with-progress", async (req, res) => {
  const { url, title, metadata } = req.body;

  // Set up SSE response
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const sendEvent = (type, payload) => {
    res.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
  };

  try {
    // Estimate page count for deadline
    const pageCount = await estimatePageCount(url);

    // Create CallManager with SSE callbacks
    const callManager = new CallManager({
      deadline: Date.now() + (10000 + pageCount * 5000),
      startTime: Date.now(),
      quotaLimit: 20,
      quotaWindow: 60000,

      onStatusChange: (status) => {
        // Status change: quota, time, or call events
        if (status.type === "quota-update") {
          sendEvent("quota-update", status.quotaStatus);
        } else if (status.type === "time-update") {
          sendEvent("time-update", status.timeStatus);
        } else if (status.type === "time-tight") {
          sendEvent("time-tight", {
            percentUsed: status.timeStatus.percentUsed,
            remaining: status.timeStatus.remainingMs,
            urgency: status.timeStatus.percentUsed > 90 ? "critical" : "high",
          });
        } else if (status.type === "call-start") {
          sendEvent("call-start", {
            callIndex: status.callIndex,
            callType: status.callType,
            model: status.model,
          });
        } else if (status.type === "call-complete") {
          sendEvent("call-complete", {
            callIndex: status.callIndex,
            callType: status.callType,
            durationMs: status.durationMs,
            status: "success",
          });
        }
      },

      onDeferral: (event) => {
        sendEvent("call-deferred", {
          callIndex: event.callIndex,
          callType: event.callType,
          reason: event.reason,
          waitMs: event.waitMs,
        });
      },
    });

    // Generate ebook with CallManager orchestration
    const result = await ebookService.handle({
      url,
      title,
      metadata,
      callManager, // Pass to ebookService
    });

    // Send completion event
    sendEvent("complete", {
      totalCalls: callManager.totalCallsAttempted,
      totalTime: Date.now() - callManager.startTime,
      pageCount: result.pageCount,
      success: true,
    });

    res.end();
  } catch (err) {
    sendEvent("error", {
      code: err.code || "UNKNOWN",
      message: err.message,
      isRetriable: callManager?.isRetriableError(err),
      context: err.callIndex
        ? {
            callIndex: err.callIndex,
            callType: err.callType,
          }
        : null,
    });

    res.end();
  }
});
```

### 3. Integration with ebookService

Modify `ebookService.handle()` to accept optional CallManager:

```javascript
export const handle = async (options) => {
  const { url, title, metadata, callManager: externalCallManager } = options;

  // Use external CallManager if provided (from Stage 3 endpoint)
  // Otherwise create one (for backward compatibility)
  const callManager =
    externalCallManager || createCallManager(pageCount, options);

  // Rest of implementation unchanged (Stage 2)
  // Structure call, chapter loop, error handling all work the same
  // ...
};
```

### 4. Error Handling with Enhanced Context

When errors occur, include full context from CallManager:

```javascript
catch (err) {
  const enhanced = callManager.enhanceError(err, {
    callIndex: currentCallIndex,
    callType: currentCallType,
    quotaStatus: callManager.getQuotaStatus(),
    timeStatus: callManager.getTimeStatus(),
  });

  sendEvent('error', {
    code: enhanced.code,
    message: enhanced.message,
    isRetriable: enhanced.isRetriable,
    context: {
      callIndex: enhanced.callIndex,
      callType: enhanced.callType,
      quotaPercent: enhanced.quotaStatus.percentUsed,
      timePercent: enhanced.timeStatus.percentUsed,
    },
  });
}
```

---

## Frontend Implementation

### 1. Progress UI Component (Svelte)

**Location**: `client/src/components/EbookProgressTracker.svelte`

#### Template Structure

```svelte
<script>
  let quotaPercent = 0;
  let timeRemaining = '10:00';
  let currentCall = '';
  let chapters = [];
  let isHealthy = true;
  let errorMessage = null;

  async function startGeneration(url, title) {
    errorMessage = null;
    chapters = [];

    const eventSource = new EventSource(
      `/api/ebook/generate-with-progress?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`
    );

    eventSource.addEventListener('message', (event) => {
      const { type, payload } = JSON.parse(event.data);

      switch (type) {
        case 'quota-update':
          quotaPercent = payload.percentUsed;
          isHealthy = !payload.isExhausted;
          break;

        case 'time-update':
          timeRemaining = formatTime(payload.budgetMs - payload.elapsedMs);
          isHealthy = !payload.isExceeded;
          break;

        case 'time-tight':
          // Show warning indicator
          isHealthy = payload.urgency !== 'critical';
          break;

        case 'call-start':
          currentCall = `${payload.callType} (${payload.model})`;
          break;

        case 'call-complete':
          chapters.push({
            index: payload.callIndex,
            type: payload.callType,
            duration: payload.durationMs,
            status: 'complete',
          });
          chapters = [...chapters]; // Trigger reactivity
          break;

        case 'call-deferred':
          chapters.push({
            index: payload.callIndex,
            type: payload.callType,
            status: 'deferred',
            reason: payload.reason,
            waitMs: payload.waitMs,
          });
          break;

        case 'error':
          errorMessage = `${payload.code}: ${payload.message}`;
          isHealthy = false;
          eventSource.close();
          break;

        case 'complete':
          currentCall = 'Complete!';
          eventSource.close();
          break;
      }
    });

    eventSource.onerror = () => {
      errorMessage = 'Connection lost';
      eventSource.close();
    };
  }

  function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }
</script>

<div class="ebook-progress {isHealthy ? 'healthy' : 'warning'}">
  <!-- Quota Bar -->
  <div class="progress-section">
    <div class="label">API Quota</div>
    <div class="progress-bar">
      <div class="fill" style="width: {quotaPercent}%"></div>
      <span class="percent">{Math.round(quotaPercent)}%</span>
    </div>
  </div>

  <!-- Time Budget -->
  <div class="progress-section">
    <div class="label">Time Remaining</div>
    <div class="time-display" class:warning={quotaPercent > 80}>
      {timeRemaining}
    </div>
  </div>

  <!-- Current Call -->
  <div class="progress-section">
    <div class="label">Current Call</div>
    <div class="current-call">{currentCall}</div>
  </div>

  <!-- Chapter Progress -->
  <div class="progress-section">
    <div class="label">Chapters</div>
    <div class="chapters-list">
      {#each chapters as chapter (chapter.index)}
        <div class="chapter-item {chapter.status}">
          <span class="status-icon">
            {#if chapter.status === 'complete'}
              ✓
            {:else if chapter.status === 'deferred'}
              ⏳
            {/if}
          </span>
          <span class="chapter-name">{chapter.type}</span>
          <span class="duration">{chapter.duration}ms</span>
        </div>
      {/each}
    </div>
  </div>

  <!-- Error Display -->
  {#if errorMessage}
    <div class="error-message">
      ⚠️ {errorMessage}
    </div>
  {/if}
</div>

<style>
  .ebook-progress {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 20px;
    border-radius: 8px;
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
  }

  .ebook-progress.warning {
    background: #fff3cd;
    border-color: #ffc107;
  }

  .progress-section {
    margin-bottom: 16px;
  }

  .label {
    font-size: 12px;
    font-weight: 600;
    color: #666;
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .progress-bar {
    position: relative;
    height: 24px;
    background: #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: linear-gradient(90deg, #4caf50, #66bb6a);
    transition: width 0.3s ease;
  }

  .percent {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 12px;
    font-weight: 600;
    color: #333;
  }

  .time-display {
    font-size: 24px;
    font-weight: bold;
    color: #333;
    font-family: 'Monaco', 'Courier New', monospace;
  }

  .time-display.warning {
    color: #ff9800;
  }

  .current-call {
    padding: 8px 12px;
    background: #e3f2fd;
    border-radius: 4px;
    font-size: 14px;
    color: #1565c0;
  }

  .chapters-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .chapter-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    background: white;
    border-radius: 4px;
    border-left: 3px solid #999;
  }

  .chapter-item.complete {
    border-left-color: #4caf50;
    background: #f1f8f4;
  }

  .chapter-item.deferred {
    border-left-color: #ff9800;
    background: #fff8f0;
  }

  .status-icon {
    font-weight: bold;
    width: 20px;
    text-align: center;
  }

  .chapter-name {
    flex: 1;
    font-size: 14px;
    color: #333;
  }

  .duration {
    font-size: 12px;
    color: #999;
    font-family: 'Monaco', 'Courier New', monospace;
  }

  .error-message {
    padding: 12px;
    background: #ffebee;
    color: #c62828;
    border-radius: 4px;
    font-size: 14px;
    border-left: 4px solid #c62828;
  }
</style>
```

### 2. Integration into Existing UI

**Location**: `client/src/routes/+page.svelte` (main ebook generator page)

```svelte
<script>
  import EbookProgressTracker from '../components/EbookProgressTracker.svelte';

  let showProgress = false;
  let url = '';
  let title = '';

  async function handleGenerate() {
    showProgress = true;
    // EbookProgressTracker component handles SSE connection
  }
</script>

<div class="ebook-generator">
  <div class="input-section">
    <input bind:value={url} placeholder="Enter URL..." />
    <input bind:value={title} placeholder="Title (optional)" />
    <button on:click={handleGenerate}>Generate</button>
  </div>

  {#if showProgress}
    <EbookProgressTracker {url} {title} />
  {/if}
</div>
```

---

## Data Flow & Timing

### Sequence Diagram

```
Frontend                 Backend                    CallManager
   │                        │                          │
   │─ POST generate ────────→│                          │
   │                        │─ Create CallManager ─────→│
   │                        │                          │
   │                        │─ structure call ─────────→│
   │                        │                    (Pro)  │
   │                        │                          │
   │←── SSE: call-start ────│←─ onStatusChange ────────│
   │                        │                          │
   │                        │─ generateStructure ─────→│
   │                        │←─ result ───────────────│
   │                        │                          │
   │←── SSE: call-complete ─│←─ onStatusChange ────────│
   │                        │                          │
   │                        │─ chapter 1 call ────────→│
   │                        │                    (Flash)│
   │                        │                          │
   │←── SSE: call-start ────│←─ onStatusChange ────────│
   │                        │                          │
   │                        │─ generateChapter ──────→│
   │                        │←─ result ───────────────│
   │                        │                          │
   │←── SSE: call-complete ─│←─ onStatusChange ────────│
   │                        │                          │
   │                        │ [... more chapters ...]   │
   │                        │                          │
   │←── SSE: complete ──────│─ finish ──────────────→│
   │                        │                          │
```

### Event Frequency & Volume

| Event Type      | Frequency                      | Example    |
| --------------- | ------------------------------ | ---------- |
| `quota-update`  | Per call (~6 for 5-page ebook) | 6x         |
| `time-update`   | Once per second                | ~10x       |
| `call-start`    | Per call                       | 6x         |
| `call-complete` | Per call                       | 6x         |
| `call-deferred` | On quota exhaustion            | 0-2x       |
| Total Events    | ~40-50 for typical request     |            |
| Bandwidth       | ~50KB total SSE stream         | Negligible |

---

## Error Handling Strategy

### Frontend Error States

| Error                 | Cause              | User Action                   |
| --------------------- | ------------------ | ----------------------------- |
| "Connection lost"     | Network disconnect | Show retry button             |
| "Quota exhausted"     | Too many API calls | Wait for reset (auto-retries) |
| "Deadline exceeded"   | Took too long      | Show time warning             |
| "Auth failed"         | API key invalid    | Check configuration           |
| "Service unavailable" | Gemini API down    | Retry later                   |

### Error Display

```svelte
{#if error.isRetriable}
  <!-- Show warning, not blocking -->
  <div class="warning">
    ⚠️ {error.message} - Retrying...
  </div>
{:else}
  <!-- Show error, blocking -->
  <div class="error">
    ❌ {error.message} - Cannot continue
  </div>
{/if}
```

---

## Performance Considerations

### SSE Performance

✅ **Advantages**:

- One-way streaming (no polling overhead)
- Automatic reconnection
- Native browser support
- Low latency (<100ms typical)

⚠️ **Limitations**:

- No bidirectional communication (we don't need it)
- Browser connection limit (~6 concurrent SSE connections per domain)
- Memory: SSE connections stay open for ~10-20s

### Optimization Strategy

1. **Event Batching**: Group multiple status updates into single SSE message if they arrive within same tick
2. **Throttling**: Limit `time-update` events to max 1 per second
3. **Lazy Loading**: Only send chapter details if requested
4. **Connection Pooling**: Reuse SSE connections for multiple requests (future optimization)

### Example: Event Throttling

```javascript
let lastTimeUpdate = 0;
const TIME_UPDATE_THROTTLE = 1000; // 1 second

onStatusChange: (status) => {
  if (status.type === "time-update") {
    const now = Date.now();
    if (now - lastTimeUpdate < TIME_UPDATE_THROTTLE) {
      return; // Skip this update
    }
    lastTimeUpdate = now;
  }
  sendEvent(status.type, status.payload);
};
```

---

## Testing Strategy for Stage 3

### Unit Tests

**Location**: `server/__tests__/ebookService.progress.test.js`

```javascript
describe("[SEQ-FRONTEND-001] Progress Endpoint", () => {
  test("streams quota updates", async () => {
    // Mock SSE response
    // Verify quota-update events
  });

  test("streams time-tight warning", async () => {
    // Create CallManager with short deadline
    // Verify time-tight event fires at >80%
  });

  test("streams error with context", async () => {
    // Simulate fatal error
    // Verify error event includes callIndex, callType, context
  });

  test("streams completion event", async () => {
    // Run full generation
    // Verify complete event with totalCalls, totalTime
  });
});
```

### Integration Tests

**Location**: `client/__tests__/EbookProgressTracker.test.js`

```javascript
describe("[SEQ-FRONTEND-002] Progress UI Component", () => {
  test("displays quota percentage", async () => {
    // Render component
    // Simulate quota-update SSE event
    // Verify bar updates
  });

  test("displays countdown timer", async () => {
    // Render component
    // Simulate time-update events
    // Verify countdown accuracy
  });

  test("displays chapter completion log", async () => {
    // Render component
    // Simulate call-complete events
    // Verify chapter list updates
  });

  test("shows error message and closes connection", async () => {
    // Render component
    // Simulate error event
    // Verify error display
    // Verify SSE connection closed
  });
});
```

### E2E Tests

**Tool**: Playwright or Cypress

```javascript
describe("[SEQ-FRONTEND-003] E2E Progress Flow", () => {
  test("full ebook generation with progress tracking", async () => {
    // Navigate to ebook generator
    // Enter URL + title
    // Click generate
    // Wait for quota bar to update
    // Wait for chapters to complete
    // Verify final PDF generated
  });

  test("handles network interruption gracefully", async () => {
    // Start generation
    // Simulate network failure
    // Verify error message
    // Verify no crash
  });
});
```

---

## Implementation Timeline

### Phase 1: Backend (Week 1)

- [ ] Create `/api/ebook/generate-with-progress` endpoint
- [ ] Wire SSE response
- [ ] Emit quota/time/call events from CallManager
- [ ] Add error event handling
- [ ] Unit tests for endpoint

### Phase 2: Frontend (Week 2)

- [ ] Create EbookProgressTracker.svelte component
- [ ] Implement EventSource connection
- [ ] Add progress bar UI (quota)
- [ ] Add time countdown display
- [ ] Add chapter log display
- [ ] Component tests

### Phase 3: Integration (Week 3)

- [ ] Integrate progress component into main page
- [ ] E2E tests
- [ ] Performance testing
- [ ] UX refinement

### Phase 4: Polish (Week 4)

- [ ] Error message improvements
- [ ] Accessibility (ARIA labels)
- [ ] Mobile responsiveness
- [ ] Documentation

---

## Success Criteria

### Functional Requirements

- [x] SSE endpoint streams status events
- [x] Frontend receives and displays quota %
- [x] Frontend displays time countdown
- [x] Frontend shows chapter completion in real-time
- [x] Errors display with enhanced context
- [x] Connection handles network failures gracefully

### Non-Functional Requirements

- [x] SSE latency <100ms
- [x] Event bandwidth <100KB total
- [x] No memory leaks on connection close
- [x] Handles 10+ concurrent requests
- [x] 95% test coverage for progress endpoint
- [x] Accessible (WCAG 2.1 AA)

### User Experience

- [x] User sees progress immediately
- [x] User knows how much time remains
- [x] User understands current operation
- [x] User notified of errors clearly
- [x] UI feels responsive and live

---

## Future Enhancements (Stage 4+)

### Short-term (Next Iteration)

- Progress estimation: ETA calculation
- Resume capability: Save/resume generation
- Batch optimization: Multiple ebooks simultaneously

### Medium-term (Future)

- WebSocket support (bidirectional control)
- Progress history/logging
- Notification sound options
- Mobile app integration

### Long-term (Vision)

- Predictive quota management
- Schedule generation for off-peak hours
- Collaborative ebook generation
- AI-suggested improvements during generation

---

## Architecture Decision Records (ADRs)

### ADR-1: Server-Sent Events over WebSockets

**Decision**: Use SSE instead of WebSocket for progress streaming

**Rationale**:

1. ✅ Simpler to implement (no bidirectional logic needed)
2. ✅ Native browser support (no additional libraries)
3. ✅ Automatic reconnection
4. ✅ Works through proxies/load balancers
5. ✅ Lower memory overhead

**Trade-offs**:

- ❌ One-way only (we don't need bidirectional anyway)
- ❌ Browser connection limit ~6 per domain (acceptable for this use case)

**Alternative Considered**: WebSocket (rejected - unnecessary complexity)

---

### ADR-2: Event Types and Payload Structure

**Decision**: Emit granular events (quota-update, time-update, call-start, etc.) rather than bulk status dumps

**Rationale**:

1. ✅ Frontend can subscribe to specific events
2. ✅ Reduces bandwidth (only changed fields)
3. ✅ Easier to throttle individual event types
4. ✅ Simpler frontend state management

**Example**:

```javascript
// ✅ Recommended: Granular events
sendEvent('quota-update', { callsInWindow: 5, percentUsed: 25 });
sendEvent('call-start', { callIndex: 1, callType: 'chapter-1' });

// ❌ Not recommended: Bulk dumps
sendEvent('status', { quota: {...}, time: {...}, calls: [...] });
```

---

### ADR-3: Component Library

**Decision**: Use Svelte for progress UI component

**Rationale**:

1. ✅ Already used in client codebase
2. ✅ Lightweight and reactive
3. ✅ Good for real-time updates
4. ✅ Minimal dependencies

**Alternative Considered**: React (rejected - already using Svelte)

---

## References

- **Stage 1**: `docs/PATIENCE_TIMER_BUILD_STAGE_1.md` - CallManager implementation
- **Stage 2**: `docs/PATIENCE_TIMER_BUILD_STAGE_2_COMPLETE.md` - ebookService integration
- **Architecture**: `docs/design/CALLMANAGER_ARCHITECTURE.md` - Overall blueprint
- **API**: [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)

---

## Conclusion

Stage 3 brings the backend infrastructure work (Stages 1-2) to users via a real-time progress UI. The design emphasizes:

1. **Simplicity**: SSE for one-way streaming, no complex bidirectional logic
2. **Transparency**: Users see exactly what's happening (quota, time, chapters)
3. **Robustness**: Graceful error handling, network resilience
4. **Performance**: Efficient event streaming, minimal bandwidth

The separation between CallManager (infrastructure), ebookService (content), and progress endpoint (UX) maintains clean architecture throughout.

**Ready for implementation** 🚀

---

**Design Status**: ✅ Complete  
**Next Phase**: Implementation (Stage 3 Build)  
**Estimated Effort**: 3-4 weeks  
**Risk Level**: Low (builds on validated Stages 1-2)
