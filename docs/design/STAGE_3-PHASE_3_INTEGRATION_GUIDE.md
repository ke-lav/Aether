# Phase 3: Integration Guide - Frontend to Backend

**Status**: 🚀 **READY TO BEGIN**  
**Date**: 2025-12-10  
**Architecture Document**: `PATIENCE_TIMER_BLUEPRINT.md`  
**Purpose**: Integrate EbookProgressTracker component into App.svelte and wire to SSE endpoint

---

## Quick Start: 3 Steps to Integration

### Step 1: Import Component (2 minutes)

In `client/src/App.svelte`, add import:

```svelte
<script>
  import EbookProgressTracker from './components/EbookProgressTracker.svelte';

  // ... other imports ...
</script>
```

### Step 2: Add Reactive Variables (2 minutes)

In `<script>` section of App.svelte:

```javascript
let showProgressTracker = false;
let sseEndpointUrl = null;

function handleProgressComplete(result) {
  console.log("Generation complete:", result);
  // Show success message, download button, etc.
  showProgressTracker = false;
}

function handleProgressError(error) {
  console.error("Generation error:", error);
  // Show error message
  showProgressTracker = false;
}
```

### Step 3: Wire to Generate Button (5 minutes)

In the generate button's click handler:

```javascript
async function initiateEbookGeneration() {
  // Build SSE endpoint URL with query params
  const params = new URLSearchParams({
    prompt: currentPrompt,
    pageCount: pageCount.toString(),
    theme: selectedTheme,
    fontScale: fontScale.toString(),
  });

  sseEndpointUrl = `/api/ebook/generate-with-progress?${params.toString()}`;
  showProgressTracker = true;
}
```

### Step 4: Add Component to Template (2 minutes)

In the template section:

```svelte
{#if showProgressTracker}
  <EbookProgressTracker
    url={sseEndpointUrl}
    onComplete={handleProgressComplete}
    onError={handleProgressError}
  />
{/if}
```

**Total time: ~11 minutes**

---

## Detailed Integration Steps

### 1. Locate Current Generate Button in App.svelte

Find the existing "Generate Ebook" button:

```svelte
<button on:click={generateEbook}>Generate Ebook</button>
```

or similar.

### 2. Understand Current Generate Flow

Current implementation (if using old endpoint):

```javascript
async function generateEbook() {
  const response = await fetch("/api/ebook/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: currentPrompt,
      pageCount: pageCount,
      theme: selectedTheme,
      fontScale: fontScale,
    }),
  });

  const ebook = await response.json();
  // Download or display ebook
}
```

### 3. Modify to Use SSE Endpoint

**Option A: Keep both endpoints (recommended for now)**

```javascript
// Old way - synchronous, no progress
async function generateEbookOld() {
  const response = await fetch('/api/ebook/generate', { ... });
  // wait for response
}

// New way - streaming with progress
async function generateEbookWithProgress() {
  const params = new URLSearchParams({
    prompt: currentPrompt,
    pageCount: pageCount.toString(),
    theme: selectedTheme,
    fontScale: fontScale.toString(),
  });

  sseEndpointUrl = `/api/ebook/generate-with-progress?${params.toString()}`;
  showProgressTracker = true;
}
```

**Option B: Replace entirely**

Just change the endpoint from `/api/ebook/generate` to `/api/ebook/generate-with-progress` and use GET instead of POST with query params.

### 4. Test Integration

**Manual Testing Checklist**:

- [ ] Server running (`npm start` in server/)
- [ ] Client running (`npm run dev` in client/)
- [ ] Can see generate button
- [ ] Clicking button shows EbookProgressTracker component
- [ ] SSE events appear in browser console (DevTools → Network → EventSource)
- [ ] Progress bar updates
- [ ] Timer counts down
- [ ] Chapter log fills in
- [ ] "Complete" message appears

**Quick Test**:

```bash
# Terminal 1: Start server
cd /workspaces/AetherPress/server
npm start

# Terminal 2: Start client
cd /workspaces/AetherPress/client
npm run dev

# Browser: Open http://localhost:5173 (or whatever Vite port is)
# Open DevTools: F12 → Network tab
# Click "Generate"
# Look for "generate-with-progress" request
# Click it, see EventStream with events flowing
```

---

## EbookProgressTracker Component API

### Props

```javascript
interface EbookProgressTrackerProps {
  url: string; // SSE endpoint URL (e.g., "/api/ebook/generate-with-progress?...")
  onComplete?: (result: CompletionResult) => void;
  onError?: (error: ErrorResult) => void;
}

interface CompletionResult {
  totalCalls: number; // e.g., 6 (1 structure + 5 chapters)
  totalTime: number; // e.g., 13100 (milliseconds)
  success: boolean; // true if no errors
}

interface ErrorResult {
  code: string; // e.g., "GEMINI_QUOTA_EXCEEDED"
  message: string; // e.g., "API quota exceeded"
  isRetriable: boolean; // true if can retry automatically
}
```

