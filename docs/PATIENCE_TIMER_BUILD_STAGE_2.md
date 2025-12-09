# PATIENCE_TIMER_BUILD_STAGE_2.md

## Stage 2: ebookService Integration with CallManager

**Objective:** Wrap sequential Gemini API calls to `ebookService.handle()` with CallManager quota/time orchestration  
**Estimated Effort:** 2-3 hours  
**Time Horizon:** Week 2  
**Branch:** `feat/patience-timer-sequential` (continue from Stage 1)  
**Parent Documents:** PATIENCE_TIMER_BLUEPRINT.md, PATIENCE_TIMER_BUILD_STAGE_1.md

---

## Part A: Architecture & Design Decisions

### A.1: CallManager Integration Points

**Location: `/workspaces/Aether/server/ebookService.js`**

The `ebookService.handle()` function is the entry point for ebook generation:

```javascript
async function handle(payload, classification) {
  // payload.prompt - user's request
  // payload.metadata - { pageCount, theme, colorPalette, fontSizeScale, ... }
  // Returns: { pages, metadata, html, actions }
}
```

**Current Flow (Sequential Without CallManager):**

1. Validate prompt and pageCount
2. Create aiService (mock or real via `createAIService()`)
3. For each chapter: call `aiService.generateContent(chapterPrompt)`
4. If ANY call fails → stub fallback (violates requirement [REQ-CORE-003])

**Target Flow (With CallManager):**

1. Validate prompt and pageCount
2. **Create CallManager instance** - deadline = deadline from request, quota = 20 calls/min
3. Generate structure call (title, overview) wrapped in CallManager
4. For each chapter: call wrapped in CallManager
5. If quota exhausted → transparent defer (user sees timer)
6. If time exceeded → continue with warnings (soft enforcement)
7. If fatal error → fail with diagnostic context (no stubs)

### A.2: Design Decisions

#### Decision: Where to Create CallManager

**Option A:** Inside ebookService.handle() - localized to ebook generation  
**Option B:** In ebookService caller (genieService.process/compose) - broader orchestration  
**CHOSEN:** Option A (localized) because:

- ebook generation is the primary bottleneck (N+1 API calls)
- Deadline can be passed from request payload
- Isolates quota concerns to generation phase
- Easier to test and reason about

#### Decision: Structure Call Handling

**Current Practice:** All content generation through AI service  
**Proposed:** 1 structure call (title/overview) + N chapter calls = N+1 API quota consumption  
**Rationale:** Matches Gemini free tier quota model (20 calls/min, 60s rolling window)

#### Decision: Deferral UX

**Option A:** Fail with 429 error (current)  
**Option B:** Queue deferred calls, process after window reset (this stage)  
**Option C:** Complex retry logic with exponential backoff  
**CHOSEN:** Option B (matches BLUEPRINT Stage 2 spec)

#### Decision: Error Handling

**Current:** Stub pages on any error  
**Proposed:** Only stub on retriable errors, fail immediately on fatal errors  
**Retriable:** QUOTA_EXHAUSTED, RATE_LIMIT_EXCEEDED, SERVICE_UNAVAILABLE, 429  
**Fatal:** AUTHENTICATION_FAILED, INVALID_API_KEY, 401, 400 (invalid prompt)

---

## Part B: Implementation Roadmap

### B.1: Task Breakdown

| #         | Task                                                  | Est. Time  | Completion Criterion                                           |
| --------- | ----------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| 1         | Wrap structure call with CallManager                  | 30 min     | Structure call returns 1 page with title/overview              |
| 2         | Wrap chapter calls in loop with CallManager           | 45 min     | All chapters complete without quota errors                     |
| 3         | Implement deferral UI communication                   | 30 min     | Frontend receives quota-wait events via SSE/callback           |
| 4         | Modify error handling to use enhanceError()           | 30 min     | Error messages include callIndex, model, quotaStatus           |
| 5         | Create integration tests (CallManager + ebookService) | 45 min     | All tests passing: happy path, quota exhaustion, time boundary |
| 6         | Update genieService.process() to use new flow         | 30 min     | Process method benefits from CallManager orchestration         |
| 7         | Documentation + review                                | 15 min     | PATIENCE_TIMER_BUILD_STAGE_2_FINAL.md + PR review ready        |
| **TOTAL** |                                                       | **3h 45m** | Full Stage 2 completion                                        |

---

## Part C: Detailed Implementation Steps

### Step 1: Add CallManager Import & Configuration to ebookService

