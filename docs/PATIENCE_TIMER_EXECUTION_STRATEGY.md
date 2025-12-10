# Patience Timer Phases 4-8: Execution Strategy & Tracking

**Date**: December 10, 2025 @ 3:20PM
**Branch**: `feat/patience-timer-sequential`  
**Goal**: Complete all remaining testing & deployment phases (4-8) efficiently with full tracking  
**Timeline**: This week (Phases 4-5) + next week (Phases 6-8)  
**Total Effort**: ~8-10 hours focused work

---

## Executive Strategy

**Key Principle**: Test in layers (manual → unit → E2E → performance), commit results after each phase, document findings for deployment readiness.

**Execution Model**:

1. **Phase 4** (Manual): Validate system works in real-world conditions
2. **Phase 5** (Unit): Automate component & integration validation
3. **Phase 6** (E2E): Test full user journeys programmatically
4. **Phase 7** (Performance): Measure and optimize metrics
5. **Phase 8** (Documentation): Capture knowledge for deployment & operations

---

## Phase 4: Manual Testing (CRITICAL) - 60 minutes

### Goal

Validate the system works end-to-end in real browsers with real user scenarios before writing automated tests.

### Execution Plan

**Setup (5 min)**:

```bash
# Terminal 1: Backend
cd /workspaces/AetherPress/server
npm start
# Verify: "Server running on port 3000"

# Terminal 2: Frontend
cd /workspaces/AetherPress/client
npm run dev
# Verify: "Local: http://localhost:5173"

# Browser: Open http://localhost:5173
# DevTools: F12, Network tab open
```

**Test Checklist (Desktop - 35 min)**:

| #   | Test Case              | Procedure                                                                        | Expected Result                                            | Status | Notes                        |
| --- | ---------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ | ---------------------------- |
| 1   | 3-page happy path      | Prompt: "A short children's story about a brave mouse", Pages: 3, Click Generate | ~15-20s, no quota wait, all chapters, no console errors    | ☐      | Record time & events         |
| 2   | 10-page with quota     | Prompt: "A comprehensive guide to AI safety", Pages: 10, Click Generate          | ~55-65s, quota-deferral visible, timer countdown, complete | ☐      | Check deferral timing        |
| 3   | Timer accuracy         | Watch timer during generation                                                    | Counts down MM:SS, ticks every ~1s                         | ☐      | Compare elapsed vs real time |
| 4   | Quota bar updates      | Monitor quota bar during 10-page                                                 | 0% → 100% → deferral → reset → continue                    | ☐      | Screenshot sequence          |
| 5   | Chapter log filling    | Monitor chapter log panel                                                        | Each chapter appears as "Generated: Chapter X"             | ☐      | Track log entries            |
| 6   | Invalid input error    | Leave prompt empty, click Generate                                               | Error message shows, button disabled                       | ☐      | Verify validation works      |
| 7   | Network error handling | Start generation, stop server (CTRL+C), observe                                  | Error message displays, component closes cleanly           | ☐      | Check error UI               |
| 8   | DevTools Network       | Check Network tab EventSource                                                    | Single EventSource connection, 40-50 events flowing        | ☐      | Count total events           |
| 9   | Console clean          | Check DevTools Console                                                           | 0 errors, 0 warnings                                       | ☐      | Note any messages            |
| 10  | Performance smooth     | Check DevTools Performance                                                       | No jank, 60fps target                                      | ☐      | Record P95 render time       |

**Mobile Testing (15 min)**:

Using DevTools mobile emulator (iPhone 12: 390px):

| #   | Test Case         | Procedure                 | Expected Result                                    | Status | Notes                   |
| --- | ----------------- | ------------------------- | -------------------------------------------------- | ------ | ----------------------- |
| 11  | Mobile layout     | Generate 3-page on 390px  | Quota bar readable, timer readable, log scrollable | ☐      | Screenshot              |
| 12  | Touch target size | Tap buttons               | Buttons easy to tap (44px min)                     | ☐      | No misclicks            |
| 13  | Mobile perf       | Generate 5-page on mobile | <100ms per event update                            | ☐      | Monitor Performance tab |

**Results Capture (5 min)**:

Create file: `/workspaces/AetherPress/PHASE_4_TEST_RESULTS.md`

```markdown
# Phase 4: Manual Testing Results

**Date**: [TODAY]  
**Tester**: [NAME]  
**Branch**: feat/patience-timer-sequential

## Desktop Testing

### Test Results Summary

- 3-page generation: ✅ PASS (15s, no errors)
- 10-page generation: ✅ PASS (58s, 1 quota reset visible)
- Timer accuracy: ✅ PASS (MM:SS format, ticks every 1s)
- [Add all 10 desktop test results]

### Issues Found

1. [Issue description] - Severity: HIGH/MEDIUM/LOW - Fix required: YES/NO
2. [etc]

### Screenshots/Video

- [Attach screenshots of quota reset, timer, chapter log]
- [Note any videos recorded]

## Mobile Testing

### Test Results Summary

- Layout: ✅ PASS (all elements readable on 390px)
- Touch: ✅ PASS (44px buttons, smooth scrolling)
- Performance: ✅ PASS (<100ms per event)

### Issues Found

[None reported]

## Conclusion

✅ READY FOR PHASE 5 / ❌ BLOCKER FOUND: [describe]
```

### Success Criteria

- ✅ 3-page generates in 15-20s, no errors
- ✅ 10-page shows quota deferral countdown (45-60s wait)
- ✅ Timer counts down MM:SS accurately
- ✅ No console errors on desktop or mobile
- ✅ EventSource connection visible in Network tab
- ✅ All 20 test cases documented

### Blockers to Watch

- SSE not connecting → Check CORS headers, server logs
- Events not flowing → Check event names match exactly
- Quota bar stuck → Check CallManager quota logic
- Timer inaccurate → Check time calculation vs elapsed

---

## Phase 5: Unit Tests (HIGH) - 2-3 hours

### Goal

Automate component & integration testing to catch regressions and validate all code paths.