### Usage Example

```svelte
<EbookProgressTracker
  url="/api/ebook/generate-with-progress?prompt=Test&pageCount=5"
  onComplete={(result) => {
    console.log(`Generation took ${result.totalTime}ms`);
    // Show download button
  }}
  onError={(error) => {
    console.error(`Failed: ${error.code}`);
    if (error.isRetriable) {
      // Show "retrying..." message
    } else {
      // Show permanent error
    }
  }}
/>
```

---

## Backend SSE Endpoint

### Request Format

**GET** (URL query params):

```
/api/ebook/generate-with-progress?prompt=...&pageCount=5&theme=light&fontScale=1.0
```

**Required Params**:

- `prompt`: string (the ebook content prompt)
- `pageCount`: number (3-20 pages)

**Optional Params**:

- `theme`: "light" | "dark" (default: "light")
- `fontScale`: number (0.8-1.5, default: 1.0)

### Response Format

**Initial Response**:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Transfer-Encoding: chunked
```

**Then streaming events** (newline-delimited):

```
event: quota-update
data: {"percentUsed": 0, "callsInWindow": 0, "isExhausted": false}

event: call-start
data: {"callIndex": 0, "callType": "structure", "model": "gemini-2.5-pro"}

event: call-complete
data: {"callIndex": 0, "callType": "structure", "durationMs": 2400, "status": "complete"}

...

event: complete
data: {"totalCalls": 6, "totalTime": 13100, "success": true}
```

### Error Response

If validation fails (invalid params):

```
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "Invalid pageCount: must be 3-20"
}
```

If runtime error (Gemini API fails):

```
event: error
data: {"code": "GEMINI_ERROR", "message": "...", "isRetriable": true}
```

---

## Troubleshooting Integration

### Issue: Component shows but no events appear

**Check**:

1. Is server running? (`curl http://localhost:3001/api/health`)
2. Is URL correct? (Check browser console, should see URL in DevTools Network)
3. Are headers correct? (Should see `Content-Type: text/event-stream`)

**Fix**:

```javascript
// Add debugging
console.log("SSE URL:", sseEndpointUrl);
// Open browser DevTools → Network tab
// Click "generate-with-progress" request
// Should see event stream flowing
```

### Issue: Events appear but UI doesn't update

**Check**:

1. Is component mounted? (`{#if showProgressTracker}` should be true)
2. Are events parsing correctly? (Check console for parse errors)

**Fix**:

```javascript
// Add event logging to component
eventSource.addEventListener("quota-update", (event) => {
  console.log("Received quota-update:", event.data);
  // ... rest of handler
});
```

### Issue: Component unmounts before completion

**Check**:

1. Is `showProgressTracker` being set to false early?
2. Is user navigating away?

**Fix**:

```javascript
// Keep component visible until completion
function handleProgressComplete(result) {
  // Don't set showProgressTracker = false here
  // Let user see completion message
  setTimeout(() => {
    showProgressTracker = false;
  }, 2000); // 2 second delay
}
```

---

## Testing Checklist

### ✅ Unit Tests (Component in Isolation)

```javascript
// Component should:
- [ ] Mount without errors
- [ ] Accept url prop
- [ ] Connect to EventSource when url provided
- [ ] Parse all 8 event types correctly
- [ ] Update state reactively
- [ ] Display quota bar
- [ ] Display time countdown
- [ ] Display chapter log
- [ ] Display error on error event
- [ ] Close EventSource on destroy
```

### ✅ Integration Tests (Component + Backend)

```javascript
// Full flow should:
- [ ] POST to /api/ebook/generate-with-progress
- [ ] Receive EventStream response
- [ ] Get quota-update events
- [ ] Get call-start events
- [ ] Get call-complete events
- [ ] Get complete event
- [ ] Call onComplete callback
- [ ] Close connection on completion
```

### ✅ Manual Tests (Real Browser)

```
- [ ] Start server
- [ ] Start client
- [ ] Open http://localhost:5173
- [ ] Open DevTools (F12)
- [ ] Click Generate button
- [ ] See "Connecting..." state
- [ ] See quota bar fill
- [ ] See timer count down
- [ ] See chapter log entries appear
- [ ] See "Complete!" message
- [ ] Close DevTools
- [ ] Verify component is responsive
- [ ] Test on mobile device/emulator
```

---

## Expected Behavior

### Happy Path: Successful Generation (5 pages)

