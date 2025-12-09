# Patience Timer Blueprint: Sequential CallManager with Real-Time UX

**Document ID**: PATIENCE_TIMER_BLUEPRINT  
**Date**: December 9, 2025 @ 4:30PM
**Status**: Architecture Specification for Implementation  
**Branch Requirement**: `feat/patience-timer-sequential` (dedicated implementation branch)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Design Principles](#design-principles)
3. [Backend Architecture](#backend-architecture)
   - [SEQ-CORE-001: CallManager Sequential Orchestration](#seq-core-001-callmanager-sequential-orchestration)
   - [SEQ-QUOTA-001: Quota Management with Deferral](#seq-quota-001-quota-management-with-deferral)
   - [SEQ-TIME-001: Time Budget Tracking](#seq-time-001-time-budget-tracking)
   - [SEQ-ERROR-001: Error Classification & Handling](#seq-error-001-error-classification--handling)
4. [Frontend Architecture](#frontend-architecture)
   - [TIMER-UI-001: Real-Time Progress Timer Component](#timer-ui-001-real-time-progress-timer-component)
   - [TIMER-STATE-001: Frontend State Management](#timer-state-001-frontend-state-management)
   - [TIMER-FEEDBACK-001: User Feedback Mechanisms](#timer-feedback-001-user-feedback-mechanisms)
5. [Integration Points](#integration-points)
   - [SEQ-INTEGRATION-001: Backend-Frontend WebSocket/SSE Events](#seq-integration-001-backend-frontend-websocketsee-events)
   - [SEQ-INTEGRATION-002: ebookService Integration](#seq-integration-002-ebookservice-integration)
   - [SEQ-INTEGRATION-003: Job Queue Integration](#seq-integration-003-job-queue-integration)
6. [Event Flow & Timing](#event-flow--timing)
7. [Error Handling & Edge Cases](#error-handling--edge-cases)
8. [Performance Characteristics](#performance-characteristics)
9. [Testing Strategy](#testing-strategy)
10. [Migration Path](#migration-path)

---

## Executive Summary

**Patience Timer Blueprint** implements sequential ebook generation with transparent quota/time management and real-time user feedback. Users see exactly what's happening (structure generation → chapters → quota wait → resume) instead of silent fallback to stubs.

**Core Innovation**: Visibility transforms a constraint (quota wait) into acceptable UX. Users understand why they're waiting and see progress in real-time.

**Key Guarantee**: No fallback stubs. If quota exhausted, the system waits and retries—delivering full-quality content, never placeholders.

**Timeline Expectation**:

- 3-10 pages: 30-45 seconds (no quota wait)
- 10-20 pages: 60-120 seconds (1-2 quota resets visible)
- 20+ pages: 2-4 minutes with patient waiting (pre-batch phase)

---

## Design Principles

1. **Transparency Over Silence**: Users see quota waits, not silent failures
2. **Quality Over Speed**: Full content delivered, never stubs
3. **Sequential is Honest**: Don't pretend batching exists; show real quota limits
4. **Timer Builds Trust**: Visible countdown reduces abandonment
5. **Infrastructure Visible**: Users understand API constraints, not perceive bugs
6. **Backend Decoupled**: Frontend timer reflects backend state, not coupled to it

---

## Backend Architecture

### SEQ-CORE-001: CallManager Sequential Orchestration

**Purpose**: Orchestrate sequential API calls with quota/time awareness. Never fail on infrastructure constraints (quota, time), only on genuine errors (auth, API errors).

**Key Responsibilities**:

- Track per-call quota consumption
- Manage time budget vs. deadline
- Defer calls transparently when quota exhausted
- Provide observable metrics for frontend progress

**Class Structure**:

```javascript
class CallManager {
  constructor(options = {}) {
    // Time Management
    this.deadline = options.deadline || Date.now() + 600000; // 10min default
    this.startTime = options.startTime || Date.now();

    // Quota Management
    this.quotaLimit = options.quotaLimit || 20; // calls per minute
    this.quotaWindow = options.quotaWindow || 60000; // ms

    // State Tracking
    this.callHistory = []; // All calls with timestamps, models, status
    this.isProcessing = false;
    this.lastWindowReset = Date.now();
    this.deferralCount = 0;
    this.totalCallsAttempted = 0;

    // Configuration
    this.config = {
      autoRetry: options.autoRetry !== false,
      maxDeferralWait: options.maxDeferralWait || 120000, // 2 minutes
      onStatusChange: options.onStatusChange || (() => {}),
      onDeferral: options.onDeferral || (() => {}),
    };
  }

  /**
   * Execute a single API call with quota/time management.
   *
   * Behavior:
   * - Quota exhausted? Defer, wait for window reset, retry automatically
   * - Time tight? Warn but continue (user controls deadline)
   * - Genuine error? Fail with enhanced context
   *
   * @param {Function} callFn - Async function making AI call
   * @param {number} callIndex - Sequential index (0=Pro/structure, >0=Flash/chapters)
   * @param {string} callType - Type identifier (structure|chapter-1|chapter-2|etc)
   * @returns {Promise<Object>} Result from callFn
   */
  async executeCall(callFn, callIndex, callType = "content") {
    this.totalCallsAttempted++;

    // [SEQ-QUOTA-001] Check quota before call
    await this.manageQuota();

    // [SEQ-TIME-001] Check time budget
    const timeStatus = this.getTimeStatus();
    if (timeStatus.percentUsed > 80) {
      this.config.onStatusChange({
        type: "time-tight",
        phase: callType,
        percentUsed: timeStatus.percentUsed,
        remainingMs: timeStatus.remainingMs,
      });
    }

    // Determine model (Pro for structure, Flash for chapters)
    const model = callIndex === 0 ? "gemini-2.5-pro" : "gemini-2.5-flash";

    try {
      const result = await callFn(model);

      // Record successful call
      this.callHistory.push({
        timestamp: Date.now(),
        callIndex,
        callType,
        model,
        status: "success",
      });

      return result;
    } catch (error) {
      // [SEQ-ERROR-001] Classify error
      const isRetriable = this.isRetriableError(error);

      if (isRetriable && this.config.autoRetry) {
        // Emit deferral event for frontend
        this.deferralCount++;
        this.config.onDeferral({
          callIndex,
          callType,
          error: error.message,
          retryAfter: "quota-reset",
        });

        // Wait for quota window reset
        await this.waitForQuotaReset();

        // Retry recursively
        return this.executeCall(callFn, callIndex, callType);
      } else {
        // Genuine error - fail with context
        throw this.enhanceError(error, {
          callIndex,
          callType,
          model,
          quotaStatus: this.getQuotaStatus(),
          timeStatus: this.getTimeStatus(),
        });
      }
    }
  }

  // [Helper methods - see CALLMANAGER_ARCHITECTURE.md for full implementation]
  async manageQuota() {
    /* ... */
  }
  async waitForQuotaReset() {
    /* ... */
  }
  isRetriableError(error) {
    /* ... */
  }
  enhanceError(error, context) {
    /* ... */
  }
  getQuotaStatus() {
    /* ... */
  }
  getTimeStatus() {
    /* ... */
  }
  getStatus() {
    /* ... */
  }
}

module.exports = CallManager;
```

**Integration Point**: ebookService creates CallManager per-request, passes callbacks for progress updates.

---

### SEQ-QUOTA-001: Quota Management with Deferral

**Purpose**: Track per-minute quota consumption, defer when exhausted, transparent retry after window reset.

**Implementation Strategy**:

```
Timeline Example: 10-page ebook (11 calls: 1 structure + 10 chapters)

T=0:00s  │ Call #1 (structure)  → Success (1/20 quota)
T=0:05s  │ Calls #2-#20         → Success (20/20 quota FULL)
T=0:50s  │ Call #21 (chapter 10)
         │ ├─ Check quota: 20/20 in window ✗
         │ ├─ Emit 'quota-deferral' event: "Waiting 45s for reset"
         │ ├─ Sleep 45 seconds (window expires at T=1:00s)
         │ └─ [Frontend shows countdown timer]
T=1:00s  │ Window reset → Clear call history
         │ Call #21 retries      → Success (1/20 in new window)
T=1:05s  │ Complete

User sees: "Structure done. Generating 10 chapters... ⏸️ Quota limit hit. Waiting 45 seconds..."
Result: Full 10-chapter ebook, not 9 chapters + stub
```

**Quota Tracking Details**:

```javascript
async manageQuota() {
  const now = Date.now();
  const windowAge = now - this.lastWindowReset;

  // Reset window if expired
  if (windowAge >= this.quotaWindow) {
    this.callHistory = this.callHistory.filter(
      (call) => now - call.timestamp < this.quotaWindow
    );
    this.lastWindowReset = now;
  }

  // Count successful calls in current window
  const callsInWindow = this.callHistory.filter(
    (call) => call.status === 'success' &&
              now - call.timestamp < this.quotaWindow
  ).length;

  // If at limit, wait for reset
  if (callsInWindow >= this.quotaLimit) {
    const waitTime = this.quotaWindow - windowAge + 100; // +100ms buffer

    // Emit event for frontend
    this.config.onStatusChange({
      type: 'quota-deferral',
      callsInWindow,
      quotaLimit: this.quotaLimit,
      waitMs: Math.max(0, waitTime),
      message: `Quota exhausted (${callsInWindow}/${this.quotaLimit}). Waiting ${Math.max(0, waitTime)}ms for reset.`,
    });

    // Wait transparently
    await this.sleep(waitTime);

    // Recursively check quota (may reset and be OK now)
    return this.manageQuota();
  }
}

async waitForQuotaReset() {
  const now = Date.now();
  const windowAge = now - this.lastWindowReset;
  const waitTime = this.quotaWindow - windowAge + 100;

  this.config.onStatusChange({
    type: 'quota-wait-reset',
    waitMs: Math.max(0, waitTime),
  });

  await this.sleep(Math.max(0, waitTime));
  this.lastWindowReset = Date.now();
}
```

**Frontend Integration**: `onStatusChange` events with `type: 'quota-deferral'` trigger timer countdown on frontend.

---

### SEQ-TIME-001: Time Budget Tracking

**Purpose**: Track time elapsed vs. deadline. Warn when tight, continue anyway (user controls deadline).

**Implementation**:

```javascript
getTimeStatus() {
  const now = Date.now();
  const elapsedMs = now - this.startTime;
  const budgetMs = this.deadline - this.startTime;
  const remainingMs = Math.max(0, this.deadline - now);

  return {
    elapsedMs,
    budgetMs,
    remainingMs,
    percentUsed: Math.round((elapsedMs / budgetMs) * 100),
    isExceeded: now > this.deadline,
    formattedRemaining: this.formatMs(remainingMs), // "2m 30s"
  };
}

// Emitted during executeCall
if (timeStatus.percentUsed > 80 && timeStatus.percentUsed < 100) {
  this.config.onStatusChange({
    type: 'time-tight',
    phase: callType,
    percentUsed: timeStatus.percentUsed,
    remainingMs: timeStatus.remainingMs,
    message: `⚠️ Time budget ${timeStatus.percentUsed}% used (${timeStatus.formattedRemaining} remaining)`,
  });
} else if (timeStatus.percentUsed >= 100) {
  this.config.onStatusChange({
    type: 'time-exceeded',
    elapsedMs: timeStatus.elapsedMs,
    deadlineMs: timeStatus.budgetMs,
    message: `⚠️ Deadline exceeded, continuing anyway...`,
  });
}
```

**Deadline Calculation** (from frontend):

```javascript
// For N-page ebook, estimate time
calculateDeadline(pageCount) {
  // Baseline: 3 seconds per page (Pro structure + Flash chapters)
  const baselineMs = pageCount * 3000;

  // Quota resets: ~1 reset per 20 pages, 60s per reset
  const estimatedResets = Math.floor(pageCount / 20);
  const quotaWaitMs = estimatedResets * 60000;

  // Safety buffer: 30 seconds
  const bufferMs = 30000;

  return Date.now() + baselineMs + quotaWaitMs + bufferMs;
}
```

---

### SEQ-ERROR-001: Error Classification & Handling

**Purpose**: Distinguish retriable infrastructure errors from fatal genuine errors.

**Error Matrix**:

```
RETRIABLE (Infrastructure Errors):
├─ QUOTA_EXHAUSTED (429, RATE_LIMIT_EXCEEDED)
│  └─ Action: Defer, wait for window reset, auto-retry
├─ SERVICE_UNAVAILABLE (503)
│  └─ Action: Defer with backoff, auto-retry
├─ TEMPORARY_FAILURE (network timeout, transient)
│  └─ Action: Defer with backoff, auto-retry
└─ RESOURCE_EXHAUSTED (model busy)
   └─ Action: Defer, wait, auto-retry

FATAL (Genuine Errors - No Retry):
├─ INVALID_ARGUMENT (400, bad input)
│  └─ Action: FAIL immediately (caller bug)
├─ AUTHENTICATION_FAILED (401, invalid API key)
│  └─ Action: FAIL immediately (config error)
├─ PERMISSION_DENIED (403, access control)
│  └─ Action: FAIL immediately (auth error)
└─ NOT_FOUND (404, model removed)
   └─ Action: FAIL immediately (config error)
```

**Implementation**:

```javascript
isRetriableError(error) {
  const code = (error.code || error.status || error.message).toString();

  const retriableCodes = [
    'QUOTA_EXHAUSTED', 'RATE_LIMIT_EXCEEDED', 'SERVICE_UNAVAILABLE',
    'TEMPORARY_FAILURE', 'RESOURCE_EXHAUSTED', '429', '503', '504'
  ];

  const fatalCodes = [
    'INVALID_ARGUMENT', 'AUTHENTICATION_FAILED', 'INVALID_API_KEY',
    'PERMISSION_DENIED', 'NOT_FOUND', '400', '401', '403', '404'
  ];

  for (const retriable of retriableCodes) {
    if (code.includes(retriable)) return true;
  }

  for (const fatal of fatalCodes) {
    if (code.includes(fatal)) return false;
  }

  // Default: assume retriable (conservative approach)
  return true;
}

enhanceError(error, context) {
  const enhanced = new Error(
    `[${context.callType}#${context.callIndex}] ${error.message}`
  );

  enhanced.callIndex = context.callIndex;
  enhanced.callType = context.callType;
  enhanced.model = context.model;
  enhanced.quotaStatus = context.quotaStatus;
  enhanced.timeStatus = context.timeStatus;
  enhanced.recentCalls = this.callHistory.slice(-5);
  enhanced.originalError = error;

  return enhanced;
}
```

**Frontend Integration**: Fatal errors shown immediately to user; retriable errors trigger deferral timer.

---

## Frontend Architecture

### TIMER-UI-001: Real-Time Progress Timer Component

**Purpose**: Display progress, phase information, and quota/time status in real-time.

**Component Structure**:

```javascript
/**
 * ProgressTimer Component
 *
 * Displays:
 * - Current phase (structure, chapters X-Y, assembling, exporting)
 * - Real-time elapsed time
 * - Quota status (if deferring)
 * - Time remaining / deadline countdown
 * - Cancel button
 */
export default function ProgressTimer({ jobId, onCancel }) {
  const [phase, setPhase] = useState("initializing");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [quotaStatus, setQuotaStatus] = useState(null);
  const [timeStatus, setTimeStatus] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Connect to SSE or WebSocket for status updates
    const eventSource = new EventSource(`/api/ebook/generate/${jobId}/events`);

    eventSource.onmessage = (event) => {
      const update = JSON.parse(event.data);

      switch (update.type) {
        case "phase-update":
          setPhase(update.phase);
          setProgress(update.progress);
          break;

        case "quota-deferral":
          setQuotaStatus({
            waitMs: update.waitMs,
            message: update.message,
            percentUsed: update.percentUsed,
          });
          break;

        case "time-status":
          setTimeStatus({
            percentUsed: update.percentUsed,
            remainingMs: update.remainingMs,
            message: update.message,
          });
          break;

        case "complete":
          setPhase("complete");
          setProgress(100);
          eventSource.close();
          break;

        case "error":
          setPhase("error");
          eventSource.close();
          break;
      }
    };

    // Timer for elapsed time display
    const timerInterval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(timerInterval);
      eventSource.close();
    };
  }, [jobId]);

  // Quota wait countdown
  const quotaWaitCountdown = quotaStatus
    ? Math.max(0, Math.ceil(quotaStatus.waitMs / 1000))
    : 0;

  return (
    <div className="progress-timer">
      {/* [TIMER-UI-002] Phase Display */}
      <div className="phase-display">
        <h2>{getPhaseName(phase)}</h2>
        <p>{getPhaseDescription(phase)}</p>
      </div>

      {/* [TIMER-UI-003] Progress Bar */}
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progress}%` }}></div>
        <span className="progress-text">{progress}%</span>
      </div>

      {/* [TIMER-UI-004] Timer Display */}
      <div className="timer-display">
        <div className="elapsed">
          ⏱️ Elapsed: <strong>{formatSeconds(elapsedSeconds)}</strong>
        </div>

        {timeStatus && timeStatus.percentUsed < 100 && (
          <div className="remaining">
            ⏳ Remaining:{" "}
            <strong>{formatSeconds(timeStatus.remainingMs / 1000)}</strong>
          </div>
        )}

        {timeStatus && timeStatus.percentUsed >= 100 && (
          <div className="exceeded">⚠️ {timeStatus.message}</div>
        )}
      </div>

      {/* [TIMER-UI-005] Quota Deferral Display */}
      {quotaStatus && (
        <div className="quota-status quota-deferral">
          <div className="quota-message">⏸️ {quotaStatus.message}</div>
          <div className="quota-countdown">
            <strong>Waiting: {quotaWaitCountdown}s</strong>
            <div className="quota-bar">
              <div
                className="quota-fill"
                style={{
                  width: `${Math.min(
                    100,
                    (quotaStatus.waitMs / 60000) * 100
                  )}%`,
                }}
              ></div>
            </div>
          </div>
        </div>
      )}

      {/* [TIMER-UI-006] Cancel Button */}
      <div className="controls">
        <button
          className="cancel-btn"
          onClick={onCancel}
          disabled={phase === "complete" || phase === "error"}
        >
          Cancel Generation
        </button>
      </div>

      {/* [TIMER-UI-007] Status Messages */}
      {phase === "error" && (
        <div className="error-message">
          ❌ Generation failed. Please try again.
        </div>
      )}

      {phase === "complete" && (
        <div className="success-message">
          ✅ Ebook ready! Preparing download...
        </div>
      )}
    </div>
  );
}

// Helper functions
function getPhaseName(phase) {
  const names = {
    initializing: "Initializing",
    structure: "Generating Structure",
    chapters: "Generating Chapters",
    assembling: "Assembling Ebook",
    exporting: "Exporting to PDF",
    complete: "Complete!",
    error: "Error",
  };
  return names[phase] || phase;
}

function getPhaseDescription(phase) {
  const desc = {
    structure: "Creating outline and chapter titles...",
    chapters: "Generating chapter content...",
    assembling: "Combining all content...",
    exporting: "Rendering to PDF...",
    complete: "Your ebook is ready!",
  };
  return desc[phase] || "";
}

function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}
```

---

### TIMER-STATE-001: Frontend State Management

**Purpose**: Manage real-time state updates from backend without coupling to backend implementation details.

**State Shape**:

```javascript
const initialState = {
  // Job Metadata
  jobId: null,
  startedAt: null,
  deadline: null,

  // Current Phase
  phase: "initializing", // initializing → structure → chapters → assembling → exporting → complete
  progress: 0, // 0-100
  progressDetail: {
    currentChapter: 0,
    totalChapters: 0,
  },

  // Time Tracking
  elapsedMs: 0,
  timeStatus: {
    percentUsed: 0,
    remainingMs: 0,
    isExceeded: false,
  },

  // Quota Tracking
  quotaStatus: {
    callsInWindow: 0,
    quotaLimit: 20,
    percentUsed: 0,
    isExhausted: false,
  },

  // Deferral State
  deferralActive: false,
  deferralCountdown: 0, // ms remaining

  // User Interaction
  isCancelled: false,

  // Result
  result: null,
  error: null,
};
```

**Event Processing**:

```javascript
function processBackendEvent(event, state) {
  switch (event.type) {
    case "phase-update":
      return {
        ...state,
        phase: event.phase,
        progress: event.progress,
        progressDetail: event.progressDetail,
      };

    case "quota-deferral":
      return {
        ...state,
        deferralActive: true,
        deferralCountdown: event.waitMs,
        quotaStatus: {
          callsInWindow: event.callsInWindow,
          quotaLimit: event.quotaLimit,
          percentUsed: event.percentUsed,
          isExhausted: true,
        },
      };

    case "quota-reset":
      return {
        ...state,
        deferralActive: false,
        quotaStatus: {
          ...state.quotaStatus,
          isExhausted: false,
        },
      };

    case "time-status":
      return {
        ...state,
        timeStatus: {
          percentUsed: event.percentUsed,
          remainingMs: event.remainingMs,
          isExceeded: event.isExceeded,
        },
      };

    case "complete":
      return {
        ...state,
        phase: "complete",
        progress: 100,
        result: event.result,
      };

    case "error":
      return {
        ...state,
        phase: "error",
        error: event.error,
      };

    default:
      return state;
  }
}
```

---

### TIMER-FEEDBACK-001: User Feedback Mechanisms

**Purpose**: Provide clear, non-technical feedback about what's happening and why.

**Feedback Types**:

| Event                 | User Message                                     | Icon | Tone           |
| --------------------- | ------------------------------------------------ | ---- | -------------- |
| Structure phase       | "Creating outline..."                            | 📋   | Informative    |
| Chapters phase        | "Generating chapters..."                         | 📖   | Informative    |
| Quota wait            | "Quota limit reached. Waiting 45s for reset..."  | ⏸️   | Patient/Honest |
| Time tight (80-100%)  | "Time budget almost used. Continuing..."         | ⚠️   | Warning        |
| Time exceeded (>100%) | "Your time limit passed, but we're finishing..." | ⏳   | Reassuring     |
| Assembly phase        | "Putting it all together..."                     | 🔧   | Informative    |
| Export phase          | "Creating PDF..."                                | 📄   | Informative    |
| Success               | "All done! Your ebook is ready!"                 | ✅   | Celebratory    |
| Error (retriable)     | "Retrying... (Attempt 2/3)"                      | 🔄   | Hopeful        |
| Error (fatal)         | "Something went wrong. Please try again."        | ❌   | Apologetic     |

**CSS Classes for Styling**:

```css
/* Phase indicators */
.phase-display {
  /* ... */
}
.phase-display.structure {
  border-left: 4px solid #4caf50;
}
.phase-display.chapters {
  border-left: 4px solid #2196f3;
}
.phase-display.assembling {
  border-left: 4px solid #ff9800;
}
.phase-display.exporting {
  border-left: 4px solid #9c27b0;
}

/* Progress bar */
.progress-bar {
  /* ... */
}
.progress-fill {
  background: linear-gradient(90deg, #4caf50, #2196f3);
}

/* Quota deferral - prominent but not alarming */
.quota-status.quota-deferral {
  background-color: #fff3e0;
  border: 1px solid #ffb74d;
  border-radius: 4px;
  padding: 12px;
  margin: 12px 0;
}

/* Time exceeded - warning but proceeding */
.timer-display.time-exceeded {
  color: #f57c00;
  font-weight: bold;
}

/* Error states */
.error-message {
  color: #d32f2f;
}
.success-message {
  color: #388e3c;
}
```

---

## Integration Points

### SEQ-INTEGRATION-001: Backend-Frontend WebSocket/SSE Events

**Purpose**: Real-time bi-directional communication between CallManager (backend) and ProgressTimer (frontend).

**Event Channel Options**:

**Option A: Server-Sent Events (SSE)** - Simpler, one-way (backend → frontend)

```javascript
// Backend: Express endpoint
app.get("/api/ebook/generate/:jobId/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const jobId = req.params.jobId;

  // Get or create event emitter for this job
  const emitter = getJobEmitter(jobId);

  const sendEvent = (type, data) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial status
  const job = getJob(jobId);
  sendEvent("job-status", {
    jobId,
    phase: job.phase,
    progress: job.progress,
  });

  // Listen for CallManager events
  emitter.on("phase-update", (phase, progress) => {
    sendEvent("phase-update", { phase, progress });
  });

  emitter.on("quota-deferral", (status) => {
    sendEvent("quota-deferral", status);
  });

  emitter.on("time-status", (status) => {
    sendEvent("time-status", status);
  });

  emitter.on("complete", (result) => {
    sendEvent("complete", { result });
    res.end();
  });

  emitter.on("error", (error) => {
    sendEvent("error", { error: error.message });
    res.end();
  });

  // Cleanup on disconnect
  req.on("close", () => {
    emitter.removeAllListeners();
  });
});

// Frontend: EventSource listener
const eventSource = new EventSource(`/api/ebook/generate/${jobId}/events`);

eventSource.addEventListener("phase-update", (event) => {
  const data = JSON.parse(event.data);
  dispatch({ type: "PHASE_UPDATE", payload: data });
});

eventSource.addEventListener("quota-deferral", (event) => {
  const data = JSON.parse(event.data);
  dispatch({ type: "QUOTA_DEFERRAL", payload: data });
});
```

**Option B: WebSocket** - Bidirectional (supports frontend → backend cancel requests)

```javascript
// Backend: WebSocket handler
io.on("connection", (socket) => {
  socket.on("subscribe-job", (jobId) => {
    socket.join(`job-${jobId}`);
    const job = getJob(jobId);
    socket.emit("job-status", job.getStatus());
  });

  socket.on("cancel-job", (jobId) => {
    cancelJob(jobId);
    io.to(`job-${jobId}`).emit("job-cancelled");
  });

  socket.on("disconnect", () => {
    // Cleanup
  });
});

// CallManager emits via Socket.io
emitJobEvent(jobId, "phase-update", { phase, progress });
emitJobEvent(jobId, "quota-deferral", { waitMs, message });
emitJobEvent(jobId, "complete", { result });

// Frontend: Connect and listen
socket.on("connect", () => {
  socket.emit("subscribe-job", jobId);
});

socket.on("phase-update", (data) => {
  dispatch({ type: "PHASE_UPDATE", payload: data });
});

socket.on("cancel-job", () => {
  setPhase("cancelled");
});
```

**Recommendation**: Use **SSE** for initial implementation (simpler, sufficient for one-way backend-to-frontend flow). Upgrade to WebSocket if cancel functionality needed.

---

### SEQ-INTEGRATION-002: ebookService Integration

**Purpose**: Integrate CallManager into ebookService for sequential chapter generation.

**Modified Flow**:

```javascript
// Before: Direct aiService calls, no quota management
// async generateEbook(pageCount) {
//   const structure = await aiService.generateContent(structurePrompt, 0);
//   for (let i = 1; i <= pageCount; i++) {
//     const chapter = await aiService.generateContent(chapterPrompt(i), i);
//   }
// }

// After: CallManager-mediated calls with progress tracking
class EbookService {
  constructor(options = {}) {
    this.aiService = options.aiService;
  }

  async generateEbook(pageCount, options = {}) {
    // [SEQ-INTEGRATION-002-A] Create CallManager for this request
    const deadline = options.deadline || this.calculateDeadline(pageCount);

    const callManager = new CallManager({
      deadline,
      startTime: Date.now(),
      aiService: this.aiService,

      // [SEQ-INTEGRATION-002-B] Progress callbacks
      onStatusChange: (status) => {
        this.emitProgress({
          ...status,
          phase: this.getCurrentPhase(status.callIndex),
          progress: this.calculateProgress(status),
        });
      },

      // [SEQ-INTEGRATION-002-C] Deferral callbacks
      onDeferral: (info) => {
        this.emitProgress({
          type: "deferral",
          ...info,
        });
      },
    });

    try {
      // [SEQ-INTEGRATION-002-D] Generate structure (call index 0 = Pro model)
      this.emitProgress({ phase: "structure", progress: 0 });

      const structurePrompt = `Create an outline for a ${pageCount}-page ebook about: ${options.topic}`;
      const structure = await callManager.executeCall(
        (model) => this.aiService.generateContent(structurePrompt, model),
        0,
        "structure"
      );

      // [SEQ-INTEGRATION-002-E] Generate chapters (call indices 1+ = Flash model)
      const chapters = [];
      for (let i = 1; i <= pageCount; i++) {
        this.emitProgress({
          phase: "chapters",
          progress: Math.round((i / pageCount) * 100),
          progressDetail: { currentChapter: i, totalChapters: pageCount },
        });

        const chapterPrompt = `For chapter ${i} of the "${
          structure.title
        }" outline: ${structure.chapters[i - 1]}`;
        const chapter = await callManager.executeCall(
          (model) => this.aiService.generateContent(chapterPrompt, model),
          i,
          `chapter-${i}`
        );

        chapters.push(chapter);
      }

      // [SEQ-INTEGRATION-002-F] Emit completion
      this.emitProgress({ phase: "complete", progress: 100 });

      return {
        structure,
        chapters,
        metadata: {
          pageCount,
          generatedAt: new Date(),
          quotaMetrics: callManager.getQuotaStatus(),
          timeMetrics: callManager.getTimeStatus(),
        },
      };
    } catch (error) {
      // [SEQ-INTEGRATION-002-G] Enhanced error handling
      this.emitProgress({
        type: "error",
        error: error.message,
        context: {
          callIndex: error.callIndex,
          callType: error.callType,
          quotaStatus: error.quotaStatus,
          timeStatus: error.timeStatus,
        },
      });
      throw error;
    }
  }

  // Helper methods
  calculateDeadline(pageCount) {
    // 3s per page + 60s per quota reset + 30s buffer
    const baselineMs = pageCount * 3000;
    const quotaResets = Math.floor(pageCount / 20);
    const quotaWaitMs = quotaResets * 60000;
    const bufferMs = 30000;
    return Date.now() + baselineMs + quotaWaitMs + bufferMs;
  }

  getCurrentPhase(callIndex) {
    if (callIndex === 0) return "structure";
    return "chapters";
  }

  calculateProgress(status) {
    if (status.type === "quota-deferral") return this.lastProgress || 50;
    return Math.min(95, (status.callIndex / (this.lastPageCount + 1)) * 100);
  }

  emitProgress(update) {
    this.lastProgress = update.progress || this.lastProgress;
    // Emit via JobQueue to frontend
    this.jobQueue.broadcastUpdate(this.currentJobId, update);
  }
}
```

---

### SEQ-INTEGRATION-003: Job Queue Integration

**Purpose**: Track deadline and CallManager metrics in job metadata.

**Job Metadata Enhancement**:

```javascript
// In jobQueueManager.js
const jobMetadata = {
  id: uuid(),
  pageCount,
  topic: options.topic,
  requestedAt: Date.now(),

  // [SEQ-INTEGRATION-003-A] Deadline tracking
  deadline: calculateDeadline(pageCount),
  estimatedCompletion: calculateDeadline(pageCount),

  // [SEQ-INTEGRATION-003-B] Status tracking
  status: "processing",
  phase: "initializing",
  progress: 0,
  progressDetail: { currentChapter: 0, totalChapters: pageCount },

  // [SEQ-INTEGRATION-003-C] Infrastructure metrics
  quotaStatus: null,
  timeStatus: null,
  deferralCount: 0,

  // [SEQ-INTEGRATION-003-D] Result
  result: null,
  completedAt: null,
  error: null,
};

// During processing
ebookService.on("progress", (update) => {
  jobMetadata.phase = update.phase;
  jobMetadata.progress = update.progress;
  jobMetadata.progressDetail =
    update.progressDetail || jobMetadata.progressDetail;

  if (update.type === "quota-deferral") {
    jobMetadata.deferralCount++;
    jobMetadata.quotaStatus = {
      callsInWindow: update.callsInWindow,
      quotaLimit: update.quotaLimit,
      percentUsed: update.percentUsed,
      waitMs: update.waitMs,
    };
  }

  if (update.type === "time-status") {
    jobMetadata.timeStatus = {
      percentUsed: update.percentUsed,
      remainingMs: update.remainingMs,
      isExceeded: update.isExceeded,
    };
  }

  // Broadcast to frontend
  io.to(`job-${jobMetadata.id}`).emit("status-update", {
    type: update.type,
    ...update,
    progress: jobMetadata.progress,
    phase: jobMetadata.phase,
  });
});
```

---

## Event Flow & Timing

**Timeline for 10-page ebook**:

```
T=0:00s
│ User submits request for 10-page ebook
│ ├─ Frontend: ProgressTimer component mounts
│ ├─ Backend: Job created, ebookService.generateEbook() started
│ └─ CallManager created with deadline = T+130s (baseline 30s + quota wait 60s + buffer 30s + 10s)

T=0:05s
│ Structure call succeeds (1/20 quota)
│ ├─ Backend: emitProgress({ phase: 'structure', progress: 10 })
│ └─ Frontend: "Creating outline..." (progress bar 10%)

T=0:08s
│ Chapter 1 call succeeds (2/20 quota)
│ ├─ Backend: emitProgress({ phase: 'chapters', progress: 20, currentChapter: 1 })
│ └─ Frontend: "Generating chapters... (1/10)" (progress bar 20%)

T=0:12s
│ Chapters 2-9 generated sequentially
│ ├─ Each takes ~2-3s
│ └─ Progress bar climbs: 30%, 40%, 50%, 60%, 70%, 80%, 90%

T=0:38s
│ Quota check before chapter 10
│ ├─ callsInWindow = 20 (structure + 9 chapters + all rotations)
│ ├─ quotaLimit = 20
│ ├─ QUOTA EXHAUSTED
│ ├─ Calculate wait time: 60s - 38s = 22s remaining in window
│ └─ Begin deferral

T=0:38s → T=1:00s (22 seconds)
│ Deferral countdown active
│ ├─ Backend: emitProgress({ type: 'quota-deferral', waitMs: 22000, message: '...' })
│ ├─ Frontend: Quota timer display shows "⏸️ Waiting 22s for reset..."
│ ├─ Countdown: 22s → 21s → 20s → ... → 1s
│ └─ User sees timer ticking down, understands what's happening

T=1:00s
│ Quota window reset triggered
│ ├─ CallManager: Clear call history, reset window counter
│ ├─ Chapter 10 call retries
│ └─ Chapter 10 succeeds (1/20 in new window)

T=1:03s
│ All chapters complete
│ ├─ Backend: emitProgress({ phase: 'assembling', progress: 95 })
│ └─ Frontend: "Putting it all together..." (progress bar 95%)

T=1:05s
│ Assembly complete, export starts
│ ├─ Backend: emitProgress({ phase: 'exporting', progress: 98 })
│ └─ Frontend: "Creating PDF..." (progress bar 98%)

T=1:08s
│ Export complete
│ ├─ Backend: emitProgress({ type: 'complete', result: { ... } })
│ ├─ Frontend: "All done! Your ebook is ready!" (progress bar 100%)
│ └─ User can download full 10-chapter ebook (no stubs)

TOTAL TIME: ~68 seconds
- Baseline processing: ~38 seconds
- Quota deferral: ~22 seconds
- Assembly/export: ~8 seconds
```

---

## Error Handling & Edge Cases

### SEQ-ERROR-CASE-001: Quota Exhausted During Last Chapter

```
Scenario: 20-page ebook, chapter 20 hits quota limit

T=0:50s: Chapter 19 succeeds (20/20 quota)
T=0:53s: Chapter 20 requested, quota exhausted
│ ├─ Calculate wait: 60s - 50s = 10s until reset
│ ├─ Wait visible to user: "Waiting 10s for quota reset..."
│ └─ Retry chapter 20 after reset
T=1:03s: Chapter 20 succeeds in new window
T=1:06s: Complete

Expected behavior: User sees quota wait, chapter 20 generated, ebook complete
✅ No stubs, no fallback
```

### SEQ-ERROR-CASE-002: Network Error During Chapter Generation

```
Scenario: Transient network error on chapter 5

T=0:20s: Chapter 5 call throws ECONNRESET (retriable)
│ ├─ isRetriableError() returns true
│ ├─ Emit onDeferral event
│ ├─ Wait 2 seconds (backoff)
│ └─ Retry chapter 5
T=0:22s: Chapter 5 succeeds on retry

Expected behavior: Automatic retry, user sees brief stall, continues
✅ No user action needed
```

### SEQ-ERROR-CASE-003: Invalid API Key (Fatal Error)

```
Scenario: API key expired/invalid

T=0:00s: Structure call throws 401 AUTHENTICATION_FAILED
│ ├─ isRetriableError() returns false
│ ├─ enhanceError() adds context
│ └─ Throw enhanced error (no retry)
T=0:00s: ebookService catches error, emits error event
│ └─ Frontend shows: "Something went wrong. API authentication error."

Expected behavior: Fail immediately with clear error
❌ User must reconfigure API key
```

### SEQ-ERROR-CASE-004: Time Deadline Exceeded During Call

```
Scenario: 20-page ebook, deadline at T+90s, call completes at T+95s

T=0:88s: 98% time budget used, emit 'time-tight' warning
│ └─ Frontend: "⚠️ Time budget 98% used (2s remaining)"
T=0:90s: Deadline exceeded, emit 'time-exceeded' warning
│ └─ Frontend: "⏳ Your time limit passed, but we're finishing..."
T=0:95s: Final chapter completes
│ └─ Return result anyway (user was waiting, already accepted)

Expected behavior: Warn but continue, deliver full ebook
✅ Quality prioritized over deadline enforcement
```

---

## Performance Characteristics

### Expected Timing by Page Count

```
Page Count │ Calls │ Quota Resets │ Baseline* │ With Deferral** │ Total Time
─────────────────────────────────────────────────────────────────────────
3          │ 4     │ 0            │ 10-12s    │ 0s              │ 10-12s
5          │ 6     │ 0            │ 15-18s    │ 0s              │ 15-18s
10         │ 11    │ 1            │ 30-35s    │ 22s (quota)     │ 52-57s
15         │ 16    │ 0            │ 45-50s    │ 0s              │ 45-50s
20         │ 21    │ 1            │ 60-70s    │ 10s (quota)     │ 70-80s
30         │ 31    │ 1            │ 90-105s   │ 5s (quota)      │ 95-110s
60         │ 61    │ 3            │ 180-210s  │ 120s (resets)   │ 300-330s
```

\*Baseline: Processing time without quota waits
\*\*With Deferral: Quota window reset wait times

**Notes**:

- Pro model (structure, callIndex=0): 3-5s per call
- Flash model (chapters, callIndex>0): 2-3s per call
- Deferral per reset: 60s window wait
- N-page ebook hits quota reset every ~18-20 pages (quotaLimit=20)
- 60-page ebook requires 3 quota resets (~180s additional wait)

---

## Testing Strategy

### Unit Tests: CallManager Isolation

```javascript
describe("[SEQ-CORE-001] CallManager", () => {
  describe("[SEQ-QUOTA-001] Quota Management", () => {
    test("tracks calls in current window", async () => {
      const cm = new CallManager({ quotaLimit: 5, quotaWindow: 1000 });

      for (let i = 0; i < 5; i++) {
        await cm.executeCall(() => Promise.resolve({}), i, "test");
      }

      expect(cm.getQuotaStatus().callsInWindow).toBe(5);
    });

    test("defers call when quota exhausted", async () => {
      const cm = new CallManager({ quotaLimit: 2, quotaWindow: 100 });
      let deferralFired = false;

      cm.config.onDeferral = () => {
        deferralFired = true;
      };

      // Fill quota
      await cm.executeCall(() => Promise.resolve({}), 0, "test");
      await cm.executeCall(() => Promise.resolve({}), 1, "test");

      // This should defer
      const start = Date.now();
      await cm.executeCall(() => Promise.resolve({}), 2, "test");
      const elapsed = Date.now() - start;

      expect(deferralFired).toBe(true);
      expect(elapsed).toBeGreaterThan(80); // Waited for reset
    });
  });

  describe("[SEQ-TIME-001] Time Budget", () => {
    test("warns when time budget tight (>80%)", async () => {
      const now = Date.now();
      const cm = new CallManager({
        deadline: now + 1000,
        startTime: now - 850, // 85% used
      });

      let statusFired = false;
      cm.config.onStatusChange = (status) => {
        if (status.type === "time-tight") statusFired = true;
      };

      await cm.executeCall(() => Promise.resolve({}), 0, "test");

      expect(statusFired).toBe(true);
    });
  });

  describe("[SEQ-ERROR-001] Error Classification", () => {
    test("classifies retriable vs fatal errors", () => {
      const cm = new CallManager();

      expect(cm.isRetriableError({ code: "QUOTA_EXHAUSTED" })).toBe(true);
      expect(cm.isRetriableError({ code: "429" })).toBe(true);
      expect(cm.isRetriableError({ code: "AUTHENTICATION_FAILED" })).toBe(
        false
      );
      expect(cm.isRetriableError({ code: "401" })).toBe(false);
    });

    test("enhances errors with context", () => {
      const cm = new CallManager();
      const error = new Error("API Error");
      const context = {
        callIndex: 5,
        callType: "chapter-5",
        model: "gemini-2.5-flash",
        quotaStatus: { percentUsed: 50 },
        timeStatus: { percentUsed: 30 },
      };

      const enhanced = cm.enhanceError(error, context);

      expect(enhanced.callIndex).toBe(5);
      expect(enhanced.quotaStatus.percentUsed).toBe(50);
    });
  });
});
```

### Integration Tests: ebookService with CallManager

```javascript
describe("[SEQ-INTEGRATION-002] ebookService with CallManager", () => {
  test("generates 10-page ebook with quota deferral visible", async () => {
    const service = new EbookService({ aiService: mockAiService });
    const events = [];

    service.on("progress", (event) => {
      events.push(event);
    });

    const result = await service.generateEbook(10, {
      deadline: Date.now() + 120000,
    });

    // Verify structure and chapters generated
    expect(result.structure).toBeDefined();
    expect(result.chapters).toHaveLength(10);

    // Verify events emitted (structure → chapters → quota-deferral → complete)
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("phase-update");
    expect(eventTypes).toContain("quota-deferral");
    expect(eventTypes).toContain("complete");

    // Verify deferral was necessary (11 calls > 10 quota)
    const deferralEvents = events.filter((e) => e.type === "quota-deferral");
    expect(deferralEvents.length).toBeGreaterThan(0);
  });
});
```

### E2E Tests: Full User Flow

```javascript
describe("[TIMER-UI-001] Real-Time Progress Timer", () => {
  test("displays progress timer during generation", async () => {
    // 1. User submits form
    const response = await submitEbookForm({
      topic: "AI Safety",
      pageCount: 10,
    });

    const jobId = response.jobId;

    // 2. Frontend connects to SSE event stream
    const eventSource = new EventSource(`/api/ebook/generate/${jobId}/events`);
    const events = [];

    eventSource.addEventListener("message", (e) => {
      events.push(JSON.parse(e.data));
    });

    // 3. Wait for completion
    await waitForEvent(eventSource, "complete", { timeout: 180000 });

    // 4. Verify event sequence
    expect(events[0].type).toBe("phase-update");
    expect(events[0].phase).toBe("structure");

    // Should have quota-deferral event for 10-page ebook
    const hasQuotaDeferral = events.some((e) => e.type === "quota-deferral");
    expect(hasQuotaDeferral).toBe(true);

    // Should end with complete
    expect(events[events.length - 1].type).toBe("complete");

    // 5. Verify ebook is complete (not stubs)
    const ebook = response.result;
    expect(ebook.chapters).toHaveLength(10);
    ebook.chapters.forEach((chapter, i) => {
      expect(chapter.content).toBeTruthy();
      expect(chapter.content.length).toBeGreaterThan(100); // Not a stub
    });
  });
});
```

---

## Migration Path

**Phase 1: Foundation** (Week 1)

- [ ] Implement CallManager class
- [ ] Add quota/time tracking
- [ ] Add error classification
- [ ] Unit tests for CallManager

**Phase 2: Backend Integration** (Week 1-2)

- [ ] Modify ebookService to use CallManager
- [ ] Add event emitters (onStatusChange, onDeferral)
- [ ] Update jobQueueManager for deadline tracking
- [ ] Integration tests

**Phase 3: Frontend** (Week 2)

- [ ] Create ProgressTimer component
- [ ] Implement SSE event listener
- [ ] Add timer UI and styling
- [ ] State management for real-time updates

**Phase 4: Testing & QA** (Week 2-3)

- [ ] E2E tests for full user flow
- [ ] Performance testing (timing validation)
- [ ] Error scenario testing
- [ ] Browser compatibility

**Phase 5: Deployment** (Week 3)

- [ ] Deploy on `feat/patience-timer-sequential` branch
- [ ] User acceptance testing
- [ ] Merge to main with feature flag initially disabled
- [ ] Enable for beta users
- [ ] Full rollout

---

## Summary

**PATIENCE_TIMER_BLUEPRINT** provides:

✅ **Sequential CallManager**: Orchestrates sequential calls with transparent quota/time management  
✅ **Real-Time Timer UI**: Users see exactly what's happening, quota waits included  
✅ **No Stubs Guarantee**: Deferral and retry ensure full-quality content  
✅ **Infrastructure Visibility**: Users understand API constraints, not perceive bugs  
✅ **Foundation for Batch**: Sequential approach readies system for batch queries later

---

## Performance Roadmap: Sequential → Batch

### Phase 1: Sequential Implementation (This Project - Stages 1-5)

**Model:** 1 structure call + N chapter calls (sequential, one at a time)  
**Time Characteristics:**

- 10-page ebook: ~55 seconds (minimal quota waits)
- 20-page ebook: ~2-3 minutes (1 quota reset window)
- 60-page ebook: ~3-4 minutes (3 quota reset windows)
- Guarantee: Zero data loss, all chapters complete

**User Experience:**

- Real-time timer showing exact progress
- Transparency during quota waits ("Waiting for API quota reset...")
- Patient, honest UX

### Phase 2: Batch Implementation (Future - Separate Epic)

**Model:** Multiple calls per batch (5-10 calls/batch based on quota window)  
**Key Insight:** Once batch queries implemented, same content takes significantly less time

**Time Characteristics After Batch:**

- 10-page ebook: ~15-20 seconds (single batch, minimal wait)
- 20-page ebook: ~40-50 seconds (2 batches max, one quota reset)
- **60-page ebook: ~1-1.5 minutes (6-8 batches, 2 quota resets vs 3 sequential)**

**Performance Improvement:**

```
Sequential (Phase 1):    60-page → 3-4 minutes
Batch (Phase 2):        60-page → 1-1.5 minutes
Improvement:            ~60-70% faster (2.5-3x speedup)
```

**Migration Path:**

1. Sequential foundation complete (robust, tested, transparent)
2. Batch implementation layer added (CallManager extended to support batch groups)
3. Frontend timer updates (shows batch progress instead of per-chapter)
4. Zero breaking changes to existing API/UX

### Why Sequential First?

- **Honest foundation:** Sequential is real quota behavior, batch is optimization
- **Testability:** Sequential easier to debug, validate, understand
- **User trust:** Don't promise batch performance, deliver sequential, then delight with batch
- **Risk management:** Sequential works with free tier, batch may need config changes
- **Code clarity:** Sequential CallManager logic clear, batch adds complexity on top

**Bottom Line:** Sequential Phase 1 delivers 100% functional ebook generation with patient transparency. Batch Phase 2 optimizes performance without changing user-visible behavior - just makes timer run faster.

---

**Key Differences from Current System**:

| Aspect           | Current                  | PATIENCE_TIMER                     |
| ---------------- | ------------------------ | ---------------------------------- |
| Quota exhaustion | Silent fallback to stubs | Defer, wait, retry transparently   |
| User visibility  | No indication of wait    | Real-time timer showing quota wait |
| Content quality  | 8/10 chapters + 2 stubs  | 10/10 full chapters                |
| Time per 10-page | ~30s (incomplete)        | ~55s (complete)                    |
| User experience  | Confusion/disappointment | Patience/understanding             |

**Next Document**: PATIENCE_TIMER_BUILD (Implementation Guide) with step-by-step code changes and branch management procedures.