### Execution Plan

**Part 5A: Component Tests (1 hour)**

File: `client/__tests__/EbookProgressTracker.svelte.test.js`

```javascript
// Template structure - implement assertions
import { render, waitFor, screen } from "@testing-library/svelte";
import EbookProgressTracker from "../src/components/EbookProgressTracker.svelte";

describe("EbookProgressTracker Component", () => {
  describe("Mounting & Props", () => {
    test("renders when url provided", () => {
      const { container } = render(EbookProgressTracker, {
        props: { url: "http://localhost:3000/api/stream" },
      });
      expect(
        container.querySelector('[data-testid="progress-tracker"]')
      ).toBeTruthy();
    });

    test("does not render when url is null", () => {
      const { container } = render(EbookProgressTracker, {
        props: { url: null },
      });
      expect(
        container.querySelector('[data-testid="progress-tracker"]')
      ).toBeFalsy();
    });

    test("accepts onComplete callback", async () => {
      const onComplete = vi.fn();
      const { container } = render(EbookProgressTracker, {
        props: {
          url: "http://localhost:3000/api/stream",
          onComplete,
        },
      });

      // Simulate complete event
      // ...
      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe("EventSource Connection", () => {
    test("connects to SSE endpoint on mount", () => {
      const eventSourceSpy = vi.spyOn(global, "EventSource");
      render(EbookProgressTracker, {
        props: { url: "http://localhost:3000/api/stream" },
      });
      expect(eventSourceSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/stream"
      );
    });

    test("closes connection on unmount", async () => {
      const { unmount } = render(EbookProgressTracker, {
        props: { url: "http://localhost:3000/api/stream" },
      });

      const closeSpy = vi.fn();
      // ... setup close spy

      unmount();
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe("Event Handlers", () => {
    test("handles quota-update event", async () => {
      const { container } = render(EbookProgressTracker, {
        props: { url: "http://localhost:3000/api/stream" },
      });

      // Simulate quota-update event
      const event = new MessageEvent("message", {
        data: JSON.stringify({
          type: "quota-update",
          percentUsed: 75,
          callsInWindow: 15,
          quotaLimit: 20,
        }),
      });
      // ... dispatch event

      await waitFor(() => {
        const quotaBar = container.querySelector('[data-testid="quota-bar"]');
        expect(quotaBar).toHaveStyle("width: 75%");
      });
    });

    test("handles time-update event", async () => {
      const { container } = render(EbookProgressTracker, {
        props: { url: "http://localhost:3000/api/stream" },
      });

      // Simulate time-update event
      const event = new MessageEvent("message", {
        data: JSON.stringify({
          type: "time-update",
          remainingMs: 45000,
          budgetMs: 300000,
        }),
      });
      // ... dispatch event

      await waitFor(() => {
        const timer = container.querySelector('[data-testid="timer"]');
        expect(timer.textContent).toContain("0:45"); // 45 seconds
      });
    });

    // ... test remaining 6 event types (call-start, call-complete, call-deferred, time-tight, error, complete)
  });

  describe("UI Updates", () => {
    test("updates quota bar percentage", async () => {
      // ... render and simulate events
      expect(quotaBar.style.width).toBe("100%"); // After 20 calls
    });

    test("updates time countdown MM:SS format", async () => {
      // ... render and simulate time-update
      expect(timerText).toMatch(/\d{1,2}:\d{2}/); // MM:SS format
    });

    test("adds entry to chapter log on call-complete", async () => {
      const { container } = render(EbookProgressTracker, {
        props: { url: "http://localhost:3000/api/stream" },
      });

      // Simulate call-complete event
      const event = new MessageEvent("message", {
        data: JSON.stringify({
          type: "call-complete",
          callType: "chapter-1",
          duration: 3200,
        }),
      });
      // ... dispatch

      await waitFor(() => {
        const logEntry = container.querySelector('[data-testid="chapter-log"]');
        expect(logEntry.textContent).toContain("Chapter 1");
      });
    });

    // ... test remaining UI updates (deferral, error, completion)
  });

  describe("State Management", () => {
    test("maintains reactive state for quota", async () => {
      // Verify state updates trigger re-renders
    });

    test("maintains reactive state for time", async () => {
      // Verify state updates trigger re-renders
    });

    test("maintains reactive state for chapters", async () => {
      // Verify state updates trigger re-renders
    });

    test("maintains reactive state for errors", async () => {
      // Verify state updates trigger re-renders
    });
  });

  describe("Callbacks", () => {
    test("calls onComplete with result data", async () => {
      const onComplete = vi.fn();
      const { container } = render(EbookProgressTracker, {
        props: {
          url: "http://localhost:3000/api/stream",
          onComplete,
        },
      });

      // Simulate complete event with data
      // ... dispatch

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "complete",
          resultId: expect.any(String),
        })
      );
    });

    test("calls onError with error data", async () => {
      const onError = vi.fn();
      // ... similar to onComplete
    });
  });

  describe("Error Handling", () => {
    test("displays connection errors", async () => {
      // Simulate connection failure
      // Verify error message displays
    });

    test("displays parse errors gracefully", async () => {
      // Simulate malformed event
      // Verify graceful handling
    });

    test("recovers from malformed events", async () => {
      // Verify component continues after bad event
    });
  });

  describe("Mobile Responsive", () => {
    test("renders correctly on mobile viewport (390px)", () => {
      // Set viewport to 390px
      // Verify layout is readable
    });

    test("renders correctly on desktop viewport (1920px)", () => {
      // Set viewport to 1920px
      // Verify layout is centered
    });
  });

  describe("Accessibility", () => {
    test("has ARIA labels on interactive elements", () => {
      // Verify ARIA attributes present
    });

    test("uses semantic HTML", () => {
      // Verify proper HTML tags (no divs where semantic available)
    });

    test("has adequate color contrast", () => {
      // Verify WCAG AA compliance
    });

    test("has min 44px touch target", () => {
      // Verify button sizes meet A11y guidelines
    });
  });
});
```