```
User Action         → App Response
─────────────────────────────────
Click "Generate"    → Quota bar: 0%, Timer: 10:00, Spinner
                      Chapter log: empty

Wait ~2.5s          → Quota bar: 5%, Chapter log: ✓ structure (2.4s)
Wait ~2s each       → Quota bar: 10%, Chapter log: ✓ chapter-1 (1.9s)
                      Quota bar: 15%, Chapter log: ✓ chapter-2 (1.8s)
                      Quota bar: 20%, Chapter log: ✓ chapter-3 (1.9s)
                      Quota bar: 25%, Chapter log: ✓ chapter-4 (1.9s)
                      Quota bar: 30%, Chapter log: ✓ chapter-5 (1.8s)

Wait ~1s            → Quota bar: 30%, Timer: ~9:45 (counts down)
                      Chapter log: All 6 entries complete

Completion          → "Complete!" message
                      onComplete callback called
                      User can download ebook
```

### Error Path: API Quota Exceeded

```
User Action         → App Response
─────────────────────────────────
Click "Generate"    → Quota bar: 0%, Timer: 10:00

Wait ~2.5s          → Quota bar: 5%, Chapter log: ✓ structure
Wait ~2s            → Quota bar: 10%, Chapter log: ✓ chapter-1

Quota exceeded      → ⏳ chapter-2 (deferred, retry in 120000ms)
                      Quota bar: stops at 15%
                      WARNING: ⚠️ High quota pressure

CallManager retries → ⏳ chapter-2 → ✓ chapter-2 (after retry delay)

Continues           → Quota bar: 20%, Chapter log: ✓ chapter-3, etc.
```

### Warning Path: Running Low on Time

```
~7s into generation (of ~13s total)
↓
time-tight event fires (>80% of budget used)
↓
Timer display changes: Yellow → Orange
↓
Shown: ⚠️ "High time pressure"
↓
If continues to >90%: Orange → Red, "Critical time pressure"
↓
If exceeds deadline: Error event fires
```

---

## Performance Expectations

| Metric                | Expected                 |
| --------------------- | ------------------------ |
| Initial response      | <100ms                   |
| Event latency         | <50ms                    |
| UI update             | <100ms                   |
| Event frequency       | ~40-50 events/generation |
| Total generation time | 30-60 seconds            |
| Bandwidth             | ~50-100KB                |
| Memory                | ~1-2MB per component     |

---

## Next Steps After Integration

### Phase 3a: Manual Testing (1-2 hours)

1. Desktop testing
2. Mobile testing
3. Error scenario testing
4. Load testing

### Phase 3b: Unit Tests (2-3 hours)

1. Component mount/unmount
2. Event parsing
3. State updates
4. Callback firing

### Phase 3c: Integration Tests (2-3 hours)

1. Full SSE flow
2. Backend integration
3. Real Gemini API calls

### Phase 3d: E2E Tests (2-3 hours)

1. Browser automation (Playwright)
2. Real user flow
3. Multiple concurrent generations

---

## Files Involved

| File                                                | Change                   | Status  |
| --------------------------------------------------- | ------------------------ | ------- |
| `client/src/App.svelte`                             | Import + wire component  | ⏳ TODO |
| `client/src/components/EbookProgressTracker.svelte` | New component            | ✅ DONE |
| `server/index.js`                                   | New SSE endpoint         | ✅ DONE |
| `server/ebookService.js`                            | Accept CallManager param | ✅ DONE |
| `server/__tests__/ebookService.progress.test.js`    | Test suite outline       | ✅ DONE |

---

## Quick Reference: Component Props & Callbacks

```javascript
// Import
import EbookProgressTracker from "./components/EbookProgressTracker.svelte";

// Use
<EbookProgressTracker
  url="/api/ebook/generate-with-progress?prompt=Test&pageCount=5"
  onComplete={({ totalCalls, totalTime, success }) => {
    console.log(`✓ Generated ${totalCalls} calls in ${totalTime}ms`);
  }}
  onError={({ code, message, isRetriable }) => {
    console.error(`✗ ${code}: ${message} (retriable: ${isRetriable})`);
  }}
/>;

// Component displays:
// - Quota bar (% of 20 calls used)
// - Time countdown (MM:SS format)
// - Current operation (spinning indicator)
// - Chapter log (✓ complete, ⏳ deferred)
// - Error message (if fatal error)
```

---

## Summary

| Step      | Time            | Action                                                       |
| --------- | --------------- | ------------------------------------------------------------ |
| 1         | 2m              | Import EbookProgressTracker in App.svelte                    |
| 2         | 2m              | Add reactive variables (showProgressTracker, sseEndpointUrl) |
| 3         | 5m              | Wire generate button to SSE endpoint                         |
| 4         | 2m              | Add component to template                                    |
| 5         | 5m              | Manual test (desktop + DevTools)                             |
| 6         | 5m              | Mobile test + error scenario test                            |
| **Total** | **~21 minutes** | **Full integration**                                         |

**Ready to begin Phase 3? Follow the Quick Start section above! ⭐**

---

_Generated: 2025-12-10_  
_Branch: feat/patience-timer-sequential_  
_Status: Phase 1-2 complete, Phase 3 integration ready_
