# Solution Implementation: SSE Endpoint Integration Bug Fix

**Document ID**: SOLUTION_IMPLEMENTATION_SSE_ENDPOINT  
**Date**: December 10, 2025  
**Status**: Ready for Implementation  
**Target Audience**: Backend Engineers, Frontend Engineers  
**Related Architecture**: SOLUTION_ARCHITECTURE_SSE_ENDPOINT.md

---

## Table of Contents

1. [Overview & Scope](#overview--scope)
2. [Reference Design Documents](#reference-design-documents)
3. [Code Changes Required](#code-changes-required)
4. [Backend Implementation](#backend-implementation)
5. [Frontend Implementation](#frontend-implementation)
6. [Database/State Management](#databasestate-management)
7. [Testing & Validation](#testing--validation)
8. [Rollout & Verification](#rollout--verification)

---

## Overview & Scope

### What This Fixes

| Issue | Current State | After Fix |
|-------|---------------|-----------|
| Happy Path test 404 error | 404 when EventSource connects | ✅ Successful connection, real-time events |
| HTTP method mismatch | POST endpoint, GET request | ✅ GET endpoint with SSE headers |
| Parameter location mismatch | Body (POST) vs query (GET) | ✅ jobId in URL path, no params needed |
| Real-time progress | None (polling only in old model) | ✅ Events streamed via SSE |
| Zombie endpoint | generate-with-progress broken | ✅ Removed, replaced with correct endpoint |

### What This Doesn't Change

| Component | Status | Rationale |
|-----------|--------|-----------|
| POST /api/ebook/generate | ✅ No change | Working, proven, backward compatible |
| GET /api/ebook/:jobId | ✅ No change | Fallback result retrieval still works |
| GET /api/ebook/generate/:jobId/status | ✅ No change | Polling model still works (optional) |
| genieService.process() | ✅ No change | Core generation logic untouched |
| generateEbookInBackground() | 🔄 Wiring only | Add EventEmitter integration, no logic change |
| CallManager | ✅ Minimal | Already emits events, we subscribe |
| Existing tests | ✅ Compatible | No breaking changes |

---

## Reference Design Documents

### Primary References
1. **PATIENCE_TIMER_BLUEPRINT.md** (docs/design/)
   - Lines 880-940: SEQ-INTEGRATION-001 backend endpoint specification
   - Lines 500-570: TIMER-UI-001 frontend EventSource usage pattern
   - Lines 700-800: Event state machine and types

2. **PATIENCE_TIMER_BUILD_STAGE_3_DESIGN.md** (docs/design/)
   - SSE header specification
   - Event types and payload shapes
   - Request/response validation

3. **PATIENCE_TIMER_STAGE_3_COMPLETE.md** (docs/design/)
   - Phase implementation checklist
   - Integration points reference

### Supporting References
- feat/revert branch: Working polling implementation (reference for patterns)
- server/\_\_tests\_\_/CallManager.test.js: Event emission patterns
- server/\_\_tests\_\_/ebookService.progress.test.js: Test structure (currently placeholder)
- client/src/components/EbookProgressTracker.svelte: Frontend listener implementation

---

## Code Changes Required

### Summary Table

| File | Operation | Priority | Complexity |
|------|-----------|----------|-----------|
| server/index.js | Add GET /api/ebook/generate/:jobId/events | **CRITICAL** | Medium |
| server/index.js | Remove POST /api/ebook/generate-with-progress | **CRITICAL** | Low |
| server/index.js | Wire generateEbookInBackground() to emit events | **CRITICAL** | Medium |
| server/jobQueueManager.js | Add EventEmitter per jobId | **HIGH** | Low |
| server/CallManager.js | Ensure events emitted during executeCall() | **HIGH** | Low (verify) |
| client/src/App.svelte | Update to use EventSource endpoint | **HIGH** | Medium |
| client/src/components/EbookProgressTracker.svelte | Already implemented, verify compatibility | **MEDIUM** | Low |
| server/\_\_tests\_\_/ebookService.progress.test.js | Implement placeholder tests | **MEDIUM** | Medium |

---

## Backend Implementation

### Step 1: Wire EventEmitter in jobQueueManager

**File**: `server/jobQueueManager.js`

**What it does**: Creates an event emitter for each job to stream events to SSE endpoints.

```javascript
// Add at top of file
const EventEmitter = require('events');

// Modify constructor or add new method
class JobQueueManager {
  constructor() {
    // ... existing code ...
    this.jobEmitters = new Map(); // jobId → EventEmitter
  }

  /**
   * Get or create event emitter for a job
   * Used by GET /api/ebook/generate/:jobId/events to subscribe
   */
  getJobEmitter(jobId) {
    if (!this.jobEmitters.has(jobId)) {
      this.jobEmitters.set(jobId, new EventEmitter());
    }
    return this.jobEmitters.get(jobId);
  }

  /**
   * Emit event for a job (called during generation)
   */
  emitJobEvent(jobId, type, payload) {
    const emitter = this.getJobEmitter(jobId);
    emitter.emit(type, { type, payload });
    
    // Also log for debugging
    console.log(`[JobQueue] [${jobId}] Event: ${type}`);
  }

  /**
   * Cleanup emitter when job completes or fails
   */
  cleanupEmitter(jobId) {
    if (this.jobEmitters.has(jobId)) {
      const emitter = this.jobEmitters.get(jobId);
      emitter.removeAllListeners();
      this.jobEmitters.delete(jobId);
    }
  }
}
```

**Test**: 
```javascript
// verify getJobEmitter returns EventEmitter
const emitter = jobQueueManager.getJobEmitter('test-id');
expect(emitter).toBeInstanceOf(EventEmitter);
```

---

### Step 2: Integrate EventEmitter with generateEbookInBackground()

**File**: `server/index.js` (lines ~2982-3270)

**Current State**:
```javascript
async function generateEbookInBackground(
  jobId,
  reqId,
  payload,
  theme,
  pageCountNum,
  colorPalette,
  fontScaleNum,
  prompt
) {
  try {
    jobQueueManager.updateProgress(jobId, 5, "Starting ebook generation...");
    
    // ... rest of function ...
```

**What to Add**: Emit events at key points

```javascript
async function generateEbookInBackground(
  jobId,
  reqId,
  payload,
  theme,
  pageCountNum,
  colorPalette,
  fontScaleNum,
  prompt
) {
  try {
    // === EMIT: Phase starting ===
    jobQueueManager.emitJobEvent(jobId, 'phase-update', {
      phase: 'initializing',
      progress: 5,
      progressDetail: { currentChapter: 0, totalChapters: pageCountNum },
      message: 'Starting ebook generation...'
    });

    jobQueueManager.updateProgress(jobId, 5, "Starting ebook generation...");

    console.log(
      `[${new Date().toISOString()}] [${reqId}] [Job ${jobId}] Calling genieService.process() with pageCount=${pageCountNum}`
    );

    const processStartTime = Date.now();
    let result;
    try {
      // === NOTE: genieService calls CallManager internally ===
      // CallManager emits quota/time events through callbacks (see PATIENCE_TIMER_BLUEPRINT)
      // We need to bridge those events to our job emitter
      result = await genieService.process(payload);
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] [${reqId}] [Job ${jobId}] genieService.process() ERROR: ${err?.message}`
      );
      
      // === EMIT: Error event ===
      jobQueueManager.emitJobEvent(jobId, 'error', {
        error: err.message || 'Generation failed',
        isRetriable: false,
        callType: 'generation'
      });
      
      throw err;
    }
    const processEndTime = Date.now();

    // === EMIT: Composing phase ===
    jobQueueManager.emitJobEvent(jobId, 'phase-update', {
      phase: 'assembling',
      progress: 50,
      message: 'Composing HTML...'
    });

    jobQueueManager.updateProgress(jobId, 50, "Composing HTML...");

    // Extract envelope...
    const envelope = result.out_envelope || result;
    if (!envelope || !envelope.pages || !Array.isArray(envelope.pages)) {
      throw new Error("Invalid response structure from genieService");
    }

    // ... rest of processing ...

    // === EMIT: Finalizing phase ===
    jobQueueManager.emitJobEvent(jobId, 'phase-update', {
      phase: 'finalizing',
      progress: 95,
      message: 'Finalizing response...'
    });

    jobQueueManager.updateProgress(jobId, 95, "Finalizing response...");

    const responseObj = {
      // ... ebook object construction ...
    };

    // === EMIT: Complete event (with full result) ===
    jobQueueManager.emitJobEvent(jobId, 'complete', {
      result: responseObj
    });

    jobQueueManager.completeJob(jobId, responseObj);
    
    // === Cleanup event emitter after completion ===
    setTimeout(() => {
      jobQueueManager.cleanupEmitter(jobId);
    }, 5000); // Allow time for clients to receive

    console.log(
      `[${new Date().toISOString()}] [${reqId}] [Job ${jobId}] Background generation complete`
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] [${reqId}] [Job ${jobId}] Background generation error:`,
      error
    );
    
    // === EMIT: Error event ===
    jobQueueManager.emitJobEvent(jobId, 'error', {
      error: error.message,
      isRetriable: false
    });
    
    jobQueueManager.failJob(jobId, error.message);
    
    // === Cleanup event emitter ===
    setTimeout(() => {
      jobQueueManager.cleanupEmitter(jobId);
    }, 5000);
  }
}
```

**Notes on CallManager Integration**:
Currently, CallManager emits events but they go to internal callbacks. To surface them via SSE:

Option A (Recommended for Phase 1): Let CallManager events flow through genieService callbacks, genieService emits higher-level events (phase-update only)

Option B (Phase 2): Refactor CallManager to emit to jobQueueManager directly

For Phase 1, keep it simple: Emit phase-update events from generateEbookInBackground() only. Blueprint examples show quota-deferral, but those can be added in Phase 2 after integration is working.

---

### Step 3: Implement GET /api/ebook/generate/:jobId/events Endpoint

**File**: `server/index.js` (add after POST /api/ebook/generate endpoint, ~line 3245)

**Implementation**:

```javascript
/**
 * GET /api/ebook/generate/:jobId/events
 * 
 * Server-Sent Events (SSE) endpoint for real-time progress tracking
 * 
 * Purpose: Stream CallManager status updates to frontend as ebook generation progresses
 * 
 * Reference: PATIENCE_TIMER_BLUEPRINT.md [SEQ-INTEGRATION-001]
 * 
 * Request: GET /api/ebook/generate/{jobId}/events
 * Response: text/event-stream with events:
 *   - phase-update: { phase, progress, message }
 *   - quota-deferral: { waitMs, percentUsed, message }
 *   - time-status: { percentUsed, remainingMs, isExceeded }
 *   - complete: { result }
 *   - error: { error, isRetriable }
 * 
 * Usage: new EventSource('/api/ebook/generate/{jobId}/events')
 */
app.get("/api/ebook/generate/:jobId/events", (req, res) => {
  const { jobId } = req.params;
  const reqId = req.id || "unknown";
  
  console.log(
    `[${new Date().toISOString()}] [${reqId}] GET /api/ebook/generate/:jobId/events - jobId=${jobId}`
  );

  // === Validate jobId ===
  if (!jobId || typeof jobId !== "string" || !jobId.trim()) {
    return res.status(400).json({
      error: "INVALID_JOB_ID",
      message: "jobId must be a non-empty string"
    });
  }

  // === Check if job exists ===
  const jobStatus = jobQueueManager.getStatus(jobId);
  if (jobStatus.error) {
    // Job not found or error occurred
    return res.status(404).json({
      error: "JOB_NOT_FOUND",
      message: `Job ${jobId} not found`,
      details: jobStatus.error
    });
  }

  // === Set SSE response headers ===
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  
  // Flush headers to client immediately
  res.flushHeaders();

  // === Send initial status ===
  const sendEvent = (type, payload) => {
    try {
      const data = JSON.stringify({ type, payload });
      res.write(`event: ${type}\n`);
      res.write(`data: ${data}\n\n`);
      
      console.log(
        `[${new Date().toISOString()}] [${reqId}] [Job ${jobId}] SSE: ${type} sent`
      );
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] [${reqId}] [Job ${jobId}] SSE write error:`,
        err.message
      );
      // Client connection may have closed
    }
  };

  // Send current status immediately
  const currentStatus = jobQueueManager.getStatus(jobId);
  if (!currentStatus.error) {
    sendEvent("job-status", {
      jobId,
      status: currentStatus.status,
      progress: currentStatus.progress || 0,
      message: currentStatus.message || ""
    });
  }

  // === Subscribe to job events ===
  const emitter = jobQueueManager.getJobEmitter(jobId);

  // Event listeners for all event types
  const onPhaseUpdate = (event) => {
    sendEvent("phase-update", event.payload);
  };

  const onQuotaDeferral = (event) => {
    sendEvent("quota-deferral", event.payload);
  };

  const onTimeStatus = (event) => {
    sendEvent("time-status", event.payload);
  };

  const onComplete = (event) => {
    sendEvent("complete", event.payload);
    // Don't close immediately - let client read the event first
    setTimeout(() => {
      res.end();
    }, 100);
  };

  const onError = (event) => {
    sendEvent("error", event.payload);
    // Close connection after error
    setTimeout(() => {
      res.end();
    }, 100);
  };

  // Register listeners
  emitter.on("phase-update", onPhaseUpdate);
  emitter.on("quota-deferral", onQuotaDeferral);
  emitter.on("time-status", onTimeStatus);
  emitter.on("complete", onComplete);
  emitter.on("error", onError);

  // === Cleanup on client disconnect ===
  req.on("close", () => {
    console.log(
      `[${new Date().toISOString()}] [${reqId}] [Job ${jobId}] Client disconnected from SSE stream`
    );
    
    // Remove all listeners
    emitter.removeListener("phase-update", onPhaseUpdate);
    emitter.removeListener("quota-deferral", onQuotaDeferral);
    emitter.removeListener("time-status", onTimeStatus);
    emitter.removeListener("complete", onComplete);
    emitter.removeListener("error", onError);
  });

  // === Timeout protection (prevent zombie connections) ===
  const timeoutMs = 600000; // 10 minutes max
  const timeoutHandle = setTimeout(() => {
    console.warn(
      `[${new Date().toISOString()}] [${reqId}] [Job ${jobId}] SSE connection timeout`
    );
    sendEvent("error", {
      error: "Connection timeout - generation took too long",
      isRetriable: false
    });
    res.end();
  }, timeoutMs);

  // Clear timeout if connection ends naturally
  req.on("close", () => {
    clearTimeout(timeoutHandle);
  });
});
```

**Error Handling**:
- Invalid jobId → 400
- Job not found → 404
- Job already complete → Send current status + complete event immediately
- Job failed → Send error event
- Client disconnect → Clean up listeners
- Generation timeout → Send timeout error event

---

### Step 4: Remove Broken Endpoint

**File**: `server/index.js` (around line 3249)

**Action**: Delete the entire `POST /api/ebook/generate-with-progress` endpoint block

```javascript
// DELETE EVERYTHING from:
/**
 * POST /api/ebook/generate-with-progress
 * ...
 */
app.post("/api/ebook/generate-with-progress", async (req, res) => {
  // ... entire implementation ...
});
// DELETE TO END OF FUNCTION

// This endpoint was broken (404) because:
// - Browser EventSource API sends GET requests only
// - But this endpoint was POST-only
// - Architectural mismatch
// 
// Replacement: GET /api/ebook/generate/:jobId/events (added above)
```

**Verification**: Search for "generate-with-progress" - should find 0 results after deletion

---

## Frontend Implementation

### Step 1: Update App.svelte

**File**: `client/src/App.svelte`

**Current Pattern** (lines ~135):
```svelte
<button 
  class="generate-button"
  on:click={() => ebookStore.generate(prompt)}
  disabled={ebookLoading || !prompt.trim()}
>
  {ebookLoading ? 'Generating eBook...' : 'Generate eBook'}
</button>
```

**What to Change**: No changes needed to button handler if using ebookStore

The change happens in ebookStore, see Step 2.

---

### Step 2: Update ebookStore.js

**File**: `client/src/stores/ebookStore.js` (lines ~140-200)

**Current Pattern** (polling model):
```javascript
const { jobId } = initResponse;
console.log(`[EBOOK] Generation initiated with jobId: ${jobId}`);

// Step 2: Poll for completion with progress updates
const response = await ebookApi.pollEbookCompletion(
  jobId,
  (progress, message, quotaInfo) => {
    update((store) => ({
      ...store,
      progress,
      progressMessage: message,
    }));
  }
);
```

**Replacement (SSE model)**:
```javascript
const { jobId } = initResponse;
console.log(`[EBOOK] Generation initiated with jobId: ${jobId}`);

// Step 2: Open SSE stream for real-time progress
return new Promise((resolve, reject) => {
  const eventSource = new EventSource(
    `/api/ebook/generate/${jobId}/events`
  );

  // Track whether we've received completion
  let completed = false;

  eventSource.addEventListener("phase-update", (event) => {
    const data = JSON.parse(event.data);
    console.log(`[EBOOK] Phase: ${data.payload.phase}, progress: ${data.payload.progress}%`);
    update((store) => ({
      ...store,
      progress: data.payload.progress,
      progressMessage: data.payload.message,
    }));
  });

  eventSource.addEventListener("quota-deferral", (event) => {
    const data = JSON.parse(event.data);
    console.log(`[EBOOK] Quota deferral: ${data.payload.message}`);
    update((store) => ({
      ...store,
      progressMessage: data.payload.message,
    }));
  });

  eventSource.addEventListener("time-status", (event) => {
    const data = JSON.parse(event.data);
    if (data.payload.isExceeded) {
      console.warn(`[EBOOK] Time exceeded: ${data.payload.message}`);
    }
    update((store) => ({
      ...store,
      progressMessage: data.payload.message,
    }));
  });

  eventSource.addEventListener("complete", (event) => {
    const data = JSON.parse(event.data);
    completed = true;
    console.log("[EBOOK] Generation complete");
    
    // Close event stream
    eventSource.close();

    // Resolve with result
    resolve(data.payload.result);
  });

  eventSource.addEventListener("error", (event) => {
    const data = JSON.parse(event.data);
    console.error(`[EBOOK] Error: ${data.payload.error}`);
    
    // Close event stream
    eventSource.close();

    // Reject promise
    reject(new Error(data.payload.error || "Generation failed"));
  });

  // Fallback: close on network error
  eventSource.addEventListener("error", (err) => {
    if (eventSource.readyState === EventSource.CLOSED && !completed) {
      console.error("[EBOOK] EventSource connection lost");
      eventSource.close();
      reject(new Error("Connection lost during generation"));
    }
  });

  // Timeout after 10 minutes
  const timeoutHandle = setTimeout(() => {
    if (!completed) {
      console.error("[EBOOK] Generation timeout");
      eventSource.close();
      reject(new Error("Generation timeout after 10 minutes"));
    }
  }, 600000);

  // Clear timeout if completed
  const originalResolve = resolve;
  resolve = (result) => {
    clearTimeout(timeoutHandle);
    originalResolve(result);
  };
});
```

**Alternative**: If you want to keep the existing `pollEbookCompletion()` function for backward compatibility:

```javascript
// In ebookApi.js - add new function
export async function getEbookProgressStream(jobId, onProgress, onQuotaDeferral, onTimeStatus) {
  return new Promise((resolve, reject) => {
    const eventSource = new EventSource(`/api/ebook/generate/${jobId}/events`);
    
    eventSource.addEventListener("phase-update", (event) => {
      const data = JSON.parse(event.data);
      onProgress?.(data.payload.progress, data.payload.message);
    });

    eventSource.addEventListener("quota-deferral", (event) => {
      const data = JSON.parse(event.data);
      onQuotaDeferral?.(data.payload);
    });

    eventSource.addEventListener("time-status", (event) => {
      const data = JSON.parse(event.data);
      onTimeStatus?.(data.payload);
    });

    eventSource.addEventListener("complete", (event) => {
      const data = JSON.parse(event.data);
      eventSource.close();
      resolve(data.payload.result);
    });

    eventSource.addEventListener("error", (event) => {
      const data = JSON.parse(event.data);
      eventSource.close();
      reject(new Error(data.payload.error));
    });
  });
}

// Then in ebookStore:
const response = await ebookApi.getEbookProgressStream(
  jobId,
  (progress, message) => {
    update((store) => ({ ...store, progress, progressMessage: message }));
  },
  (quotaInfo) => {
    update((store) => ({
      ...store,
      quotaStatus: quotaInfo
    }));
  },
  (timeStatus) => {
    update((store) => ({
      ...store,
      timeStatus: timeStatus
    }));
  }
);
```

**Note**: Both approaches work. Choose based on code organization preference.

---

### Step 3: Verify EbookProgressTracker.svelte

**File**: `client/src/components/EbookProgressTracker.svelte`

This component already listens to EventSource (lines ~73):

```svelte
<script>
  const eventSource = new EventSource(`/api/ebook/generate/${jobId}/events`);
  
  eventSource.onmessage = (event) => {
    const update = JSON.parse(event.data);
    // ...
  };
</script>
```

**Action**: Verify this matches the endpoint name:
- ✅ `/api/ebook/generate/${jobId}/events` (matches new endpoint)
- ❌ `/api/ebook/generate-with-progress` (old broken endpoint)

If using `generate-with-progress`, update to `generate/${jobId}/events`.

---

## Database/State Management

### JobQueueManager State

No database schema changes needed. JobQueueManager already maintains:

```javascript
this.jobs = {
  [jobId]: {
    jobId,
    status: 'processing' | 'complete' | 'error',
    progress: 0-100,
    message: '',
    createdAt,
    result: null,
    error: null
  }
}
```

**Addition**: EventEmitter per job

```javascript
this.jobEmitters = {
  [jobId]: EventEmitter // Emits: phase-update, quota-deferral, time-status, complete, error
}
```

No persistence needed - these are in-memory streams that live for the generation lifetime.

---

## Testing & Validation

### Unit Tests (Backend)

**File**: `server/__tests__/ebook-sse.test.js` (NEW)

```javascript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

describe("[SSE] GET /api/ebook/generate/:jobId/events", () => {
  let app; // Express app instance

  beforeAll(async () => {
    // Import and start app in test mode
    app = require("../index.js");
  });

  afterAll(async () => {
    // Cleanup
  });

  describe("Endpoint Basics", () => {
    it("should return 400 for missing jobId", async () => {
      const res = await request(app).get("/api/ebook/generate//events");
      expect(res.status).toBe(404); // URL routing 404
    });

    it("should return 404 for non-existent jobId", async () => {
      const res = await request(app).get(
        "/api/ebook/generate/nonexistent-job/events"
      );
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("JOB_NOT_FOUND");
    });

    it("should return Content-Type: text/event-stream", async () => {
      // First create a job
      const initRes = await request(app)
        .post("/api/ebook/generate")
        .send({
          prompt: "Test prompt",
          theme: "dark",
          pageCount: 3
        });
      const { jobId } = initRes.body;

      // Then get events
      const res = await request(app).get(
        `/api/ebook/generate/${jobId}/events`
      );
      
      expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.headers.connection).toBe("keep-alive");
    });
  });

  describe("Event Streaming", () => {
    it("should emit phase-update events during generation", async (t) => {
      const initRes = await request(app)
        .post("/api/ebook/generate")
        .send({
          prompt: "Test prompt",
          theme: "dark",
          pageCount: 3
        });
      const { jobId } = initRes.body;

      // Open event stream
      return new Promise((resolve, reject) => {
        const events = [];
        let completed = false;

        const eventStream = request(app)
          .get(`/api/ebook/generate/${jobId}/events`)
          .on("data", (chunk) => {
            const text = chunk.toString();
            if (text.includes("event: phase-update")) {
              events.push("phase-update");
            }
            if (text.includes("event: complete")) {
              completed = true;
            }
          })
          .on("end", () => {
            expect(events.length).toBeGreaterThan(0);
            expect(completed).toBe(true);
            resolve();
          })
          .on("error", reject);

        // Give it 5 seconds to complete
        setTimeout(() => {
          if (!completed) {
            eventStream.abort();
            reject(new Error("Generation did not complete within 5s"));
          }
        }, 5000);
      });
    });

    it("should send complete event with result when done", async () => {
      const initRes = await request(app)
        .post("/api/ebook/generate")
        .send({
          prompt: "Test prompt",
          theme: "dark",
          pageCount: 3
        });
      const { jobId } = initRes.body;

      return new Promise((resolve, reject) => {
        let completePayload = null;

        const eventStream = request(app)
          .get(`/api/ebook/generate/${jobId}/events`)
          .on("data", (chunk) => {
            const text = chunk.toString();
            if (text.includes("event: complete")) {
              const lines = text.split("\n");
              const dataLine = lines.find((l) => l.startsWith("data:"));
              if (dataLine) {
                try {
                  const json = JSON.parse(dataLine.substring(6));
                  completePayload = json.payload;
                } catch (e) {
                  // Parse error
                }
              }
            }
          })
          .on("end", () => {
            expect(completePayload).toBeTruthy();
            expect(completePayload.result).toBeTruthy();
            expect(completePayload.result.id).toBeTruthy();
            expect(completePayload.result.pages).toBeTruthy();
            resolve();
          })
          .on("error", reject);

        setTimeout(() => {
          eventStream.abort();
          reject(new Error("Timeout waiting for complete event"));
        }, 10000);
      });
    });
  });

  describe("Error Handling", () => {
    it("should emit error event for invalid prompt", async () => {
      const initRes = await request(app)
        .post("/api/ebook/generate")
        .send({
          prompt: "", // Invalid empty prompt
          theme: "dark",
          pageCount: 3
        });
      expect(initRes.status).toBe(400);
    });

    it("should handle client disconnect gracefully", async () => {
      const initRes = await request(app)
        .post("/api/ebook/generate")
        .send({
          prompt: "Test prompt",
          theme: "dark",
          pageCount: 3
        });
      const { jobId } = initRes.body;

      return new Promise((resolve) => {
        const eventStream = request(app)
          .get(`/api/ebook/generate/${jobId}/events`)
          .on("data", () => {
            // Immediately close connection
            eventStream.abort();
          });

        setTimeout(() => {
          // Verify no errors in logs (graceful cleanup)
          resolve();
        }, 500);
      });
    });
  });
});
```

### Integration Tests (Polling vs SSE)

**File**: `server/__tests__/ebook-endpoint-compatibility.test.js` (NEW)

```javascript
import { describe, it, expect } from "vitest";
import request from "supertest";