**Execution**:

```bash
cd /workspaces/AetherPress/client
npm install --save-dev @testing-library/svelte vitest @vitest/ui
npm run test -- EbookProgressTracker.svelte.test.js --ui
# Expected: 30+ tests passing
```

**Part 5B: Integration Tests (30 min)**

File: `client/__tests__/App.ebook.integration.test.js`

```javascript
describe("App.svelte - Ebook with SSE Progress", () => {
  test("shows progress tracker when generate clicked", async () => {
    // Render App
    // Click generate button
    // Verify EbookProgressTracker component appears
  });

  test("hides progress tracker on completion", async () => {
    // Render App with progress tracker visible
    // Simulate complete event
    // Verify component hidden
  });

  test("passes correct props to progress tracker", async () => {
    // Render App
    // Click generate
    // Verify SSE URL contains correct query params (prompt, pageCount, theme, etc)
  });

  test("handles progress completion callback", async () => {
    // Render App
    // Simulate complete event with result
    // Verify App state updated correctly
  });

  test("handles progress error callback", async () => {
    // Render App
    // Simulate error event
    // Verify error displayed to user
  });

  test("updates error state on fatal error", async () => {
    // Render App
    // Simulate fatal error (e.g., 401 Unauthorized)
    // Verify error message and guidance displayed
  });

  test("disables button during generation", async () => {
    // Render App
    // Click generate
    // Verify button disabled/loading state
  });

  test("enables button on completion", async () => {
    // Simulate complete event
    // Verify button re-enabled
  });
});
```

**Execution**:

```bash
npm run test -- App.ebook.integration.test.js --ui
# Expected: 8+ tests passing
```

**Part 5C: SSE Endpoint Tests (30 min)**

File: `server/__tests__/ebookService.progress.test.js`

```javascript
describe("SSE Endpoint: /api/ebook/generate-with-progress", () => {
  describe("Request Validation", () => {
    test("validates prompt provided", async () => {
      const res = await request(app)
        .post("/api/ebook/generate-with-progress")
        .query({ pageCount: 5 }); // Missing prompt
      expect(res.status).toBe(400);
    });

    // ... 4 more validation tests
  });

  describe("SSE Response Setup", () => {
    test("sets correct Content-Type header", async () => {
      const res = await request(app)
        .post("/api/ebook/generate-with-progress")
        .query({ prompt: "test", pageCount: 3 });
      expect(res.headers["content-type"]).toContain("text/event-stream");
    });

    // ... 4 more setup tests
  });

  describe("Event Types Coverage", () => {
    test("emits quota-update event when calls exceed limit", async () => {
      // Simulate 11+ API calls
      // Verify quota-update event emitted
    });

    test("emits time-update event every 1 second", async () => {
      // Monitor event stream for 10 seconds
      // Verify time-update events at ~1s intervals
    });

    test("emits call-start event before each API call", async () => {
      // Monitor event stream
      // Verify call-start before each gemini call
    });

    test("emits call-complete event after successful call", async () => {
      // Monitor event stream
      // Verify call-complete with duration
    });

    test("emits call-deferred event when quota exhausted", async () => {
      // Trigger quota exhaustion
      // Verify call-deferred event
    });

    test("emits time-tight event at 80% budget", async () => {
      // Setup 80% time usage
      // Verify time-tight event
    });

    test("emits error event on fatal error", async () => {
      // Simulate 401 Unauthorized
      // Verify error event
    });

    test("emits complete event with result data", async () => {
      // Generate ebook
      // Verify complete event with resultId, chapters, etc
    });

    // ... 48 more detailed event type tests (event ordering, data format, field validation)
  });

  describe("CallManager Integration", () => {
    test("CallManager deadline calculated correctly", () => {
      // pageCount=10 → deadline = now + (10*3000) + (1*60000) + 30000
      expect(deadline).toBeGreaterThan(Date.now() + 90000); // at least 1.5 min
    });

    // ... 4 more CallManager tests
  });

  describe("Connection Handling", () => {
    test("closes connection on completion", async () => {
      // Start generation
      // Wait for complete event
      // Verify connection closed
    });

    test("closes connection on error", async () => {
      // Trigger fatal error
      // Verify connection closed
    });

    // ... 3 more connection tests
  });

  describe("Performance", () => {
    test("initial response time < 100ms", async () => {
      const start = Date.now();
      const res = await request(app)
        .post("/api/ebook/generate-with-progress")
        .query({ prompt: "test", pageCount: 3 });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });

    // ... 3 more performance tests
  });

  describe("Backward Compatibility", () => {
    test("old /api/ebook/generate still works", async () => {
      // Verify old endpoint unchanged
    });

    // ... 2 more backward compat tests
  });
});
```

**Execution**:

```bash
cd /workspaces/AetherPress/server
npm run test -- ebookService.progress.test.js --ui
# Expected: 80+ tests passing
```

### Results Capture

Create file: `/workspaces/AetherPress/PHASE_5_TEST_RESULTS.md`

```markdown
# Phase 5: Unit Tests Results

**Date**: [TODAY]  
**Duration**: [X hours]  
**Branch**: feat/patience-timer-sequential

## Test Summary

### Component Tests

- File: `client/__tests__/EbookProgressTracker.svelte.test.js`
- Total: 30+ tests
- Passing: [X]
- Failing: [X]
- Coverage: [X]%

### Integration Tests

- File: `client/__tests__/App.ebook.integration.test.js`
- Total: 8+ tests
- Passing: [X]
- Failing: [X]

### SSE Endpoint Tests

- File: `server/__tests__/ebookService.progress.test.js`
- Total: 80+ tests
- Passing: [X]
- Failing: [X]

## Failures & Fixes

1. [Test name] - [Issue] - [Fix applied]
2. [etc]

## Coverage Report
```

| Statement | Branch | Function | Line |
| --------- | ------ | -------- | ---- |
| [X]%      | [X]%   | [X]%     | [X]% |

```

## Conclusion
✅ ALL TESTS PASSING / ❌ [X] TESTS FAILING - BLOCKED

## Next Steps
→ Phase 6: E2E Testing
```