**File:** `/workspaces/Aether/server/ebookService.js`  
**Location:** Top of file, after existing imports

```javascript
// Add after existing imports:
const CallManager = require("./CallManager");

/**
 * Initialize CallManager for quota-aware API orchestration
 * Called within handle() to wrap all AI service calls
 *
 * @param {number} deadline - Absolute timestamp when generation must complete
 * @param {Object} options - Configuration (callbacks for frontend progress)
 * @returns {CallManager} Initialized manager for this generation session
 */
function createCallManager(deadline, options = {}) {
  return new CallManager({
    deadline: deadline || Date.now() + 600000, // 10min default
    quotaLimit: 20, // Gemini free tier
    quotaWindow: 60000, // 1 minute
    onStatusChange: options.onStatusChange || (() => {}),
    onDeferral: options.onDeferral || (() => {}),
  });
}
```

### Step 2: Modify handle() to Create CallManager

**File:** `/workspaces/Aether/server/ebookService.js`  
**Location:** Inside `handle()` function, after input validation

```javascript
async function handle(payload, classification) {
  const { prompt } = payload;
  const {
    theme = "dark",
    pageCount = 8,
    colorPalette = "standard",
    fontSizeScale = 1.0,
    deadline = Date.now() + 600000, // Accept deadline from request
    onStatusChange = null, // For frontend progress callbacks
    onDeferral = null, // For quota deferral UX
  } = payload.metadata || {};

  // Input validation (unchanged)
  if (!prompt || !String(prompt).trim()) {
    const e = new Error("ebookService: prompt is required");
    e.status = 400;
    throw e;
  }

  if (typeof pageCount !== "number" || pageCount < 3 || pageCount > 20) {
    const e = new Error("ebookService: pageCount must be between 3 and 20");
    e.status = 400;
    throw e;
  }

  // ✅ NEW: Create CallManager for this generation session
  const callManager = createCallManager(deadline, {
    onStatusChange,
    onDeferral,
  });

  // Create AI service (unchanged)
  let aiSvc;
  try {
    const { createAIService } = require("./aiService");
    aiSvc = createAIService();
  } catch (err) {
    // Fallback to mock (unchanged)
    aiSvc = {
      /* ... */
    };
  }

  // ... rest of function continues below (see Step 3)
}
```

### Step 3: Wrap Structure Call with CallManager

**File:** `/workspaces/Aether/server/ebookService.js`  
**Location:** Before chapter loop (replace existing content generation logic)

```javascript
// ✅ NEW: Generate structure (title + overview) wrapped in CallManager
let structure = { title: prompt.slice(0, 50), chapters: [] };

try {
  const structureResult = await callManager.executeCall(
    async () => {
      // Call 0: Generate structure
      const result = await aiSvc.generateContent(
        `Create a book structure for: ${prompt}. Return JSON: { title, overview, chapterTitles: [...] }`
      );
      // Parse structure from result
      return {
        title: result?.content?.title || prompt.slice(0, 50),
        overview: result?.content?.body || "Book content",
      };
    },
    0, // callIndex: structure is call #0
    "structure" // callType for diagnostics
  );

  structure = structureResult;
  console.log(`[ebookService] Structure generated: "${structure.title}"`);
} catch (error) {
  // ✅ NEW: Use CallManager's error enhancement
  const enhanced = callManager.enhanceError(error, {
    callIndex: 0,
    callType: "structure",
    model: "gemini-2.5-flash",
    quotaStatus: callManager.getQuotaStatus(),
    timeStatus: callManager.getTimeStatus(),
  });

  // Classification: fatal vs retriable
  if (callManager.isRetriableError(enhanced)) {
    console.warn(
      "[ebookService] Retriable error on structure call:",
      enhanced.message
    );
    // Continue with stub structure
  } else {
    console.error("[ebookService] Fatal error on structure call:", enhanced);
    throw enhanced;
  }
}
```

### Step 4: Wrap Chapter Calls in Loop with CallManager

**File:** `/workspaces/Aether/server/ebookService.js`  
**Location:** Replace chapter generation loop

