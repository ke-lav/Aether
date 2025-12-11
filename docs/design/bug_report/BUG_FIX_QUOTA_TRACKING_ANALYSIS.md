# Bug Fix Analysis: Quota Tracking Call Counter Not Incrementing

**Date**: December 11, 2025  
**Related Bug**: BUG_QUOTA_TRACKING_NOT_RECORDING_CALLS.md  
**Status**: ANALYSIS IN PROGRESS

---

## Investigation Plan

### Phase 1: Verify the Bug

#### Test 1: Direct QuotaTracker Usage

Create a minimal test that directly calls `quotaTracker.recordCall()` without any other code:

```javascript
const { quotaTracker } = require("./server/geminiClient");

console.log("Initial:", quotaTracker.getStatus());

for (let i = 0; i < 5; i++) {
  const result = quotaTracker.recordCall();
  console.log(`Call ${i + 1}:`, result);
}

console.log("Final:", quotaTracker.getStatus());
```

**Expected**: `callCount` should go from 0 → 5  
**If fails**: QuotaTracker itself is broken

#### Test 2: aiService Integration

Test if `aiService.generateContent()` properly invokes quota tracking:

```javascript
const aiService = require("./server/aiService");

// With USE_REAL_AI=1, should call real Gemini
const result = await aiService.generateContent("Hello");
console.log("After call, quota:", getQuotaStatus());
```

**Expected**: `callCount` should increment  
**If fails**: aiService not passing through to quota tracker

#### Test 3: Singleton Check

Verify that `quotaTracker` is truly a singleton:

```javascript
const gc1 = require("./server/geminiClient");
const gc2 = require("./server/geminiClient");

console.log("Same instance?", gc1.quotaTracker === gc2.quotaTracker);
console.log("Object ID 1:", gc1.quotaTracker);
console.log("Object ID 2:", gc2.quotaTracker);
```

**Expected**: Both references should be identical (singleton pattern)  
**If fails**: Multiple instances explain why counts aren't tracking

---

### Phase 2: Diagnose Root Cause

#### Hypothesis 1: Window Rotation Bug

**Theory**: The 60-second window is resetting immediately or too frequently

**Investigation**:

1. Add logging to `rotateWindow()`:

```javascript
rotateWindow() {
  const now = Date.now();
  const elapsed = now - this.windowStart;
  const shouldRotate = elapsed > this.windowMs;

  console.log(`[rotateWindow] elapsed=${elapsed}ms, windowMs=${this.windowMs}, shouldRotate=${shouldRotate}`);

  if (shouldRotate) {
    console.log(`[rotateWindow] ROTATING! Previous calls: ${this.callCount}/${this.limit}`);
    this.windowStart = now;
    this.callCount = 0;
    this.pauseUntil = null;
  }
}
```

2. Run test and check if rotation happens unexpectedly
3. Check `windowStart` initialization time vs. first `recordCall()` time

#### Hypothesis 2: Multiple Tracker Instances

**Theory**: Different parts of code use different QuotaTracker instances

**Investigation**:

1. Search for all `require('./geminiClient')` in codebase:

```bash
grep -r "require.*geminiClient" server/
```

2. Check if geminiClient exports are consistent:

```bash
grep -A5 "module.exports" server/geminiClient.js
```

3. Verify aiService gets quotaTracker correctly:

```javascript
// In aiService.generateContent():
console.log("quotaTracker object:", quotaTracker);
console.log("quotaTracker.callCount before:", quotaTracker.callCount);
const result = quotaTracker.recordCall();
console.log("quotaTracker.callCount after:", quotaTracker.callCount);
```

#### Hypothesis 3: Mock Service Bypass

**Theory**: Code is using MockAIService instead of real service, bypassing quota

**Investigation**:

1. Check which service is being used during test:

```bash
# Search for which service gets selected
grep -n "MockAIService\|RealAIService\|new AIService" server/*.js
```

2. In aiService initialization, verify USE_REAL_AI is respected:

```javascript
const forceMock =
  process.env.FORCE_MOCK_AI === "1" || process.env.FORCE_MOCK_AI === "true";
if (forceMock) {
  console.log("Using MockAIService - QUOTA NOT TRACKED");
  return new MockAIService();
}

const useReal =
  process.env.USE_REAL_AI === "1" || process.env.USE_REAL_AI === "true";
if (!useReal) {
  console.log(
    "USE_REAL_AI not set - defaulting to MockAIService - QUOTA NOT TRACKED"
  );
  return new MockAIService();
}
```

---

## Diagnostic Strategy

### Step 1: Add Comprehensive Logging

Modify `server/geminiClient.js` to log every important action:

```javascript
recordCall() {
  console.log(`[QUOTA] recordCall() invoked. Current count: ${this.callCount}/${this.limit}`);

  this.rotateWindow();
  console.log(`[QUOTA] After window check, count: ${this.callCount}/${this.limit}`);

  if (this.isPaused()) {
    console.log(`[QUOTA] PAUSED - returning failure`);
    return { success: false, ... };
  }

  if (this.callCount >= this.limit) {
    console.log(`[QUOTA] QUOTA EXHAUSTED - pausing`);
    this.pause();
    return { success: false, ... };
  }

  this.callCount++;
  console.log(`[QUOTA] Incremented to ${this.callCount}/${this.limit}`);

  return { success: true, ... };
}

getStatus() {
  console.log(`[QUOTA] getStatus() called. Current: ${this.callCount}/${this.limit}`);
  // ... rest of logic
}
```

### Step 2: Run Diagnostic Tests

1. **Direct QuotaTracker test** (no network calls)

   - Verify `recordCall()` increments counter
   - Verify window rotation timing
   - Verify singleton pattern

2. **aiService test** (with mock)

   - Use MockAIService (doesn't require API key)
   - Verify quota tracker is called
   - Check call counts

3. **Full integration test** (with real API)
   - Generate one ebook
   - Poll quota-status between calls
   - Verify counters increment

### Step 3: Identify Fix

Based on diagnostic results, implement fix in one of these areas:

| If Issue Found In      | Fix Location                     | Severity    |
| ---------------------- | -------------------------------- | ----------- |
| Window rotation logic  | `rotateWindow()` method          | 🔴 CRITICAL |
| Singleton pattern      | `module.exports` in geminiClient | 🔴 CRITICAL |
| Service initialization | `aiService.js` service selection | 🟠 HIGH     |
| Event/async timing     | `recordCall()` invocation timing | 🔴 CRITICAL |

---

## Expected Outcomes

### Before Fix

- QuotaTracker callCount always shows 0
- No quota protection (system relies on Gemini's 429)
- Later requests hit raw 429 errors
- Logs show: "Calls in previous window: 0/20"

### After Fix

- QuotaTracker callCount increments per API call
- First ebook: 6 calls recorded (structure + 5 chapters)
- Second ebook: 12 calls total (quota at 60%)
- Job deferral works when approaching 90%
- No raw 429 errors (caught by our quota system)
- Logs show: "Calls in previous window: 6/20"

---

## Testing Requirements

### Unit Test

```javascript
it("should track Gemini API calls", () => {
  const tracker = new QuotaTracker(20, 60000);

  expect(tracker.callCount).toBe(0);

  const result1 = tracker.recordCall();
  expect(result1.success).toBe(true);
  expect(tracker.callCount).toBe(1);

  const result2 = tracker.recordCall();
  expect(result2.success).toBe(true);
  expect(tracker.callCount).toBe(2);
});
```

### Integration Test

```javascript
it("should track calls through aiService", async () => {
  const tracker = getQuotaStatus();
  const initialCount = tracker.callCount;

  await aiService.generateContent("Test prompt");

  const afterCount = getQuotaStatus().callCount;
  expect(afterCount).toBeGreaterThan(initialCount);
});
```

### Manual Test

```bash
# Terminal: Monitor quota in real-time
watch -n 1 'curl -s http://localhost:3000/api/quota-status | jq .quota'

# Terminal: Generate ebook
curl -X POST http://localhost:3000/api/ebook/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Test"}'

# Expected: Watch quota-status callCount increment in real-time
```

---

## Timeline

| Phase     | Task                              | Duration    | Dependency |
| --------- | --------------------------------- | ----------- | ---------- |
| 1         | Add diagnostic logging            | 15 min      | None       |
| 2         | Run direct QuotaTracker test      | 10 min      | Phase 1    |
| 3         | Run aiService test (mock)         | 10 min      | Phase 1    |
| 4         | Run full integration test         | 10 min      | Phase 1    |
| 5         | Analyze logs, identify root cause | 20 min      | Phase 2-4  |
| 6         | Implement fix                     | 30 min      | Phase 5    |
| 7         | Verify fix works                  | 20 min      | Phase 6    |
| **TOTAL** |                                   | **2 hours** |            |

---

## Risk Assessment

**Risk**: This bug blocks entire Phase 2-5 (batch optimization)  
**Impact**: Cannot safely scale API usage without quota protection  
**Mitigation**: Identify and fix before proceeding to Phase 2  
**Fallback**: Revert to mock API if fix takes too long

---

**Status**: Ready for Phase 1 (diagnostic logging)  
**Next**: BUG_FIX_QUOTA_TRACKING_IMPLEMENTATION.md (once root cause identified)