### Success Criteria

- ✅ 30+ component tests passing
- ✅ 8+ integration tests passing
- ✅ 80+ SSE endpoint tests passing
- ✅ >80% code coverage
- ✅ All event types validated
- ✅ CallManager integration verified

---

## Phase 6: E2E Testing (MEDIUM) - 2-3 hours

### Goal

Test complete user journeys end-to-end programmatically to catch integration issues.

### Execution Plan

**Setup (15 min)**:

```bash
cd /workspaces/AetherPress/client
npm install --save-dev @playwright/test

# Create playwright.config.ts
npx playwright install

# Start servers in background
cd /workspaces/AetherPress/server && npm start &
cd /workspaces/AetherPress/client && npm run dev &
sleep 5 # Wait for servers to start
```

**Test Cases (1.5 hours)**:

File: `client/__tests__/e2e/ebook-progress.e2e.ts`

```typescript
import { test, expect } from "@playwright/test";

test.describe("Patience Timer E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:5173");
  });

  test("3-page generation completes without quota wait", async ({ page }) => {
    // 1. Switch to ebook mode
    await page.click('[data-testid="mode-ebook"]');

    // 2. Fill form
    await page.fill(
      '[data-testid="ebook-prompt"]',
      "A short children's story about a brave mouse"
    );
    await page.selectOption('[data-testid="page-count"]', "3");

    // 3. Start generation
    const generateBtn = page.locator('[data-testid="generate-btn"]');
    await generateBtn.click();

    // 4. Wait for progress tracker to appear
    const progressTracker = page.locator('[data-testid="progress-tracker"]');
    await expect(progressTracker).toBeVisible({ timeout: 5000 });

    // 5. Monitor progress
    const quotaBar = page.locator('[data-testid="quota-bar"]');
    const timer = page.locator('[data-testid="timer"]');
    const chapterLog = page.locator('[data-testid="chapter-log"]');

    // 6. Wait for completion
    const completeMsg = page.locator('[data-testid="completion-msg"]');
    await expect(completeMsg).toBeVisible({ timeout: 60000 });

    // 7. Verify results
    const downloadBtn = page.locator('[data-testid="download-btn"]');
    await expect(downloadBtn).toBeEnabled();

    // 8. Verify no errors
    const errorMsg = page.locator('[data-testid="error-msg"]');
    await expect(errorMsg).not.toBeVisible();

    // 9. Check timing (should be 15-20s for 3 pages)
    const elapsed = Date.now(); // Track in beforeEach and after
    expect(elapsed).toBeLessThan(25000);
  });

  test("10-page generation shows quota reset", async ({ page }) => {
    // 1-3. [Same setup as above]
    await page.click('[data-testid="mode-ebook"]');
    await page.fill(
      '[data-testid="ebook-prompt"]',
      "A comprehensive guide to AI safety"
    );
    await page.selectOption('[data-testid="page-count"]', "10");
    await page.click('[data-testid="generate-btn"]');

    // 4. Wait for progress tracker
    const progressTracker = page.locator('[data-testid="progress-tracker"]');
    await expect(progressTracker).toBeVisible();

    // 5. Monitor for quota-deferral event
    let quotaDeferralSeen = false;
    page.on("response", (response) => {
      if (response.url().includes("generate-with-progress")) {
        // Would need to intercept SSE events here
        // For now, check via UI
      }
    });

    // 6. Watch quota bar reach 100%
    const quotaBar = page.locator('[data-testid="quota-bar"]');
    await expect(quotaBar).toHaveStyle("width: 100%", { timeout: 30000 });

    // 7. Verify deferral message appears
    const deferralMsg = page.locator('[data-testid="deferral-msg"]');
    await expect(deferralMsg).toBeVisible({ timeout: 5000 });

    // 8. Wait for reset & completion
    const completeMsg = page.locator('[data-testid="completion-msg"]');
    await expect(completeMsg).toBeVisible({ timeout: 120000 });

    // 9. Verify chapters generated
    const chapterLog = page.locator('[data-testid="chapter-log"]');
    const chapters = await chapterLog.locator("li").count();
    expect(chapters).toBe(10);

    // 10. Check timing (should be 55-65s for 10 pages with 1 reset)
    expect(elapsed).toBeGreaterThan(50000);
    expect(elapsed).toBeLessThan(70000);
  });

  test("network failure shows error gracefully", async ({ page }) => {
    // 1. Navigate
    await page.goto("http://localhost:5173");

    // 2. Start generation
    await page.click('[data-testid="mode-ebook"]');
    await page.fill('[data-testid="ebook-prompt"]', "Test prompt");
    await page.selectOption('[data-testid="page-count"]', "5");

    // 3. Intercept and abort network
    await page.route("**/api/ebook/generate-with-progress**", (route) => {
      route.abort("failed");
    });

    await page.click('[data-testid="generate-btn"]');

    // 4. Verify error displayed
    const errorMsg = page.locator('[data-testid="error-msg"]');
    await expect(errorMsg).toBeVisible({ timeout: 10000 });
    await expect(errorMsg).toContainText("Connection lost");

    // 5. Verify graceful cleanup
    const progressTracker = page.locator('[data-testid="progress-tracker"]');
    // Should be able to dismiss error and generate again
    await page.click('[data-testid="close-error"]');
    await expect(progressTracker).not.toBeVisible();
  });

  test("invalid input prevented", async ({ page }) => {
    // 1. Navigate to ebook mode
    await page.click('[data-testid="mode-ebook"]');

    // 2. Leave prompt empty
    await page.selectOption('[data-testid="page-count"]', "5");

    // 3. Try to generate
    const generateBtn = page.locator('[data-testid="generate-btn"]');

    // Button should be disabled or click prevented
    if (await generateBtn.isDisabled()) {
      expect(true); // Good: button disabled
    } else {
      // Or check for validation error
      await generateBtn.click();
      const validationError = page.locator('[data-testid="validation-error"]');
      await expect(validationError).toBeVisible();
    }
  });

  test("timer accuracy MM:SS format", async ({ page }) => {
    // 1. Generate 5-page ebook
    await page.click('[data-testid="mode-ebook"]');
    await page.fill('[data-testid="ebook-prompt"]', "Test prompt");
    await page.selectOption('[data-testid="page-count"]', "5");
    await page.click('[data-testid="generate-btn"]');

    // 2. Wait for timer to appear
    const timer = page.locator('[data-testid="timer"]');
    await expect(timer).toBeVisible();

    // 3. Verify MM:SS format (should show something like 0:45 or 1:30)
    const timerText = await timer.textContent();
    expect(timerText).toMatch(/\d{1,2}:\d{2}/);

    // 4. Watch it tick down
    const initialText = timerText;
    await page.waitForTimeout(2000); // Wait 2 seconds
    const newText = await timer.textContent();
    expect(newText).not.toBe(initialText); // Should have changed
  });

  test("mobile responsive layout", async ({ page }) => {
    // 1. Set mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });

    // 2. Generate 3-page
    await page.click('[data-testid="mode-ebook"]');
    await page.fill('[data-testid="ebook-prompt"]', "Test");
    await page.selectOption('[data-testid="page-count"]', "3");
    await page.click('[data-testid="generate-btn"]');

    // 3. Verify progress tracker visible
    const progressTracker = page.locator('[data-testid="progress-tracker"]');
    await expect(progressTracker).toBeVisible();

    // 4. Verify elements readable
    const quotaBar = page.locator('[data-testid="quota-bar"]');
    const timer = page.locator('[data-testid="timer"]');

    const quotaBox = await quotaBar.boundingBox();
    const timerBox = await timer.boundingBox();

    // Both should be visible (width > 0)
    expect(quotaBox?.width).toBeGreaterThan(0);
    expect(timerBox?.width).toBeGreaterThan(0);

    // 5. Verify scrollable (if needed)
    const chapterLog = page.locator('[data-testid="chapter-log"]');
    const logBox = await chapterLog.boundingBox();
    expect(logBox?.height).toBeGreaterThan(0);
  });
});
```

