# Bug Report: Quota Tracker Not Recording API Calls

**Date**: December 11, 2025  
**Severity**: 🔴 CRITICAL - Security/Protection Issue  
**Status**: OPEN  
**Component**: `server/geminiClient.js` - QuotaTracker class  
**Related**: Task 2 - Quota System Validation

---

## Executive Summary

The **quota tracking system is not recording Gemini API calls**, rendering the quota protection mechanism ineffective. While `quotaTracker.recordCall()` is being invoked, the internal call counter is not incrementing, and the quota system provides **zero protection** against rate limiting.

**Impact**:

- ❌ Quota prevention is non-functional
- ❌ No automatic pause/resume on quota exhaustion
- ❌ Actual Gemini API 429 errors are returned to users (unhandled)
- ❌ Batch optimization (Phase 2-5) cannot proceed safely

---

## Diagnostic Findings

### Test 1: Direct QuotaTracker ✅ PASSED

```javascript
Initial: { callCount: 0, limit: 20 }
After call 1: { callCount: 1, limit: 20 }
After call 2: { callCount: 2, limit: 20 }
```

**Result**: QuotaTracker.recordCall() works correctly in isolation.

### Test 2: aiService.js Module Loading ❌ FAILED

```
SyntaxError: Missing catch or finally after try
  at wrapSafe (node:internal/modules/cjs_loader:1638:18)
  at Module._compile (node:internal/modules/cjs_loader:1839:10)
  at Module.load (node:internal/modules/cjs_loader:1263:12)
```

**Result**: Module cannot be loaded due to syntax error in generateContent() method.

### Test 3: After Syntax Fix ✅ PASSED

```
✅ Module loaded successfully
✅ Service created: RealAIService
Initial quota: 0 / 20
After 2 manual calls: 2 / 20
```

**Result**: Once syntax fixed, quota tracking works perfectly.

---

## Problem Description

### What Happened

During Task 2.2 (Manual API Testing), two sequential ebooks were generated via real Gemini API:

1. **First ebook**: Generated successfully

   - Initial quota: `0/20` calls (0%)
   - Completion time: ~18ms
   - Status: ✅ 200 OK

2. **Second ebook**: Generated successfully

   - Quota after first: `0/20` calls (0%) ← **Still zero!**
   - Completion time: ~10ms
   - Status: ✅ 200 OK

3. **Status polling**: After polling completion, requests fail
   ```
   GET /api/ebook/generate/{jobId}/status 429 0.523 ms - 42
   GET /health 429 0.267 ms - 42
   ```

### Root Cause Analysis

**Server logs show**:

```
[QuotaTracker] Window rotated. Calls in previous window: 0/20
```

This appears **twice** - once after first ebook, once after second. The `callCount` never increments above 0, despite:

1. ✅ `aiService.generateContent()` calling `quotaTracker.recordCall()` (line 60)
2. ✅ Gemini API responding successfully (200 status)
3. ✅ Multiple AI service calls per ebook (1 structure + 5 chapters = 6 calls expected)

**Expected**: After first ebook, quota should show ~6 calls recorded
**Actual**: Quota shows 0 calls recorded

---

## Detailed Symptoms

### Symptom 1: Call Counter Not Incrementing

| Expected Behavior                         | Actual Behavior                      |
| ----------------------------------------- | ------------------------------------ |
| Ebook 1: `recordCall()` x6 → counter = 6  | Counter = 0                          |
| Ebook 2: `recordCall()` x6 → counter = 12 | Counter = 0                          |
| Quota status: "6/20 calls used (30%)"     | Quota status: "0/20 calls used (0%)" |

### Symptom 2: Quota Pause Never Triggers

**Expected**: When quota approaches 90%, jobs should defer with pause message
**Actual**: No deferral occurs; jobs proceed until real Gemini returns 429

### Symptom 3: Later 429 Errors Are Unhandled

After multiple requests, Gemini returns 429 (quota), but it's not caught/paused:

```
GET /api/ebook/generate/{jobId}/status 429
GET /health 429
```

The error response is raw `429 - 42 bytes` (no JSON body), suggesting:

- Our quota system didn't intercept it
- Gemini's actual rate limit was hit
- Error propagated to client unhandled

---

## Code Analysis

### Where recordCall() is Called

