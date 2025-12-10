# Solution Architecture: SSE Endpoint Integration Bug Fix

**Document ID**: SOLUTION_ARCHITECTURE_SSE_ENDPOINT  
**Date**: December 10, 2025  
**Status**: Ready for Implementation  
**Target Audience**: Technical Architects, Engineering Managers  
**Related Bug Report**: BUG_PHASE_4_SSE_ENDPOINT_404.md

---

## Executive Summary

The Phase 4 "Patience Timer Sequential" implementation attempted to add real-time progress tracking via Server-Sent Events (SSE) but created an **HTTP method incompatibility** that causes immediate 404 failures. The frontend (EventSource API) sends GET requests, but the backend only accepts POST. This document outlines the architectural solution that aligns the implementation with both the PATIENCE_TIMER_BLUEPRINT design specification and proven working patterns.

**Root Cause**: Browser EventSource API is constrained to GET requests only, but the new endpoint was implemented as POST-only.

**Solution**: Separate concerns into two complementary endpoints:

1. **POST /api/ebook/generate** (existing, proven working) – Initiates generation, returns jobId
2. **GET /api/ebook/generate/:jobId/events** (new) – Streams CallManager events via SSE

---

## Problem Decomposition

### Current Broken Design

```
Browser EventSource (GET-only)
         ↓
GET /api/ebook/generate-with-progress?prompt=...&theme=...
         ↓
Server: 404 (only has POST route)
         ↓
Connection fails, frontend shows "Connection lost"
```

**Why it fails:**

- EventSource API is hardcoded to use GET by browser security model
- Endpoint registered as `app.post()` (POST only)
- No matching GET route exists → 404

### Working Pattern (feat/revert)

```
fetch() with body
         ↓
POST /api/ebook/generate { prompt, theme, pageCount, ... }
         ↓
202 Accepted: { jobId, statusUrl, resultUrl }
         ↓
fetch() polling loop
         ↓
GET /api/ebook/generate/:jobId/status
GET /api/ebook/:jobId (when complete)
```

**Why it works:**

- HTTP method matches API design (POST for mutations, GET for queries)
- No incompatibility with browser APIs
- Polling is reliable, tested, deployed

### Blueprint Intent

From PATIENCE_TIMER_BLUEPRINT.md (approved design):

```javascript
// Frontend: One-way stream with EventSource
const eventSource = new EventSource(`/api/ebook/generate/${jobId}/events`);

// Backend: GET endpoint with SSE response
app.get("/api/ebook/generate/:jobId/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  // Stream CallManager events: phase-update, quota-deferral, time-status, etc.
});
```

**Specification**: GET endpoint at `/api/ebook/generate/:jobId/events`, NOT `/api/ebook/generate-with-progress`

---

## Solution Architecture

### Layer 1: Job Initiation (Unchanged, Proven)

**Endpoint**: `POST /api/ebook/generate`  
**Status**: ✅ Working, no changes needed  
**Request**: `{ prompt, theme, pageCount, colorPalette, fontSizeScale }`  
**Response**: `HTTP 202 { jobId, statusUrl, resultUrl }`  
**Behavior**: Returns immediately, starts background generation

```
POST /api/ebook/generate
  ↓
Validate request
  ↓
Create jobId
  ↓
Start async generateEbookInBackground()
  ↓
Return 202 + jobId (non-blocking)
```

### Layer 2: Event Stream (New, Adds Real-Time Progress)

**Endpoint**: `GET /api/ebook/generate/:jobId/events`  
**Status**: ⏳ To be implemented  
**Request**: Route parameter `jobId` (from POST response)  
**Response**: `text/event-stream` with 8 event types  
**Behavior**: Opens persistent connection, streams events as generation progresses

```
GET /api/ebook/generate/:jobId/events
  ↓
Connect to EventEmitter for this jobId
  ↓
Send SSE headers (Content-Type: text/event-stream)
  ↓
Stream events as they occur:
  - phase-update: { phase, progress }
  - quota-deferral: { waitMs, percentUsed, message }
  - time-status: { percentUsed, remainingMs }
  - complete: { result }
  - error: { error }
  ↓
Close connection when complete or error
```

### Layer 3: Result Retrieval (Unchanged, Proven)

**Endpoint**: `GET /api/ebook/:jobId`  
**Status**: ✅ Working (used by polling), compatible with SSE  
**Request**: Route parameter `jobId`  
**Response**: Complete ebook object when `status === "complete"`  
**Behavior**: Fallback for retrieving final result if not streamed

---

## Design Principles

### 1. Separation of Concerns

| Layer          | Responsibility               | HTTP Method | Browser API |
| -------------- | ---------------------------- | ----------- | ----------- |
| **Initiation** | Create job, start generation | POST        | fetch()     |
| **Events**     | Stream real-time progress    | GET         | EventSource |
| **Result**     | Retrieve final data          | GET         | fetch()     |