**Execution**:

```bash
cd /workspaces/AetherPress/client
npx playwright test --ui
# Expected: 6+ tests passing, all scenarios validated
```

### Results Capture

Create file: `/workspaces/AetherPress/PHASE_6_E2E_RESULTS.md`

```markdown
# Phase 6: E2E Testing Results

**Date**: [TODAY]  
**Duration**: [X hours]  
**Branch**: feat/patience-timer-sequential

## Test Execution

### Test Suite

- File: `client/__tests__/e2e/ebook-progress.e2e.ts`
- Total: 6 tests
- Passing: [X]
- Failing: [X]

## Test Results

| #   | Test Name             | Status | Duration | Notes                     |
| --- | --------------------- | ------ | -------- | ------------------------- |
| 1   | 3-page (no quota)     | ✅     | [Xs]     | Completed cleanly         |
| 2   | 10-page (quota reset) | ✅     | [Xs]     | Reset visible at ~50s     |
| 3   | Network failure       | ✅     | [Xs]     | Error displayed correctly |
| 4   | Invalid input         | ✅     | [Xs]     | Validation working        |
| 5   | Timer MM:SS           | ✅     | [Xs]     | Format correct, ticking   |
| 6   | Mobile responsive     | ✅     | [Xs]     | Readable on 390px         |

## Video Recordings

- [Link to 3-page video]
- [Link to 10-page video with quota reset]

## Issues Found

[None / describe any failures]

## Conclusion

✅ ALL E2E TESTS PASSING - SYSTEM PRODUCTION READY

## Next Steps

→ Phase 7: Performance Testing
```

### Success Criteria

- ✅ 6+ E2E tests passing
- ✅ 3-page completes in 15-20s
- ✅ 10-page shows quota reset at ~50-60s
- ✅ Network error handled gracefully
- ✅ Timer accurate to ~1s
- ✅ Mobile layout readable at 390px

---

## Phase 7: Performance Testing (MEDIUM) - 1 hour

### Goal

Measure and document performance baselines, optimize if needed.

### Execution Plan

**Part 7A: Backend Performance (20 min)**

```bash
# Terminal 1: Profile server
cd /workspaces/AetherPress/server
node --prof index.js

# Terminal 2: Generate 10-page ebook (triggers quota reset)
# ... use browser or curl to call /api/ebook/generate-with-progress

# Back to Terminal 1: Stop profiler (CTRL+C)
node --prof-process isolate-*.log > server-perf.txt
cat server-perf.txt | head -50
```

**Metrics to Record**:

- Initial response time (SSE setup)
- Per-event processing time
- Memory usage peak
- CPU usage during generation

File: `/workspaces/AetherPress/PHASE_7_PERF_BASELINE.md`

```markdown
# Backend Performance Baseline

## Metrics

| Metric           | Value | Target | Status |
| ---------------- | ----- | ------ | ------ |
| Initial response | [X]ms | <100ms | ✅/❌  |
| Per-event time   | [X]ms | <10ms  | ✅/❌  |
| Peak memory      | [X]MB | <50MB  | ✅/❌  |
| Peak CPU         | [X]%  | <20%   | ✅/❌  |

## Event Count

- 10-page generation: [X] events
- Average spacing: [X]ms between events

## Optimization Opportunities

[List any improvements if over targets]
```

**Part 7B: Frontend Performance (20 min)**

```bash
# Use DevTools Performance tab
# 1. Open DevTools (F12) → Performance
# 2. Click Record
# 3. Generate 5-page ebook
# 4. Stop recording when complete
# 5. Analyze results
```

**Metrics to Record**:

- Component mount time
- Per-event render time (jank detection)
- Memory usage
- Event listener count

**Part 7C: Network Performance (10 min)**

```bash
# DevTools Network tab
# 1. Open DevTools → Network
# 2. Generate 10-page ebook
# 3. Check EventSource stream

# Metrics:
# - Single EventSource connection ✅
# - Bandwidth used (KB)
# - Event latency (ms from server to client)
```

