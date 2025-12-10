# Bug Report: Phase 4 Test Failure - SSE Endpoint 404 Error

**Status**: 🔴 OPEN  
**Severity**: 🔴 CRITICAL  
**Date Opened**: 2025-12-10  
**Phase**: Phase 4: Manual Testing  
**Branch**: `feat/patience-timer-sequential`

---

## Executive Summary

During Phase 4 manual testing (Happy Path: 3-Page Generation), the SSE endpoint `/api/ebook/generate-with-progress` returns **404 Not Found** when requested by the frontend. This blocks all progress tracking functionality and prevents ebook generation from completing.

**Root Cause (Suspected)**: HTTP method mismatch

- Server endpoint registered for: **POST**
- Frontend client (EventSource) sends: **GET** (only option available in browser API)

---

## Test Case Failure Details

### Test Case: Happy Path - 3-Page Generation

- **Duration**: Should be ~15-20 seconds
- **Status**: ❌ FAIL
- **Expected**: Progress tracker displays real-time events
- **Actual**: Connection stays on "Connecting to generation stream..." indefinitely

### Steps to Reproduce

1. Start development environment:

   ```bash
   # Terminal 1
   cd server && npm start

   # Terminal 2
   cd client && npm run dev
   ```

2. Open browser: `https://upgraded-acorn-pj5pvrqp74p4crxv5-5173.app.github.dev`

3. Navigate to ebook mode

4. Enter prompt: "A short children's story about a brave mouse"

5. Set page count to 3

6. Click "Generate eBook"

7. Observe: UI shows "Connecting to generation stream..." and never connects

---

## Error Evidence

### Browser Console Errors

```
Firefox can't establish a connection to the server at
https://upgraded-acorn-pj5pvrqp74p4crxv5-5173.app.github.dev/api/ebook/generate-with-progress?prompt=A+short+children%27s+story+about+a+brave+mouse&theme=light&pageCount=3&fontSizeScale=1.0

[Progress] Failed to parse error event: Error: Connection lost
    connect https://upgraded-acorn-pj5pvrqp74p4crxv5-5173.app.github.dev/src/components/EbookProgressTracker.svelte:202
EbookProgressTracker.svelte:177:19
    connect EbookProgressTracker.svelte:177
```

### Server Logs

```
[1] GET /health 200 27.749 ms - 291
[1] GET /api/ebook/generate-with-progress?prompt=A+short+children%27s+story+about+a+brave+mouse&theme=light&pageCount=3&fontSizeScale=1.0 404 0.757 ms - 58
[1] GET /health 200 34.359 ms - 291
[1] GET /health 200 29.008 ms - 291
```

**Key Observation**: Server logs show:

- ✅ Request was received
- ✅ Query parameters arrived intact
- ✅ Explicit 404 response (58 bytes = error message)
- ❌ No server-side endpoint handling (404 = not found)

### DevTools Network Tab

| Request                           | Method | Status  | URL      |
| --------------------------------- | ------ | ------- | -------- |
| /health                           | GET    | 200     | ✅ Works |
| /api/ebook/generate-with-progress | GET    | **404** | ❌ Fails |

---

## Architectural Analysis

### Server-Side: Endpoint Definition

**File**: `server/index.js` (line ~3269)

```javascript
/**
 * POST /api/ebook/generate-with-progress
 * Initiate ebook generation with real-time progress tracking via Server-Sent Events (SSE)
 */
app.post("/api/ebook/generate-with-progress", async (req, res) => {
  // Expects request body:
  const { prompt, theme, pageCount, ... } = req.body;

  // ... SSE response handling
})
```

**Issue**: Endpoint registered **only for POST**

### Frontend-Side: SSE Connection

**File**: `client/src/components/EbookProgressTracker.svelte` (line ~73)

```javascript
function connect() {
  // Builds URL with query parameters
  const url = `/api/ebook/generate-with-progress?prompt=...&theme=...&pageCount=3&...`;

  // EventSource ALWAYS sends GET (only browser API option available)
  eventSource = new EventSource(url);

  // ... event listeners
}
```

**Issue**: EventSource API **only supports GET requests**. No option for POST.

### The Mismatch