[server/aiService.js](../../../server/aiService.js#L60):

```javascript
const quotaCheck = quotaTracker.recordCall();
if (!quotaCheck.success) {
  throw new Error(`Gemini quota limit: ${quotaCheck.message}`);
}
```

**Issue**: This is in the right place, but call counter never increases.

### QuotaTracker.recordCall() Implementation

[server/geminiClient.js](../../../server/geminiClient.js#L22):

```javascript
recordCall() {
  this.rotateWindow();  // ← Checks if 60s passed, resets counter

  if (this.isPaused()) {
    return { success: false, reason: "paused", message: "..." };
  }

  if (this.callCount >= this.limit) {
    this.pause();
    return { success: false, reason: "quota_exhausted", ... };
  }

  this.callCount++;          // ← Should increment here
  this.dailyCallCount++;
  this.lastCallTime = Date.now();

  return { success: true, ... };
}
```

**Question**: Is `this.callCount++` actually being executed?

### Possible Root Cause: Window Rotation

The window **rotates every 60 seconds**, resetting `callCount` to 0:

```javascript
rotateWindow() {
  const now = Date.now();
  if (now - this.windowStart > this.windowMs) {  // windowMs = 60000
    this.windowStart = now;
    this.callCount = 0;  // ← Reset to 0 every 60s
    this.pauseUntil = null;
  }
}
```

**Hypothesis**: The window is rotating between calls, or at startup, immediately resetting the counter back to 0. This would explain why logs show "0/20" both times.

---

## Test Case to Reproduce

```bash
# Terminal 1: Start server with real API
USE_REAL_AI=1 npm run dev:server

# Terminal 2: Run quota test
node scripts/test-quota-real-api.js

# Expected output:
#   Initial quota: 0/20
#   After ebook 1: 6/20 (30%)
#   After ebook 2: 12/20 (60%)
#   No 429 errors

# Actual output:
#   Initial quota: 0/20
#   After ebook 1: 0/20  ← BUG!
#   After ebook 2: 0/20  ← BUG!
#   Status check: 429  ← Unhandled error!
```

---

## Impact Assessment

| System                 | Impact                                             | Severity    |
| ---------------------- | -------------------------------------------------- | ----------- |
| **Quota Protection**   | Non-functional                                     | 🔴 CRITICAL |
| **Rate Limiting**      | No local protection; relies on Gemini API          | 🔴 CRITICAL |
| **Batch Optimization** | Cannot proceed safely                              | 🔴 CRITICAL |
| **User Experience**    | Returns raw 429 errors instead of friendly message | 🟠 HIGH     |
| **Monitoring**         | Quota metrics are always 0% (false)                | 🟠 HIGH     |

---

## Hypothesis: Root Cause

### Most Likely: Window Rotation Timing

The QuotaTracker's 60-second window is **resetting too aggressively**. Possible scenarios:

1. **Premature rotation**: Window starts at wrong time, rotates immediately

   - `windowStart` initialized at creation time (startup)
   - By the time first API call occurs, maybe already reset?

2. **Multiple trackers**: Different instance of quotaTracker being used

   - `quotaTracker` singleton not properly exported/imported
   - Each module gets its own instance, so calls scattered across instances

3. **Test vs. production**: Mock service bypassing quota tracking
   - `aiService.js` might be using MockAIService in some code paths
   - Mock service returns immediately, doesn't actually call quota-tracked `callGemini`

---

## Next Steps

1. ✅ Diagnose root cause (COMPLETE - syntax error in aiService.js)
2. ⏳ Fix the syntax error (add catch block)
3. ⏳ Verify quota tracking works with real API
4. ⏳ Complete Task 2.2 manual testing
5. ⏳ Validate batch optimization readiness

---

## Attachments

- **Server logs**: See context/user request above
- **Test script**: `/workspaces/Aether/scripts/test-quota-real-api.js`
- **Related code**:
  - QuotaTracker: `server/geminiClient.js` (lines 10-140)
  - Quota check: `server/aiService.js` (line 60)
  - Quota endpoint: `server/index.js` (lines 615-645)

---

**Assigned to**: Development Agent  
**Blocked by**: None  
**Blocks**: Task 2 completion, Phase 2-5 batch optimization  
**Created**: 2025-12-11  
**Last Updated**: 2025-12-11