**Part 7D: Optimization (10 min)**

If any metrics exceed targets:

```javascript
// Example optimization: Throttle time-update events
// Only emit every 500ms instead of every 100ms
// Reduces event count by 80%
```

### Results Capture

Create file: `/workspaces/AetherPress/PHASE_7_PERFORMANCE_REPORT.md`

```markdown
# Phase 7: Performance Testing Report

**Date**: [TODAY]  
**Branch**: feat/patience-timer-sequential

## Backend Performance

| Metric           | Value | Target | Status |
| ---------------- | ----- | ------ | ------ |
| Initial response | [X]ms | <100ms | ✅/❌  |
| Per-event        | [X]ms | <10ms  | ✅/❌  |
| Memory peak      | [X]MB | <50MB  | ✅/❌  |
| CPU peak         | [X]%  | <20%   | ✅/❌  |

## Frontend Performance

| Metric            | Value | Target | Status |
| ----------------- | ----- | ------ | ------ |
| Mount time        | [X]ms | <50ms  | ✅/❌  |
| Per-event render  | [X]ms | <100ms | ✅/❌  |
| Memory usage      | [X]MB | <5MB   | ✅/❌  |
| FPS during events | [X]   | 60fps  | ✅/❌  |

## Network Performance

| Metric          | Value | Notes                      |
| --------------- | ----- | -------------------------- |
| SSE connections | 1     | Single stream ✅           |
| Total bandwidth | [X]KB | 10-page generation         |
| Event latency   | [X]ms | Time from server to client |

## Optimization Applied

[List any tweaks made to hit targets]

## Conclusion

✅ PERFORMANCE ACCEPTABLE / ❌ OPTIMIZATION NEEDED

## Recommendations

[Any future optimizations]
```

### Success Criteria

- ✅ Initial response <100ms (or <200ms acceptable)
- ✅ Per-event render <100ms (no UI jank)
- ✅ Memory <5MB per instance
- ✅ No memory leaks on unmount
- ✅ Single EventSource connection

---

## Phase 8: Documentation (LOW) - 30 minutes

### Goal

Capture knowledge for deployment, operations, and future maintenance.

### Files to Create/Update

**File 1: Update README.md**

Add section after introduction:

````markdown
## Real-Time Progress Tracking (Patience Timer)

Generate ebooks with transparent real-time progress tracking:

- **See exactly what's happening**: Structure generation → Chapter generation → Quota reset wait → Completion
- **Honest timing**: No hidden waits, no stubs
- **Quota resets visible**: When API quota exhausted, system automatically waits and retries

### Quick Start

```bash
# 1. Start server & client
cd server && npm start &
cd ../client && npm run dev

# 2. Open browser to http://localhost:5173
# 3. Click "Generate eBook"
# 4. Watch real-time progress with quota bar and timer
```
````

### Performance

- 3-page ebook: ~15-20 seconds
- 10-page ebook: ~55-65 seconds (includes 1 quota reset)
- 20-page ebook: ~2-3 minutes (includes 1-2 quota resets)

### More Info

See `/docs/PATIENCE_TIMER_BLUEPRINT.md` for architecture details.

````

**File 2: Create docs/API_PROGRESS_ENDPOINT.md**

```markdown
# Real-Time Ebook Generation API

## Endpoint: POST /api/ebook/generate-with-progress

Stream real-time progress updates via Server-Sent Events (SSE).

### Request

**URL**: `/api/ebook/generate-with-progress`
**Method**: POST
**Content-Type**: application/json OR query parameters

### Query Parameters

| Parameter | Type | Required | Example |
|-----------|------|----------|---------|
| prompt | string | Yes | "A story about..." |
| pageCount | number | Yes | 10 |
| theme | string | No | "dark" (default: "light") |
| fontSizeScale | number | No | 1.0 (default: 1.0) |
| colorPalette | string | No | "default" |

### Response

**Content-Type**: text/event-stream

**Event Types**:

#### 1. quota-update
Updates when API quota consumption changes.
```json
{
  "type": "quota-update",
  "callsInWindow": 18,
  "quotaLimit": 20,
  "percentUsed": 90
}
````

#### 2. time-update

Emitted every ~1 second with time budget status.

```json
{
  "type": "time-update",
  "elapsedMs": 25000,
  "budgetMs": 300000,
  "remainingMs": 275000,
  "percentUsed": 8
}
```

#### 3. call-start

Emitted when API call initiates.

```json
{
  "type": "call-start",
  "callIndex": 5,
  "callType": "chapter-4",
  "model": "gemini-2.5-flash"
}
```

#### 4. call-complete

Emitted when API call succeeds.

```json
{
  "type": "call-complete",
  "callIndex": 5,
  "callType": "chapter-4",
  "durationMs": 3200,
  "chapterTitle": "Chapter 4: Adventure Begins"
}
```

#### 5. call-deferred

Emitted when quota exhausted, call deferred.

```json
{
  "type": "call-deferred",
  "callIndex": 6,
  "callType": "chapter-5",
  "reason": "QUOTA_EXHAUSTED",
  "waitMs": 45000
}
```

#### 6. time-tight

Emitted when time budget >80% used.

```json
{
  "type": "time-tight",
  "phase": "chapter-5",
  "percentUsed": 85,
  "remainingMs": 45000
}
```

#### 7. error

Emitted on fatal error.

```json
{
  "type": "error",
  "message": "Authentication failed",
  "code": "AUTHENTICATION_ERROR",
  "retriable": false
}
```

#### 8. complete

Emitted when generation finishes.

```json
{
  "type": "complete",
  "resultId": "uuid-here",
  "chapters": 10,
  "durationMs": 58000,
  "quotaResetsCount": 1
}
```

### Example: curl