```
Server Configuration:    app.post("/api/ebook/generate-with-progress")
                              ↓
                         Expects POST request with body

Frontend Implementation: new EventSource(url)
                              ↓
                         Always sends GET request
                         Cannot be configured otherwise

Result: GET request → No matching POST route → 404 Not Found
```

---

## Root Cause Analysis

### Why This Happened

1. **Design Phase**: Endpoint designed for POST (body parameters)

   - Makes sense for traditional REST API
   - Allows structured data in request body

2. **Implementation Phase**: Frontend implemented with EventSource

   - EventSource is correct choice for SSE
   - But EventSource **only supports GET** in browser API
   - No way to configure HTTP method

3. **Integration Gap**: HTTP method mismatch was not caught in code review
   - Server expects POST body
   - Client sends GET query parameters
   - Incompatible protocols

### Protocol Constraints

#### Server-Sent Events (SSE) Standard

```javascript
// Browser EventSource API (MDN standard)
const eventSource = new EventSource(url);
// ✅ Supports: GET requests
// ✅ Supports: URL query parameters
// ✅ Supports: Custom headers (with credentials)
// ❌ Does NOT support: POST requests
// ❌ Does NOT support: Request body
// ❌ Does NOT support: Custom HTTP methods
```

The EventSource API in browser is **inherently limited to GET**.

#### Server Express.js Implementation

```javascript
// Express routing
app.post("/path", handler); // ✅ Matches POST
app.get("/path", handler); // ✅ Matches GET
app.all("/path", handler); // ✅ Matches any method
```

---

## Impacted Components

### Direct Impact

| Component                         | Status            | Issue                             |
| --------------------------------- | ----------------- | --------------------------------- |
| EbookProgressTracker.svelte       | ❌ Non-functional | Cannot connect to SSE             |
| /api/ebook/generate-with-progress | ❌ Unreachable    | GET requests return 404           |
| App.svelte integration            | ❌ Non-functional | Progress tracker never connects   |
| Phase 4 Manual Testing            | ❌ Blocked        | All test cases fail at connection |

### Downstream Impact

- Phase 5: Unit Tests (blocked waiting for endpoint fix)
- Phase 6: E2E Testing (blocked)
- Phase 7: Performance Testing (blocked)
- User Testing (blocked)

---

## Solution Options

### Option A: Change Endpoint to GET ⭐ RECOMMENDED

**Scope**: Server-side only, no frontend changes needed

**Changes Required**:

1. Change endpoint registration from POST to GET
2. Read parameters from `req.query` instead of `req.body`
3. Validate all parameters from query string

**Code Change**:

```javascript
// Before:
app.post("/api/ebook/generate-with-progress", async (req, res) => {
  const { prompt, theme, pageCount, ... } = req.body;

// After:
app.get("/api/ebook/generate-with-progress", async (req, res) => {
  const { prompt, theme, pageCount, ... } = req.query;
```

**Pros**:

- ✅ Minimal code changes (1-2 lines per parameter)
- ✅ Matches EventSource API capabilities
- ✅ Query parameters already in URL
- ✅ No frontend changes needed
- ✅ Faster response time (no body parsing)

**Cons**:

- ⚠️ GET requests should not modify server state (violation of REST principles)
- ⚠️ But SSE is inherently stateful (starts generation process)
- ⚠️ Query string length limits (but 3KB should be sufficient for our params)

**Assessment**: ✅ Best practical solution given browser API constraints

---

### Option B: Register for Both GET and POST

**Scope**: Server-side only

**Code Change**:

```javascript
app.all("/api/ebook/generate-with-progress", async (req, res) => {
  const params = req.method === 'GET' ? req.query : req.body;
  const { prompt, theme, pageCount, ... } = params;
  // ... rest same
```

**Pros**:

- ✅ Backward compatible (if any POST callers exist)
- ✅ Supports both protocols

**Cons**:

- ⚠️ Slightly more complex logic
- ⚠️ Unclear which method to use in future

**Assessment**: ⚠️ Over-engineering; GET is correct solution

---

### Option C: Use Alternative SSE Library

**Scope**: Frontend replacement

**Example**: Use `eventsource` polyfill or custom implementation

**Cons**:

- ❌ Still can't send POST requests (browser security)
- ❌ Adds dependency
- ❌ More complex frontend code
- ❌ Not recommended