### 2. Browser API Compliance

- **EventSource**: GET only (immutable)
- **fetch()**: Any method with body support
- **No mixing**: Don't try to send EventSource request to POST endpoint

### 3. Backward Compatibility

- ✅ POST /api/ebook/generate remains unchanged
- ✅ GET /api/ebook/:jobId remains unchanged
- ✅ Polling model still works (no SSE needed)
- ❌ POST /api/ebook/generate-with-progress should be removed (never worked)

### 4. CallManager Integration

```
generateEbookInBackground()
  ├─ jobQueueManager.createJob()
  ├─ CallManager.executeCall() [per chapter]
  │  ├─ Emits: quota-deferral, time-status
  │  └─ Updates: jobQueueManager progress
  ├─ Emits events → EventEmitter[jobId]
  └─ jobQueueManager.completeJob()

EventEmitter[jobId] ← Subscribed by GET /api/ebook/generate/:jobId/events
                      Streams events via SSE to frontend
```

---

## Event Schema (from Blueprint)

Each SSE event follows this pattern:

```javascript
// phase-update: Sent when phase changes (structure → chapter 1 → chapter 2 → etc)
event: phase-update
data: {
  "type": "phase-update",
  "phase": "chapters",
  "currentChapter": 1,
  "totalChapters": 5,
  "progress": 40
}

// quota-deferral: Sent when API quota exhausted, waiting for reset
event: quota-deferral
data: {
  "type": "quota-deferral",
  "waitMs": 30000,
  "callsInWindow": 20,
  "quotaLimit": 20,
  "percentUsed": 100,
  "message": "Quota limit reached. Waiting 30s for reset..."
}

// time-status: Sent when time budget approaching or exceeded
event: time-status
data: {
  "type": "time-status",
  "percentUsed": 85,
  "remainingMs": 90000,
  "isExceeded": false,
  "message": "Time budget 85% used, continuing..."
}

// complete: Sent when generation finished
event: complete
data: {
  "type": "complete",
  "result": {
    "id": "ebook_...",
    "html": "...",
    "title": "...",
    "pages": [...],
    "metadata": {...}
  }
}

// error: Sent on fatal error
event: error
data: {
  "type": "error",
  "error": "Prompt validation failed",
  "isRetriable": false
}
```

---

## Frontend Usage Pattern

```javascript
// Step 1: Initiate generation (get jobId)
const initiateResponse = await fetch('/api/ebook/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt, theme, pageCount, ... })
});
const { jobId } = await initiateResponse.json(); // HTTP 202

// Step 2: Open event stream
const eventSource = new EventSource(`/api/ebook/generate/${jobId}/events`);

// Step 3: Listen for events
eventSource.addEventListener('phase-update', (event) => {
  const { phase, progress } = JSON.parse(event.data);
  updateProgressBar(progress);
  updatePhaseDisplay(phase);
});

eventSource.addEventListener('quota-deferral', (event) => {
  const { waitMs, message } = JSON.parse(event.data);
  showDeferralTimer(waitMs, message);
});

eventSource.addEventListener('complete', (event) => {
  const { result } = JSON.parse(event.data);
  displayEbook(result);
  eventSource.close();
});

eventSource.addEventListener('error', (event) => {
  const { error } = JSON.parse(event.data);
  showErrorMessage(error);
  eventSource.close();
});
```

---

## Migration Path

### What to Keep

- ✅ POST /api/ebook/generate (no changes)
- ✅ GET /api/ebook/:jobId (no changes)
- ✅ GET /api/ebook/generate/:jobId/status (no changes, optional with SSE)
- ✅ generateEbookInBackground() (integrate with EventEmitter)
- ✅ jobQueueManager (wire events to SSE)

### What to Remove

- ❌ POST /api/ebook/generate-with-progress (never worked, architectural flaw)

### What to Add

- ⭐ GET /api/ebook/generate/:jobId/events (new SSE endpoint)
- ⭐ EventEmitter integration for jobId-specific event streaming
- ⭐ Frontend EventSource listener in ProgressTimer component

### What to Update

- 🔄 generateEbookInBackground() to emit events
- 🔄 CallManager integration to report quota/time events
- 🔄 Frontend to use EventSource instead of polling (optional, both work)

---

## Testing Strategy

### Unit Tests (Backend)

- ✅ POST /api/ebook/generate returns 202 + jobId
- ✅ GET /api/ebook/generate/:jobId/events returns text/event-stream
- ✅ SSE headers set correctly (Content-Type, Cache-Control, Connection)
- ✅ Events emitted in correct order (phase → quota → time → complete)
- ✅ Connection closes on error
- ✅ Invalid jobId returns 404

### Integration Tests (Backend + Client)