```javascript
// ✅ NEW: Generate chapters wrapped in CallManager loop
const chapters = [];
const chapterPrompts = [];

// Generate chapter prompts first (no API calls)
for (let i = 0; i < pageCount; i++) {
  const chapterNum = i + 1;
  chapterPrompts.push(
    `Write chapter ${chapterNum} for book "${structure.title}". Focus on: ${prompt}. Keep concise.`
  );
}

// Now execute all chapter calls through CallManager
for (let i = 0; i < chapterPrompts.length; i++) {
  const callIndex = i + 1; // Calls 1 through N (0 was structure)
  const chapterNum = i + 1;

  try {
    const chapterResult = await callManager.executeCall(
      async () => {
        const result = await aiSvc.generateContent(chapterPrompts[i]);
        return {
          id: `ch-${chapterNum}`,
          title: `Chapter ${chapterNum}`,
          content: result?.content?.body || "",
        };
      },
      callIndex,
      `chapter-${chapterNum}`
    );

    chapters.push(chapterResult);

    // Emit progress after each successful chapter
    const status = callManager.getStatus();
    if (onStatusChange) {
      onStatusChange({
        event: "chapter-complete",
        chapterNum,
        totalChapters: pageCount,
        status,
      });
    }

    console.log(`[ebookService] Chapter ${chapterNum} generated`);
  } catch (error) {
    // ✅ NEW: Use CallManager's error enhancement for all chapters
    const enhanced = callManager.enhanceError(error, {
      callIndex,
      callType: `chapter-${chapterNum}`,
      model: "gemini-2.5-flash",
      quotaStatus: callManager.getQuotaStatus(),
      timeStatus: callManager.getTimeStatus(),
    });

    if (callManager.isRetriableError(enhanced)) {
      console.warn(
        `[ebookService] Retriable error on chapter ${chapterNum}:`,
        enhanced.message
      );
      // Skip this chapter (don't stub - data loss is better than fake data)
      continue;
    } else {
      console.error(
        `[ebookService] Fatal error on chapter ${chapterNum}:`,
        enhanced
      );
      // Fatal error: fail the whole operation
      throw enhanced;
    }
  }
}

// Emit final status
const finalStatus = callManager.getStatus();
console.log(
  `[ebookService] Generation complete. Status:`,
  JSON.stringify(finalStatus, null, 2)
);
```

### Step 5: Update HTML Generation to Use Real Chapters

**File:** `/workspaces/Aether/server/ebookService.js`  
**Location:** Replace HTML generation logic

```javascript
// ✅ UPDATED: Use chapters from CallManager loop instead of stub pages
const pages = chapters.map((ch) => ({
  id: ch.id,
  title: ch.title,
  body: ch.content,
}));

const metadata = {
  model: "gemini-2.5-flash",
  pages: pages.length,
  quotaUsed: finalStatus.callMetrics.totalSucceeded,
  timeUsed: finalStatus.timeStatus.elapsedMs,
};

// Generate HTML with real content
const html = generateHTML(structure.title, chapters, {
  theme,
  colorPalette,
  fontSizeScale,
});

return {
  pages,
  metadata,
  html,
  actions: {
    persistPrompt: true,
    persistGeneration: true,
  },
};
```

---

## Part D: Error Handling Enhancement

### D.1: Update Error Classification in ebookService

**File:** `/workspaces/Aether/server/ebookService.js`  
**Location:** Add helper function

```javascript
/**
 * Determine if error from AI service should be retried or fail immediately
 * @param {Error} error - Error from aiService
 * @returns {boolean} true if retriable, false if fatal
 */
function isRetriableError(error) {
  const code = error?.code || error?.message || "";
  const retriableCodes = [
    "QUOTA_EXHAUSTED",
    "RATE_LIMIT_EXCEEDED",
    "SERVICE_UNAVAILABLE",
    "429",
    "503",
    "ETIMEDOUT",
  ];
  return retriableCodes.some((c) => code.includes(c));
}

/**
 * Enhance error with context for debugging
 * @param {Error} error - Original error
 * @param {Object} context - { callIndex, callType, model, quotaStatus, timeStatus }
 * @returns {Error} Enhanced error
 */
function enhanceError(error, context) {
  const enhanced = new Error(error.message);
  enhanced.original = error;
  enhanced.callIndex = context.callIndex;
  enhanced.callType = context.callType;
  enhanced.model = context.model;
  enhanced.quotaStatus = context.quotaStatus;
  enhanced.timeStatus = context.timeStatus;
  enhanced.code = error.code;
  return enhanced;
}
```

---

## Part E: Integration Testing

### E.1: Create Integration Test File

**File:** `/workspaces/Aether/server/__tests__/ebookService.integration.test.js`  
**Size:** ~300 lines