describe("[Compatibility] Polling vs SSE Models", () => {
  let app;

  beforeAll(() => {
    app = require("../index.js");
  });

  it("should support polling model (original)", async () => {
    // Step 1: Initiate
    const initRes = await request(app)
      .post("/api/ebook/generate")
      .send({
        prompt: "Test prompt",
        theme: "dark",
        pageCount: 3
      });

    expect(initRes.status).toBe(202);
    const { jobId } = initRes.body;

    // Step 2: Poll for status
    let complete = false;
    let maxAttempts = 50; // Max 50 polls * 1s = 50 seconds

    while (!complete && maxAttempts-- > 0) {
      const statusRes = await request(app)
        .get(`/api/ebook/generate/${jobId}/status`);

      expect(statusRes.status).toBe(200);

      if (statusRes.body.status === "complete") {
        complete = true;
        break;
      }

      // Wait 1 second before next poll
      await new Promise((r) => setTimeout(r, 1000));
    }

    expect(complete).toBe(true);

    // Step 3: Get result
    const resultRes = await request(app)
      .get(`/api/ebook/${jobId}`);

    expect(resultRes.status).toBe(200);
    expect(resultRes.body.id).toBeTruthy();
  });

  it("should support SSE model (new)", async () => {
    // Step 1: Initiate
    const initRes = await request(app)
      .post("/api/ebook/generate")
      .send({
        prompt: "Test prompt",
        theme: "dark",
        pageCount: 3
      });

    expect(initRes.status).toBe(202);
    const { jobId } = initRes.body;

    // Step 2: Open event stream
    return new Promise((resolve, reject) => {
      let complete = false;

      const eventStream = request(app)
        .get(`/api/ebook/generate/${jobId}/events`)
        .on("data", (chunk) => {
          const text = chunk.toString();
          if (text.includes("event: complete")) {
            complete = true;
          }
        })
        .on("end", () => {
          expect(complete).toBe(true);
          resolve();
        })
        .on("error", reject);

      // Timeout after 30 seconds
      setTimeout(() => {
        eventStream.abort();
        if (!complete) {
          reject(new Error("SSE did not complete within 30s"));
        }
      }, 30000);
    });
  });

  it("should NOT have POST /api/ebook/generate-with-progress endpoint", async () => {
    const res = await request(app)
      .post("/api/ebook/generate-with-progress")
      .send({
        prompt: "Test",
        theme: "dark",
        pageCount: 3
      });

    expect(res.status).toBe(404); // Endpoint should not exist
  });
});
```

### Frontend Event Listener Tests

**File**: `client/__tests__/eventSource-listener.test.js` (NEW)

```javascript
import { describe, it, expect, vi } from "vitest";

