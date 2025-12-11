# Bug Fix Implementation: Quota Tracking Call Counter Not Incrementing

**Date**: December 11, 2025  
**Related Bug**: BUG_QUOTA_TRACKING_NOT_RECORDING_CALLS.md  
**Analysis**: BUG_FIX_QUOTA_TRACKING_ANALYSIS.md  
**Status**: PENDING ANALYSIS RESULTS

---

## Overview

This document will contain the implementation steps once the root cause is identified through the analysis phase. Currently, three main hypotheses exist:

1. **Window rotation bug** - 60-second window resetting too aggressively
2. **Singleton pattern break** - Multiple QuotaTracker instances
3. **Mock service bypass** - Real service not being used

---

## Placeholder: Hypothesis-Based Fixes

Once analysis identifies the root cause, implement one of these fixes:

### Fix Option A: Window Rotation Bug (Most Likely)

**Location**: `server/geminiClient.js` - `rotateWindow()` method

**Problem**: Window may be resetting incorrectly or too frequently

**Solution**:

- Verify `windowStart` is initialized correctly
- Ensure rotation only happens after 60 seconds of inactivity
- Add guard to prevent rotation during active API calls
- Test with logging to confirm timing

**Implementation**: [To be filled after analysis]

### Fix Option B: Singleton Pattern Break

**Location**: `server/geminiClient.js` - exports and `server/aiService.js` - import

**Problem**: Multiple QuotaTracker instances may exist, call counts scattered

**Solution**:

- Ensure only one QuotaTracker instance is created (singleton)
- Verify all code paths use same exported instance
- Use Node.js module caching to guarantee singleton

**Implementation**: [To be filled after analysis]

### Fix Option C: Mock Service Bypass

**Location**: `server/aiService.js` - service selection logic

**Problem**: Code may be using MockAIService, which doesn't call quota-tracked API

**Solution**:

- Verify USE_REAL_AI=1 is set and respected
- Ensure MockAIService is never used during test
- Add guards to prevent mock fallback

**Implementation**: [To be filled after analysis]

---

## Diagnostic Results

### Phase 1: Logging Added ✏️

Add to `server/geminiClient.js`:

```javascript
// [IMPLEMENTATION PENDING]
```

### Phase 2: Direct QuotaTracker Test ✏️

Result: [PENDING]

### Phase 3: aiService Integration Test ✏️

Result: [PENDING]

### Phase 4: Full Integration Test ✏️

Result: [PENDING]

### Phase 5: Root Cause Identified ✏️

**Identified as**: [PENDING - One of: Window Rotation, Singleton, Mock Bypass]

---

## Implementation Steps

### Step 1: Confirm Root Cause

[PENDING - After diagnostic phase]

### Step 2: Implement Fix

[PENDING - Specific to identified root cause]

### Step 3: Verify Fix

[PENDING - Test with real API]

### Step 4: Commit & Push

```bash
git add server/geminiClient.js [other files]
git commit -m "fix: Resolve quota tracking call counter not incrementing

- [Root cause identified]
- [Fix description]
- Verified with real Gemini API
- quotaTracker.callCount now increments properly
- Quota system provides full protection"

git push origin feat/revert-original
```

---

## Success Criteria

Once fix is implemented and tested:

✅ QuotaTracker `callCount` increments on each Gemini API call  
✅ First ebook: quota shows ~6/20 (30%)  
✅ Second ebook: quota shows ~12/20 (60%)  
✅ When quota > 90%: jobs defer with pause message  
✅ No raw 429 errors returned to client (caught by quota system)  
✅ Server logs show: "Calls in previous window: X/20" where X > 0  
✅ All tests passing (existing quota tests)  
✅ Frontend displays quota percentage correctly

---

## Testing Plan

### Unit Tests

- Verify QuotaTracker increments correctly
- Verify window rotation timing
- Verify pause/resume logic

### Integration Tests

- Verify quota tracking through aiService
- Verify quota tracking through ebookService
- Verify job deferral at 90%

### Manual Tests

```bash
# Start server with real API
USE_REAL_AI=1 npm run dev:server

# Monitor quota in real-time
watch -n 1 'curl -s http://localhost:3000/api/quota-status | jq .quota'

# Generate ebook and observe quota increment
node scripts/test-quota-real-api.js

# Expected: callCount goes from 0 → 6 → 12 (etc)
```

---

## Rollback Plan

If fix introduces new issues:

```bash
git revert <commit-hash>
git push origin feat/revert-original
```

---

## Timeline

| Phase          | Task                                 | Duration   | Status         |
| -------------- | ------------------------------------ | ---------- | -------------- |
| Analysis       | Run diagnostics, identify root cause | 2 hours    | ⏳ IN PROGRESS |
| Implementation | Code fix                             | 30 min     | ⏳ PENDING     |
| Testing        | Verify with real API                 | 20 min     | ⏳ PENDING     |
| Validation     | Task 2.2 manual test                 | 30 min     | ⏳ PENDING     |
| **TOTAL**      |                                      | ~3.5 hours |                |

---

## Dependencies

- ✅ BUG_QUOTA_TRACKING_NOT_RECORDING_CALLS.md (bug report)
- ⏳ BUG_FIX_QUOTA_TRACKING_ANALYSIS.md (diagnostic results)
- ⏳ Gemini API credentials (USE_REAL_AI=1)

---

## Sign-Off

**Analysis completed by**: [Pending]  
**Fix implemented by**: [Pending]  
**Reviewed by**: [Pending]  
**Approved for Task 2.2 completion**: [Pending]

---

**Next Step**: Complete diagnostic phase in BUG_FIX_QUOTA_TRACKING_ANALYSIS.md