```javascript
import { vi } from "vitest";
const ebookService = require("../ebookService");
const CallManager = require("../CallManager");

describe("[STAGE-2] ebookService + CallManager Integration", () => {
  // Test 1: Happy path - structure + 3 chapters complete successfully
  test("generates ebook with CallManager orchestration", async () => {
    const mockAiService = {
      generateContent: vi.fn(async (prompt) => ({
        content: {
          title: "Test Chapter",
          body: `Generated content for: ${prompt}`,
        },
      })),
    };

    // Inject mock AI service
    ebookService._setAiService(mockAiService);

    const result = await ebookService.handle({
      prompt: "Write a short story about AI",
      metadata: {
        pageCount: 3,
        deadline: Date.now() + 10000,
      },
    });

    // Assertions:
    // - All calls executed (1 structure + 3 chapters = 4 calls)
    expect(mockAiService.generateContent).toHaveBeenCalledTimes(4);
    // - Pages array populated
    expect(result.pages).toHaveLength(3);
    // - Metadata includes quota usage
    expect(result.metadata.quotaUsed).toBe(4);
  });

  // Test 2: Quota exhaustion - defer and retry after window reset
  test("handles quota exhaustion with deferral", async () => {
    let callCount = 0;
    const mockAiService = {
      generateContent: vi.fn(async (prompt) => {
        callCount++;
        if (callCount === 2) {
          // Simulate quota exhaustion on call 2
          const err = new Error("429: Too many requests");
          err.code = "429";
          throw err;
        }
        return {
          content: { title: "Ch", body: "Content" },
        };
      }),
    };

    const deferralCalls = [];
    const result = await ebookService.handle({
      prompt: "Test prompt",
      metadata: {
        pageCount: 3,
        deadline: Date.now() + 10000,
        onDeferral: () => deferralCalls.push(Date.now()),
      },
    });

    // Should emit deferral event
    expect(deferralCalls.length).toBeGreaterThan(0);
    // Should continue after deferral
    expect(result.pages).toHaveLength(3);
  });

  // Test 3: Time exceeded - continues with warnings
  test("continues past deadline with warnings", async () => {
    const mockAiService = {
      generateContent: vi.fn(async () => ({
        content: { title: "Ch", body: "Content" },
      })),
    };

    const statusUpdates = [];
    const result = await ebookService.handle({
      prompt: "Test",
      metadata: {
        pageCount: 2,
        deadline: Date.now() + 100, // Expires immediately
        onStatusChange: (status) => statusUpdates.push(status),
      },
    });

    // Should complete despite deadline exceeded
    expect(result.pages.length).toBeGreaterThan(0);
    // Should emit time-related warnings in status
    const timeWarnings = statusUpdates.filter((s) => s.event?.includes("time"));
    expect(timeWarnings.length).toBeGreaterThanOrEqual(0); // May not warn if very fast
  });

  // Test 4: Fatal error (auth) - fails immediately without retry
  test("fails immediately on fatal errors", async () => {
    const mockAiService = {
      generateContent: vi.fn(async () => {
        const err = new Error("AUTHENTICATION_FAILED: Invalid API key");
        err.code = "AUTHENTICATION_FAILED";
        throw err;
      }),
    };

    ebookService._setAiService(mockAiService);

    await expect(
      ebookService.handle({
        prompt: "Test",
        metadata: { pageCount: 2, deadline: Date.now() + 10000 },
      })
    ).rejects.toThrow("AUTHENTICATION_FAILED");

    // Should only attempt once (no retry on fatal)
    expect(mockAiService.generateContent).toHaveBeenCalledTimes(1);
  });
});
```

---

## Part F: Frontend Integration (Out of Scope for Stage 2)

### F.1: Callback Contract for Frontend Progress

**Header Comments:** What frontend should expect

```javascript
/**
 * Callback Contract for Frontend Progress Tracking
 * ================================================
 *
 * onStatusChange callback receives:
 * {
 *   event: "chapter-complete" | "quota-wait" | "time-warning" | "time-exceeded",
 *   chapterNum?: number,
 *   totalChapters?: number,
 *   status: {
 *     quotaStatus: { callsInWindow, percentUsed, isExhausted },
 *     timeStatus: { budgetMs, elapsedMs, percentUsed, isExceeded },
 *     callMetrics: { totalAttempted, totalSucceeded, totalFailed },
 *   }
 * }
 *
 * Frontend should:
 * 1. Display chapter progress bar: chapterNum/totalChapters
 * 2. Show quota warning if percentUsed > 80%
 * 3. Show countdown timer: timeStatus.budgetMs - timeStatus.elapsedMs
 * 4. Show "waiting for quota reset" message when quota exhausted
 */
```