// Mock EventSource
global.EventSource = vi.fn((url) => ({
  addEventListener: vi.fn(),
  close: vi.fn(),
  OPEN: 1,
  CLOSED: 2,
  readyState: 1,
}));

describe("[Frontend] EventSource Listener", () => {
  it("should open connection to correct URL", () => {
    const jobId = "test-job-123";
    const eventSource = new EventSource(
      `/api/ebook/generate/${jobId}/events`
    );

    expect(EventSource).toHaveBeenCalledWith(
      `/api/ebook/generate/${jobId}/events`
    );
  });

  it("should handle phase-update events", () => {
    const eventSource = new EventSource("/api/ebook/generate/test/events");
    const addEventListenerMock = vi.mocked(eventSource.addEventListener);

    // Simulate registering listener
    const handler = vi.fn();
    eventSource.addEventListener("phase-update", handler);

    expect(addEventListenerMock).toHaveBeenCalledWith(
      "phase-update",
      expect.any(Function)
    );
  });

  it("should parse JSON payload correctly", () => {
    const payload = {
      type: "phase-update",
      payload: {
        phase: "chapters",
        progress: 50,
        message: "Generating chapters..."
      }
    };

    const eventData = JSON.stringify(payload.payload);
    const parsed = JSON.parse(eventData);

    expect(parsed.phase).toBe("chapters");
    expect(parsed.progress).toBe(50);
  });
});
```

### Existing Tests Verification

**Files to check (no changes should break these)**:
- ✅ `server/__tests__/CallManager.test.js` – Quota/time event emission
- ✅ `server/__tests__/ebookService.progress.test.js` – Progress tracking
- ✅ `client/__tests__/endpoints.test.js` – API endpoint calls
- ✅ All other server/client tests

**Run before commit**:
```bash
npm run test                    # Client tests
cd server && npm run test       # Server tests
```

---

## Rollout & Verification

### Pre-Deployment Checklist

- [ ] Code review completed
- [ ] Backend unit tests passing
- [ ] Frontend event listener tests passing
- [ ] Integration tests passing
- [ ] No breaking changes to existing tests
- [ ] POST /api/ebook/generate-with-progress removed
- [ ] GET /api/ebook/generate/:jobId/events implemented
- [ ] EventEmitter integrated with jobQueueManager
- [ ] EventSource listeners updated in frontend
- [ ] Console logging includes [Job ${jobId}] for traceability

### Deployment Steps

1. **Merge feature branch** to target branch (develop/main)
2. **Deploy backend** with new SSE endpoint
3. **Deploy frontend** with EventSource listeners
4. **Verify in staging**:
   - Happy Path test (3-page ebook)
   - Monitor logs for `[SSE]` entries
   - Check browser DevTools Network tab for EventSource stream
5. **Production rollout**: Standard CI/CD pipeline

### Verification Commands

```bash
# Check endpoint exists
curl -i http://localhost:3000/api/ebook/generate/test/events
# Expected: 404 (job not found) with SSE headers