- ✅ Full flow: POST → GET events → receives updates → complete
- ✅ Quota deferral event emitted when quota exhausted
- ✅ Time status event emitted when approaching deadline
- ✅ Fallback to polling still works

### E2E Tests (Full Stack)

- ✅ Happy Path (Phase 4 test): 3-page ebook with real-time progress
- ✅ Quota Wait: Generation pauses and resumes showing deferral UI
- ✅ Time Tight: User sees warning but generation continues
- ✅ Error Handling: Invalid input shows error event, connection closes

### Existing Tests (Must Not Break)

- ✅ server/\_\_tests\_\_/CallManager.test.js
- ✅ server/\_\_tests\_\_/ebookService.progress.test.js
- ✅ client/\_\_tests\_\_/endpoints.test.js
- ✅ All other existing server/client tests

---

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  App.svelte / EbookProgressTracker                      │  │
│  │  ─────────────────────────────────────────────────      │  │
│  │  1. fetch(POST /api/ebook/generate)                    │  │
│  │     └─ Response: jobId                                 │  │
│  │  2. new EventSource(/api/ebook/generate/:jobId/events) │  │
│  │     └─ Listener for phase, quota, time, complete       │  │
│  │  3. Update progress bar, phase display, UI state       │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                              ↕
                    [Network Boundary]
                              ↕
┌────────────────────────────────────────────────────────────────┐
│                      SERVER (Express)                          │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  POST /api/ebook/generate                              │  │
│  │  ─────────────────────────────                          │  │
│  │  • Validate request                                    │  │
│  │  • Create jobId                                        │  │
│  │  • Return 202 Accepted (non-blocking)                  │  │
│  │  • Start: generateEbookInBackground(jobId, ...)        │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                         │                                      │
│                         ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  generateEbookInBackground()                            │  │
│  │  ─────────────────────────────────────                  │  │
│  │  • jobQueueManager.createJob()                         │  │
│  │  • genieService.process() → CallManager API calls      │  │
│  │  • CallManager emits events (quota, time)              │  │
│  │  • emit('phase-update', 'quota-deferral', etc)         │  │
│  │    → EventEmitter[jobId]                               │  │
│  │  • jobQueueManager.completeJob(result)                 │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                         │                                      │
│                         ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  EventEmitter[jobId] (in-memory event bus)             │  │
│  │  ─────────────────────────────────────────             │  │
│  │  Subscribers: GET /api/ebook/generate/:jobId/events    │  │
│  │  Events: phase-update, quota-deferral, time-status,... │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                         │                                      │
│                         ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  GET /api/ebook/generate/:jobId/events                 │  │
│  │  ───────────────────────────────────────────            │  │
│  │  • Set SSE headers                                     │  │
│  │  • Subscribe to EventEmitter[jobId]                    │  │
│  │  • Write events as they arrive                         │  │
│  │  • Close on client disconnect or error                 │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                         │                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  GET /api/ebook/:jobId (Fallback)                      │  │
│  │  ───────────────────────────                            │  │
│  │  • Return final result if needed                        │  │
│  │  • Compatible with polling model                       │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Success Criteria

✅ **Architectural Requirements:**

1. POST /api/ebook/generate works (unchanged from working branch)
2. GET /api/ebook/generate/:jobId/events accepts GET requests (EventSource compatible)
3. Event stream flows from CallManager → EventEmitter → SSE stream → Frontend
4. No HTTP method conflicts

✅ **Functional Requirements:**

1. Happy Path test (3-page ebook) completes without 404 errors
2. Real-time progress displayed to user (phase updates every 5-10 seconds)
3. Quota deferral events trigger timer UI (e.g., "Waiting 45s for quota reset...")
4. Time status events shown when approaching deadline
5. Final ebook result delivered correctly

✅ **Test Requirements:**

1. No breaking changes to existing server tests
2. No breaking changes to existing client tests
3. New SSE endpoint tests pass
4. Phase 4 manual tests pass (Happy Path + other scenarios)

✅ **Code Quality:**

1. No zombie code (remove generate-with-progress)
2. Event types match blueprint specification
3. Error handling consistent with existing patterns
4. Logging follows established conventions

---

## References

- **PATIENCE_TIMER_BLUEPRINT.md** – Architecture specification (SEQ-INTEGRATION-001)
- **BUG_PHASE_4_SSE_ENDPOINT_404.md** – Detailed bug analysis
- **PATIENCE_TIMER_BUILD_STAGE_3_DESIGN.md** – Stage 3 design doc
- **feat/revert branch** – Working reference implementation (polling model)
- **feat/patience-timer-sequential branch** – Current broken implementation

---

## Sign-Off

**Approved By**: Architecture Review  
**Date**: December 10, 2025  
**Implementation Target**: Sprint [N]  
**Estimated Effort**: 2-3 developer-days (implementation + testing)