```bash
curl -N -H "Accept: text/event-stream" \
  "http://localhost:3000/api/ebook/generate-with-progress?prompt=A+story&pageCount=3"

# Output:
# data: {"type":"quota-update","callsInWindow":1,"quotaLimit":20,"percentUsed":5}
# data: {"type":"time-update","elapsedMs":100,"budgetMs":300000,...}
# data: {"type":"call-complete","callIndex":0,"callType":"structure",...}
# ... more events ...
# data: {"type":"complete","resultId":"xyz",...}
```

### Example: JavaScript

```javascript
const eventSource = new EventSource(
  "/api/ebook/generate-with-progress?prompt=My%20story&pageCount=5"
);

eventSource.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "quota-update":
      console.log(`Quota: ${data.callsInWindow}/${data.quotaLimit}`);
      break;
    case "time-update":
      console.log(`Time: ${data.remainingMs}ms remaining`);
      break;
    case "complete":
      console.log(`Done! ${data.chapters} chapters`);
      eventSource.close();
      break;
    case "error":
      console.error(`Error: ${data.message}`);
      eventSource.close();
      break;
  }
});
```

### Error Handling

#### Retriable Errors

- 429 RATE_LIMIT_EXCEEDED: Quota exhausted, waits & retries automatically
- 503 SERVICE_UNAVAILABLE: Transient, waits & retries automatically
- Network timeouts: Waits & retries automatically

#### Fatal Errors

- 400 BAD_REQUEST: Invalid input, fails immediately
- 401 UNAUTHORIZED: Auth error, fails immediately
- 403 FORBIDDEN: Permission denied, fails immediately

### Browser Compatibility

- ✅ Chrome, Firefox, Safari, Edge (all modern versions)
- ❌ Internet Explorer (not supported)

For IE support, use WebSocket fallback or polling.

### Performance Characteristics

| Scenario | Duration | Quota Resets |
| -------- | -------- | ------------ |
| 3-page   | 15-20s   | 0            |
| 10-page  | 55-65s   | 1            |
| 20-page  | 2-3 min  | 1-2          |
| 60-page  | 3-4 min  | 3            |

### Under the Hood

- Sequential API calls (1 structure call + N chapter calls)
- CallManager orchestrates quota/time management
- Quota: 20 calls per 60-second window
- Time budget: 10 minutes default (configurable per request)
- Automatic deferral & retry when quota exhausted

````

**File 3: Create docs/DEPLOYMENT_CHECKLIST.md**

```markdown
# Patience Timer Stage 3: Deployment Checklist

**Status**: ✅ Ready for Merge / Code Review / Staging / Production

## Pre-Deployment

### Code Quality ✅
- [x] All phases 1-3 code complete
- [x] 0 syntax errors, 0 type errors
- [x] TypeScript enabled
- [x] Proper error handling

### Testing ✅
- [x] Phase 4: Manual testing complete (desktop + mobile)
- [x] Phase 5: Unit tests passing (30+ component, 8+ integration, 80+ SSE endpoint)
- [x] Phase 6: E2E tests passing (6 scenarios: 3-page, 10-page, errors, mobile, etc)
- [x] Phase 7: Performance baseline (all metrics acceptable)

### Code Review
- [ ] Peer review on feature branch
- [ ] Security review (CORS, input validation, SSE safety)
- [ ] Performance review (event throughput, memory usage)

## Merge to Develop

```bash
git checkout develop
git pull origin develop
git merge feat/patience-timer-sequential
npm test  # Run full suite
````

**Expected**: All tests passing, 0 new regressions

## Staging Deployment

1. Deploy feature branch to staging environment
2. Run E2E test suite against staging
3. Manual verification in staging
4. Verify monitoring alerts working

## Production Rollout Options

### Option A: Feature Flag (Recommended for Initial Release)

```bash
# Deploy to production with FEATURE_PATIENCE_TIMER=disabled
# 1. Deploy code
# 2. Monitor error rates (should be 0 change)
# 3. Enable for 10% of users
# 4. Monitor metrics for 24 hours
# 5. Enable for 50% of users if OK
# 6. Enable for 100% of users if OK
```

### Option B: Direct Rollout

```bash
# Deploy directly to production
# 1. Deploy code
# 2. Monitor error rates closely
# 3. Prepare rollback command: git revert <commit>
# 4. If issues, rollback immediately
```

## Monitoring Setup

### Key Metrics Dashboard

```
Grafana: Patience Timer Metrics
├─ SSE Endpoint
│  ├─ Requests/sec (expect 0.5-2 during peak)
│  ├─ Response time p95 (expect <100ms)
│  ├─ Error rate (expect <1%)
│  └─ Active connections (track connections)
├─ Generation
│  ├─ Success rate (expect >99%)
│  ├─ Average duration by page count
│  ├─ Quota resets triggered (expected, monitor for spikes)
│  └─ Time budget exceeded count (rare, monitor)
└─ Client
   ├─ EventSource connect/disconnect rate
   ├─ Event parse errors (expect 0)
   └─ User engagement (time in UI, page scrolls)
```

### Alerts to Configure

- SSE endpoint error rate >5%
- Response time p95 >500ms
- Generation failure rate >1%
- Quota reset frequency anomaly (>2x normal)

## Rollback Plan

```bash
# If critical issue
git revert <patience-timer-commit>
git push origin main
# Deployment system auto-deploys rollback

# Expected: Users see old UI (no SSE)
# Old endpoint still works: /api/ebook/generate
```

## Documentation

### User-Facing

- [x] Updated README.md with progress tracking
- [x] API documentation created
- [x] User guide for quota wait behavior

### Operational

- [x] Deployment checklist (this file)
- [x] Monitoring dashboard setup
- [x] Troubleshooting guide
- [x] Architecture documentation

### Developer

- [x] Code comments on complex logic
- [x] Test documentation
- [x] Migration guide for future batch optimization

## Post-Deployment Validation

### Day 1

- [ ] Monitor error rates (should be <1%)
- [ ] Monitor response times (should be <100ms)
- [ ] Check user feedback (Slack, email)
- [ ] Verify metrics dashboard updating correctly

### Week 1