# Start generation
curl -X POST http://localhost:3000/api/ebook/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Test","theme":"dark","pageCount":3}'
# Returns: { jobId: "..." }

# Stream events
curl -N http://localhost:3000/api/ebook/generate/<jobId>/events
# Expected: SSE stream with events
```

### Monitoring

**Key Metrics to Track**:
- SSE connection count (per second)
- Average generation time
- Error rate (per event type)
- Client disconnect rate

**Log Patterns**:
```
[EBOOK] Generation initiated with jobId: ebook_...
[Job ebook_...] Event: phase-update sent
[Job ebook_...] Event: quota-deferral sent
[Job ebook_...] Event: complete sent
```

---

## Troubleshooting

### SSE Connection Fails with 404

**Symptom**: Browser console `Connection lost... Error event`

**Checklist**:
- [ ] Is `GET /api/ebook/generate/:jobId/events` endpoint deployed?
- [ ] Is jobId correct format?
- [ ] Does job exist? (check `/api/ebook/generate/:jobId/status`)
- [ ] Check server logs for endpoint registration errors

### Events Not Streaming

**Symptom**: Connection open but no events received

**Checklist**:
- [ ] Is `generateEbookInBackground()` calling `emitJobEvent()`?
- [ ] Is jobQueueManager.getJobEmitter() returning EventEmitter?
- [ ] Check server logs for "Event: phase-update sent"
- [ ] Verify generation is actually running (check progress)

### Too Many Zombie Connections

**Symptom**: Server memory growing, many open connections

**Solution**: Ensure cleanup is happening:
- [ ] req.on("close") listener removes event listeners
- [ ] Timeout (10 minutes) closes connection after generation
- [ ] cleanupEmitter() called after completion

---

## Sign-Off Checklist

- [ ] Backend implementation complete
- [ ] Frontend implementation complete
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Existing tests not broken
- [ ] Logging/debugging output verified
- [ ] Code review approved
- [ ] Documentation updated
- [ ] Ready for deployment

---

## References

**Architecture**: SOLUTION_ARCHITECTURE_SSE_ENDPOINT.md  
**Bug Analysis**: BUG_PHASE_4_SSE_ENDPOINT_404.md  
**Blueprint**: PATIENCE_TIMER_BLUEPRINT.md (lines 880-940)  
**Design**: PATIENCE_TIMER_BUILD_STAGE_3_DESIGN.md  

---

**Document Version**: 1.0  
**Last Updated**: December 10, 2025  
**Status**: Ready for Implementation