---

## Part G: Testing & Validation Checklist

- [ ] **Task 1:** Structure call wrapped - test returns 1 page
- [ ] **Task 2:** Chapter calls wrapped - test returns all chapters
- [ ] **Task 3:** Deferral UI communication - test receives callbacks
- [ ] **Task 4:** Error handling updated - test enhanced error messages
- [ ] **Task 5:** Integration tests created - all tests passing
- [ ] **Task 6:** genieService updated - uses new flow
- [ ] **Task 7:** Documentation complete - PR ready

---

## Part H: Known Limitations & Future Work

### H.1: Not Implemented in Stage 2

- [ ] Frontend timer/progress UI (handled in Stage 3)
- [ ] Persistent state for long-running generations (Stage 5)
- [ ] Async job queue (considered for later)
- [ ] Rate limiting headers parsing (e.g., Retry-After)

### H.2: Tech Debt / Follow-ups

- Consider making maxDeferralWait configurable per request
- Add observability: log all deferral events with timestamps
- Support for partial chapter salvage (skip failed chapters gracefully)
- Cache structure calls across prompts (future optimization)

---

## Part I: Success Criteria

✅ **Stage 2 Complete When:**

1. **All chapter calls orchestrated through CallManager**

   - [ ] Structure call (1) + chapter calls (pageCount) = pageCount+1 total API calls
   - [ ] All calls pass through `callManager.executeCall()`
   - [ ] Quota tracking shows correct usage

2. **Deferral mechanism functional**

   - [ ] Exhausting quota triggers `onDeferral` callback
   - [ ] Generation continues after window reset
   - [ ] No data loss (chapters complete successfully)

3. **Error handling improved**

   - [ ] Retriable errors: defer and retry
   - [ ] Fatal errors: fail immediately with enhanced context
   - [ ] No more stub fallback (data loss > fake data)

4. **Integration tests passing**

   - [ ] Happy path: structure + chapters
   - [ ] Quota exhaustion: deferral + retry
   - [ ] Time exceeded: continues with warnings
   - [ ] Fatal error: immediate failure

5. **Documentation complete**
   - [ ] All implementation steps documented
   - [ ] Error handling flows explained
   - [ ] Frontend callback contract defined
   - [ ] PR ready for review

---

## Part J: Next Stage (Stage 3)

**Stage 3 Focus:** Frontend Timer & Real-time Progress Display  
**Estimated Effort:** 2-3 hours  
**Key Deliverable:** Real-time countdown + quota/time metrics on UI  
**Technologies:** Server-Sent Events (SSE) or WebSocket  
**Dependency:** Requires Stage 2 completion

**Early Preview:**

```javascript
// Stage 3 will implement this flow:
// Client: POST /api/generate/ebook { prompt, pageCount }
// Server: Creates CallManager, emits status events via SSE
// Client: Displays real-time timer: "3 chapters complete, waiting for quota reset..."
// Server: When quota available, continues + emits completion event
// Client: Shows result with generation stats
```

---

## Appendix: Quick Reference

**Files to Modify:**

- `/workspaces/Aether/server/ebookService.js` - Main implementation
- `/workspaces/Aether/server/__tests__/ebookService.integration.test.js` - Tests

**CallManager Methods Used:**

- `executeCall(fn, index, type)` - Orchestrate API call
- `getQuotaStatus()` - Check quota usage
- `getTimeStatus()` - Check time budget
- `getStatus()` - Full snapshot
- `isRetriableError(error)` - Error classification
- `enhanceError(error, context)` - Add diagnostic metadata

**Branch & Commits:**

- Branch: `feat/patience-timer-sequential` (continue from Stage 1)
- Commits: ~5 commits for complete Stage 2 implementation
- Final commit message: "Stage 2: Integrate CallManager with ebookService for quota-aware generation"

**Time Estimate Breakdown:**

- Research & setup: 30 min
- Implementation: 2h 15 min
- Testing & debugging: 45 min
- Documentation & cleanup: 15 min
- **Total: ~3h 45m** (fits within "2-3 hours" estimate with buffer)

---

**Document Status:** Draft (Implementation not yet started)  
**Created:** 2025-12-09 22:15 UTC  
**Reference:** PATIENCE_TIMER_BLUEPRINT.md [SEQ-CORE-002]