- [ ] User engagement metrics (% of users with progress tracker)
- [ ] Quota reset frequency analysis
- [ ] Error classification analysis
- [ ] Mobile vs desktop usage distribution

### Month 1

- [ ] User satisfaction survey
- [ ] Performance optimization opportunities
- [ ] Baseline for future batch optimization

## Success Criteria

- ✅ All tests passing
- ✅ <1% error rate in production
- ✅ Response time p95 <100ms
- ✅ No memory leaks detected
- ✅ Users see quota resets (expected behavior)
- ✅ >99% generation success rate

## Contact & Escalation

| Role     | Name   | Contact       | Availability |
| -------- | ------ | ------------- | ------------ |
| DevOps   | [Name] | [Slack/Email] | [Hours]      |
| Security | [Name] | [Slack/Email] | [Hours]      |
| Ops Lead | [Name] | [Slack/Email] | [Hours]      |

````

### Results Capture

Create file: `/workspaces/AetherPress/PHASE_8_DOCUMENTATION_COMPLETE.md`

```markdown
# Phase 8: Documentation Complete

**Date**: [TODAY]
**Branch**: feat/patience-timer-sequential

## Files Created/Updated

- [x] README.md - Added Real-Time Progress Tracking section
- [x] docs/API_PROGRESS_ENDPOINT.md - Full API documentation
- [x] docs/DEPLOYMENT_CHECKLIST.md - Production readiness checklist
- [x] docs/PATIENCE_TIMER_BLUEPRINT.md - Already exists
- [x] docs/PATIENCE_TIMER_NEXT_STEPS.md - Already exists

## Documentation Summary

### User-Facing
- Quick start guide in README
- API documentation with curl & JS examples
- Performance characteristics (timing expectations)

### Operational
- Deployment checklist
- Monitoring dashboard specs
- Rollback procedures
- Troubleshooting guide

### Developer
- Architecture documentation
- Event type specifications
- Test coverage documentation
- Migration guide (for batch optimization)

## Conclusion
✅ ALL DOCUMENTATION COMPLETE

## Deployment Readiness
- ✅ Code implementation: 100%
- ✅ Testing: 100%
- ✅ Documentation: 100%
- ✅ Monitoring: Configured
- ✅ Rollback: Prepared

**READY FOR MERGE TO DEVELOP AND STAGING DEPLOYMENT**
````

---

## Summary: Master Execution Timeline

### Week 1 (This Week) - CRITICAL PATH

```
Phase 4: Manual Testing     [60 min]   ↓ COMMIT RESULTS
Phase 5: Unit Tests        [2-3 hrs]   ↓ COMMIT RESULTS
───────────────────────────────────────────────────────────
                     [3-4 hours total] → Ready for Code Review
```

### Week 2 (Next Week) - DEPLOYMENT PATH

```
Phase 6: E2E Testing       [2-3 hrs]   ↓ COMMIT RESULTS
Phase 7: Performance       [1 hour]    ↓ COMMIT RESULTS
Phase 8: Documentation     [30 min]    ↓ COMMIT RESULTS
───────────────────────────────────────────────────────────
                     [3-4 hours total] → Ready for Production
```

---

## Results Tracking System

After each phase, create results file and commit:

```bash
# Phase 4 - Manual Testing
git add PHASE_4_TEST_RESULTS.md
git commit -m "Phase 4: Manual Testing Complete - All scenarios validated"
git push origin feat/patience-timer-sequential

# Phase 5 - Unit Tests
git add PHASE_5_TEST_RESULTS.md
git commit -m "Phase 5: Unit Tests Complete - 100+ tests passing"
git push

# etc...
```

**Results files location**: `/workspaces/AetherPress/` (root level)

**Review results files**: `PHASE_X_TEST_RESULTS.md` (updated as each phase completes)

---

## Success Indicators Per Phase

| Phase | Key Success Metric                                      | Blocker? |
| ----- | ------------------------------------------------------- | -------- |
| 4     | 3-page: 15-20s, 10-page: 55-65s, 0 console errors       | YES      |
| 5     | 100+ tests passing, >80% coverage                       | YES      |
| 6     | All E2E scenarios pass, quota reset visible             | YES      |
| 7     | Metrics within targets (response <100ms, render <100ms) | NO       |
| 8     | 3 docs created, deployment checklist complete           | NO       |

---

## Recommendation: Priority & Parallelization

**This Week (CRITICAL)**:

- **Focus**: Phase 4 & 5
- **Solo work**: Manual testing (phase 4) can be done immediately
- **Parallel**: Start Phase 5 tests while phase 4 is running

**Next Week (HIGH)**:

- **Focus**: Phase 6 & 7
- **Solo work**: Performance testing (phase 7)
- **Integration**: E2E testing (phase 6) requires working backend

**Flexibility**:

- Phase 8 (docs) can be done anytime, minimal blocking
- If phase 5 passes quickly, start phase 6 same day

---

## Quick Command Reference

```bash
# Phase 4: Manual Testing (no commands, browser-based)
# Use PATIENCE_TIMER_NEXT_STEPS.md test checklist

# Phase 5: Unit Tests
cd /workspaces/AetherPress/client
npm run test -- EbookProgressTracker.svelte.test.js --ui

cd /workspaces/AetherPress/server
npm run test -- ebookService.progress.test.js --ui

# Phase 6: E2E Testing
cd /workspaces/AetherPress/client
npx playwright test --ui

# Phase 7: Performance (manual, see guide in phase 7 section)
node --prof server/index.js

# Phase 8: Documentation (create files, see phase 8 section)

# After each phase: Commit results
git add PHASE_X_TEST_RESULTS.md
git commit -m "Phase X: [Title] - [Summary]"
git push origin feat/patience-timer-sequential
```

---

**Next Step**: Start Phase 4 - Manual Testing. Use the checklist in PATIENCE_TIMER_NEXT_STEPS.md (user's open file) to systematically validate each scenario.

Document findings in PHASE_4_TEST_RESULTS.md and commit when complete. Then proceed to Phase 5.

Ready to begin? 🚀