**Assessment**: ❌ Doesn't solve the fundamental problem

---

### Option D: Implement Custom WebSocket

**Scope**: Redesign frontend and backend

**Cons**:

- ❌ Major refactor required
- ❌ Loss of SSE benefits (simpler, HTTP-based)
- ❌ Requires more infrastructure

**Assessment**: ❌ Overkill; SSE is correct choice if endpoint is GET

---

## Recommended Fix

### Primary Solution: Option A (GET Endpoint)

1. **Change endpoint registration**:

   - File: `server/index.js` (line ~3269)
   - Change: `app.post(...)` → `app.get(...)`

2. **Update parameter reading**:

   - Change: `req.body` → `req.query` for all parameters
   - Affected lines: ~3275-3340 (parameter extraction)

3. **Update validation logic**:

   - Ensure `pageCount = parseInt(req.query.pageCount, 10)`
   - Ensure `fontSizeScale = parseFloat(req.query.fontSizeScale)`
   - Keep same validation rules

4. **No frontend changes needed**:
   - EbookProgressTracker.svelte works as-is
   - App.svelte works as-is
   - URL building works as-is

### Implementation Checklist

- [ ] Change endpoint from POST to GET
- [ ] Update parameter reading from req.body to req.query
- [ ] Verify all parameters parsed correctly
- [ ] Test with manual browser request
- [ ] Test with EventSource client
- [ ] Verify server logs show 200 (not 404)
- [ ] Run Phase 4 test cases again

---

## Testing Strategy

### Unit Test (Quick Verification)

```javascript
// In DevTools console, after server is running:
const url =
  "/api/ebook/generate-with-progress?prompt=test&theme=light&pageCount=3&fontSizeScale=1.0";
const es = new EventSource(url);

es.addEventListener("quota-update", (e) => {
  console.log("✅ Received:", e.data);
  es.close();
});

es.onerror = (err) => {
  console.error("❌ Error:", err);
};

// Expected: See "✅ Received:" within 1-2 seconds
// Actual (before fix): See "❌ Error:" immediately
```

### Integration Test (After Fix)

Rerun Phase 4 Happy Path test case:

1. Enter prompt
2. Set page count to 3
3. Click "Generate eBook"
4. Verify: Progress tracker connects and shows events
5. Verify: Timer counts down
6. Verify: Chapter log fills in
7. Verify: Completion message appears in <20 seconds

---

## Related Issues

- Phase 1 Endpoint: `/api/ebook/generate-with-progress` designed for POST
- Phase 2 Component: EbookProgressTracker.svelte uses GET (EventSource)
- Phase 3 Integration: App.svelte builds GET URL
- No code review caught the mismatch

---

## References

### Browser API Documentation

- [MDN: EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
  - "The EventSource interface is web content's interface to server-sent events."
  - "Always uses GET"

### Server-Sent Events Standard

- [W3C SSE Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [MDN: Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)

### Design Documents

- `docs/PATIENCE_TIMER_BUILD_STAGE_3_DESIGN.md` (Phase 1: Backend endpoint)
- `docs/PATIENCE_TIMER_NEXT_STEPS.md` (Phase 4: Testing requirements)

---

## Timeline

| Date       | Event                                 |
| ---------- | ------------------------------------- |
| 2025-12-10 | Phase 4 testing started               |
| 2025-12-10 | Happy Path test case failed           |
| 2025-12-10 | Issue diagnosed: HTTP method mismatch |
| 2025-12-10 | Bug report created                    |
| TBD        | Fix implemented                       |
| TBD        | Phase 4 testing resumed               |
| TBD        | Phase 4 completed                     |

---

## Sign-Off

**Bug Reported By**: Phase 4 Manual Testing  
**Analyzed By**: Architecture Review  
**Status**: 🔴 OPEN - Awaiting Fix Implementation

---

## Next Steps

1. ✅ Review this bug report
2. ⬜ Implement Option A (GET endpoint)
3. ⬜ Test with manual EventSource request
4. ⬜ Run Phase 4 test cases again
5. ⬜ Update PHASE_4_TEST_RESULTS.md with fix
6. ⬜ Commit fix to branch
7. ⬜ Continue with remaining Phase 4 tests
