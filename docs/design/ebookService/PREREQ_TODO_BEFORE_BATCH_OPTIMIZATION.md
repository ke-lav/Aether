# Prerequisites TODO: Quota Management & Code Quality Before Batch Optimization

**Date**: December 6, 2025  
**Branch**: `feat/revert`  
**Purpose**: Document all blocking and quality issues that must be resolved before proceeding with Phase 2-5 (Batch Optimization)  
**Audience**: Development agents, engineers  
**Status**: Active - 23 items to complete

---

## Executive Summary

**Blocking Issue**: Gemini quota system has infinite recursion error preventing testing. Must fix Step 8 before finalizing Phase 1.

**Quality Issues**: Code review identified 7 maintainability concerns that should be addressed in this phase before scaling to batch optimization.

**Gate**: Batch optimization Phase 2-5 cannot proceed until:

1. ✅ Step 8 (Infinite Recursion) is fixed
2. ✅ Step 6 (Real API Testing) passes with fix
3. ✅ Deployment checklist items completed

**References**:

- Implementation details: `docs/design/ebookService/GEMINI_QUOTA_IMPLEMENTATION_GUIDE.md`
- Architecture patterns: `docs/design/ebookService/EBOOK_ARCHITECTURE_FINAL_RECAP.md`
- Batch optimization plan: `docs/design/ebookService/BATCH_OPTIMIZATION_UNIFICATION_STRATEGY.md`
- Code quality assessment: See "Code Quality Issues" section below

---

## Critical Blocker: Fix Infinite Recursion Error

### TASK 1: Fix getMessage() / getStatus() Circular Dependency

**Status**: 🔴 CRITICAL - Blocks all quota testing  
**File**: `server/geminiClient.js`  
**Impact**: HTTP 500 on all `/api/quota-status` calls  
**Time**: 15 minutes

**Problem**: `getStatus()` calls `getMessage()` which calls `getStatus()` → infinite recursion

**Solution** (see `GEMINI_QUOTA_IMPLEMENTATION_GUIDE.md` "Current Error Explanation" section for details):

1. Remove `message: this.getMessage()` from `getStatus()` return object (line ~84)
2. Refactor `getMessage()` to directly access instance properties instead of calling `getStatus()`
3. Verify with: `curl http://localhost:3000/api/quota-status` (should return 200)

**Success Criteria**:

- ✅ `/api/quota-status` endpoint returns 200 with quota metrics
- ✅ No "Maximum call stack size exceeded" errors
- ✅ Response includes: `callCount`, `limit`, `percentUsed`, `isPaused`, `secondsUntilReset`

**Agent Notes**:

- Code change is ~10 lines in `getStatus()` and `getMessage()` methods
- No test changes needed - existing quota tests should pass after fix
- This is prerequisite to Task 2

---

## Testing Gate: Quota System Validation

### TASK 2: Complete Quota Testing with Real Gemini API

**Status**: 🟡 BLOCKED (by Task 1)  
**Files**: Test suite in `server/__tests__/geminiClient.test.js` and `server/__tests__/jobQueueManager.quota.test.js`  
**Time**: 1.5 hours (after Task 1 complete)

**What's Required**:

1. **Unit Tests** (already written, should pass after Task 1)

   - QuotaTracker call counting
   - Window rotation at 60s boundary
   - Pause/resume logic
   - Error handling

2. **Integration Tests** (already written, verify after Task 1)

   - Job deferral when quota approaching (90%+)
   - Job resumption after pause expires
   - Queue bounds checking (max 50 jobs)

3. **Manual Testing with Real API** (not yet done)
   - Generate 2 sequential ebooks with real Gemini API
   - Verify no quota 429 errors
   - Confirm deferred jobs resume after 65s cooldown
   - Check frontend displays quota percentage

**Success Criteria**:

- ✅ `npm test` passes (all quota-related tests green)
- ✅ Manual API test: 2 sequential 20-page ebooks generate without 429 errors
- ✅ Deferred jobs auto-resume after cooldown
- ✅ Frontend progress shows quota status
- ✅ No memory leaks (quota tracker singleton stable over 1 hour)

**Agent Notes**:

- Tests exist but were not run with real API (used mocks)
- Real API test requires `GEMINI_API_KEY` and `USE_REAL_AI=1`
- Expected: First ebook generates immediately, second may defer 65s
- See test examples in `GEMINI_QUOTA_IMPLEMENTATION_GUIDE.md` "Testing Strategy"

---

## Deployment & Quality Checklist

### TASK 3: Replace Console.log with Structured Logger

**Status**: 🟠 MEDIUM PRIORITY  
**Files**:

- `server/geminiClient.js` (pause/exhaustion logs)
- `server/aiService.js` (quota tracking logs)
- `server/ebookService.js` (structure/chapter generation logs)
- `server/genieService.js` (persistence logs)
- `server/jobQueueManager.js` (deferral logs)
  **Time**: 1 hour  
  **Rationale**: Production logs should be structured, not raw console.log

**What to do**:

1. Check if Logger class exists: `client/src/lib/logger.js` (it does)
2. Create `server/utils/Logger.js` if it doesn't exist (standard Node.js logger pattern)
3. Replace quota-related console.log calls with structured logging:

   ```javascript
   // OLD
   console.log(`[QuotaTracker] Quota exhausted...`);

   // NEW
   Logger.warn("quota_exhausted", { pauseUntil, callCount, limit });
   ```

4. Maintain debug flags: Keep `console.log` only when `DEBUG=1` env var set

**Success Criteria**:

- ✅ No direct `console.log` in production quota code (except debug mode)
- ✅ All quota logs use structured format
- ✅ Logs include: timestamp, level (info/warn/error), context (jobId, quota %)
- ✅ Existing tests still pass

**Agent Notes**:

- Don't over-engineer - simple JSON structure is fine
- Keep backwards compat: quiet by default, verbose with `DEBUG=1`

---

### TASK 4: Consolidate Test Scripts to /scripts Directory

**Status**: ✅ COMPLETED
**Files**: Test scripts moved to `/scripts/` directory:

- `scripts/test-step1.js` - HTML pipeline testing
- `scripts/test-title-debug.js` - Title extraction debugging
- `scripts/test-cache-clear.js` - Cache endpoint testing

**Documentation**: See `scripts/README_TESTS.md` for comprehensive testing guide

**Completed**:

1. ✅ Created `scripts/README_TESTS.md` documenting each test
2. ✅ Moved test scripts to `/scripts/` directory
3. ✅ Updated references in documentation
4. Keep only essential scripts in root (none for quota, all move to /scripts)

**Success Criteria**:

- ✅ All test scripts in `/scripts` directory
- ✅ `/scripts/README_TESTS.md` documents what each test does
- ✅ No loose test files in root directory
- ✅ CI/CD workflows still find tests correctly

**Agent Notes**:

- `test-*.js` files appear to be development/debugging scripts
- Not critical for batch optimization but improves codebase hygiene

---

### TASK 5: Add .env Validation at Server Startup

**Status**: 🟠 MEDIUM PRIORITY  
**Files**: `server/index.js` (startup)  
**Time**: 30 minutes  
**Rationale**: Catch missing config early, fail fast

**What to do**:

1. At server startup, validate required environment variables:
   - `GEMINI_API_KEY` (if `USE_REAL_AI=1`)
   - `GEMINI_API_URL` (if `USE_REAL_AI=1`)
   - `NODE_ENV` (development/test/production)
2. Log clear error message with instructions if missing
3. Exit with code 1 if validation fails

**Example**:

```javascript
// server/index.js - add at startup
if (process.env.USE_REAL_AI === "1") {
  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY required when USE_REAL_AI=1");
    process.exit(1);
  }
  if (!process.env.GEMINI_API_URL) {
    console.error("❌ GEMINI_API_URL required when USE_REAL_AI=1");
    process.exit(1);
  }
}
```

**Success Criteria**:

- ✅ Server fails immediately with helpful message if config missing
- ✅ No silent failures or confusing 401/403 API errors
- ✅ Validation happens before any service initialization

---

### TASK 6: Verify All Deployment Checklist Items

**Status**: 🟠 MEDIUM PRIORITY  
**Time**: 1 hour

From `GEMINI_QUOTA_IMPLEMENTATION_GUIDE.md` Deployment Checklist:

**Pre-Deployment**:

- [ ] Code review complete (document review findings)
- [ ] All tests passing: `npm test` (677+ tests, 0 failures)
- [ ] No unhandled rejections detected
- [ ] Error handling comprehensive for quota scenarios

**Monitoring Setup**:

- [ ] Frontend quota display working (shows % in progress)
- [ ] Server logs show deferral decisions (`[JobQueue] Job X deferred`)
- [ ] `/api/quota-status` endpoint accessible and returning data
- [ ] Quota metrics being tracked (callCount, percentUsed, isPaused)

**Staging Deployment** (optional but recommended):

- [ ] Code pushed to feat/revert
- [ ] Staging server started with real API credentials
- [ ] Quota pause/resume tested manually
- [ ] No API leaks or resource issues

**Documentation**:

- [ ] Runbook created for quota-related issues
- [ ] Team familiar with deferral messages and expected behavior
- [ ] Monitoring alerts configured (e.g., pause duration > 2 min)

**Success Criteria**:

- ✅ All checklist items marked complete
- ✅ No outstanding issues preventing production deployment
- ✅ Team understands quota behavior and can troubleshoot

---

## Code Quality Issues (From Session Review)

### TASK 7: Extract JSON Parsing Utilities

**Status**: 🟢 LOW PRIORITY  
**File**: `server/ebookService.js` (lines ~150-170)  
**Time**: 20 minutes  
**Rationale**: `tryParse()` function repeated in multiple places

**What to do**:

1. Create `server/utils/jsonParsing.js` with utilities:
   ```javascript
   function tryParseJSON(text) {
     if (!text || typeof text !== "string") return null;
     try {
       if (/^[\s]*[\[{]/.test(text)) {
         return JSON.parse(text);
       }
     } catch (e) {
       // fall through to extraction
     }
     const jsonMatch = text.match(/\{[\s\S]*\}/m);
     if (jsonMatch) {
       try {
         return JSON.parse(jsonMatch[0]);
       } catch (e) {
         return null;
       }
     }
     return null;
   }
   module.exports = { tryParseJSON };
   ```
2. Replace duplicated logic in `ebookService.js` with imports

**Success Criteria**:

- ✅ Single source of truth for JSON extraction
- ✅ No duplication of parsing logic
- ✅ Tests still pass

---

### TASK 8: Document Legacy Fallback Patterns

**Status**: 🟢 LOW PRIORITY  
**Files**: `server/genieService.js`, `server/defaultModule.js`  
**Time**: 30 minutes  
**Rationale**: Dual Prisma/sqlite fallback is intentional but confusing

**What to do**:

1. Create `server/docs/PERSISTENCE_MIGRATION.md` explaining:
   - Why fallback exists (rolling migration from sqlite to Prisma)
   - When each path is used (Prisma-first, legacy fallback)
   - When to remove fallback (after all tests migrated to Prisma)
2. Add JSDoc comments to fallback code blocks explaining rationale
3. Reference document from relevant code files

**Example JSDoc**:

```javascript
/**
 * Legacy crud fallback: supports mixed migration state where some
 * persisted rows were written by old sqlite code, others by Prisma.
 * See server/docs/PERSISTENCE_MIGRATION.md for removal timeline.
 */
try {
  legacyDb = require("./crud");
} catch (requireErr) {
  legacyDb = null;
}
```

**Success Criteria**:

- ✅ Future developers understand why fallback exists
- ✅ Clear path to remove fallback documented
- ✅ No confusion about dual-path logic

---

### TASK 9: Standardize Optional Field Access

**Status**: 🟢 LOW PRIORITY  
**Files**: Multiple (search for `||` and `?.` patterns)  
**Time**: 45 minutes  
**Rationale**: Mix of null coalescing patterns reduces readability

**What to do**:

1. Standardize on one pattern:
   - Prefer `?.` for property access (modern, safe)
   - Prefer `??` for null coalescing (not just falsy)
   - Use `||` only for deliberate falsy-to-default behavior
2. Update: `ebookService.js`, `genieService.js`, `aiService.js`

**Before**:

```javascript
const theme = (payload.metadata && payload.metadata.theme) || "dark";
```

**After**:

```javascript
const theme = payload.metadata?.theme ?? "dark";
```

**Success Criteria**:

- ✅ Consistent pattern across core files
- ✅ Easier to scan and understand null-safety intent
- ✅ No behavior changes, only style

---

## Implementation Sequence

### Phase 1: Critical Blocking (Must Complete First)

1. **TASK 1** - Fix infinite recursion error (15 min)
2. **TASK 2** - Run quota tests and manual API testing (1.5 hrs)

**Gate Requirement**: Both must pass before proceeding to Phase 2-5

### Phase 2: Deployment Readiness (Next 2-3 hours)

3. **TASK 3** - Replace console.log (1 hr)
4. **TASK 4** - Move test scripts (45 min)
5. **TASK 5** - Add .env validation (30 min)
6. **TASK 6** - Complete deployment checklist (1 hr)

### Phase 3: Optional Code Quality (When time permits)

7. **TASK 7** - Extract JSON parsing (20 min)
8. **TASK 8** - Document fallback patterns (30 min)
9. **TASK 9** - Standardize optional access (45 min)

---

## Success Criteria & Gate

### Before Proceeding to Batch Optimization (Phase 2-5):

**MUST COMPLETE**:

- ✅ TASK 1 - Infinite recursion fixed, `/api/quota-status` returns 200
- ✅ TASK 2 - All quota tests passing (unit + integration + manual API)
- ✅ TASK 6 - Deployment checklist 100% complete

**STRONGLY RECOMMENDED**:

- ✅ TASK 3 - Console.log replaced with structured logging
- ✅ TASK 4 - Test scripts organized to `/scripts`
- ✅ TASK 5 - .env validation in place

**NICE TO HAVE**:

- ✅ TASK 7, 8, 9 - Code quality improvements

**Gate Status**: 🔴 BLOCKED until TASK 1 + 2 + 6 complete

---

## Related Documentation

**For Implementation Details**:

- `docs/design/ebookService/GEMINI_QUOTA_IMPLEMENTATION_GUIDE.md` - Complete implementation reference with code examples

**For Architecture Context**:

- `docs/design/ebookService/GEMINI_QUOTA_MANAGEMENT_STRATEGY.md` - Business and technical strategy
- `docs/design/ebookService/EBOOK_ARCHITECTURE_FINAL_RECAP.md` - Current architecture patterns

**For Next Phase**:

- `docs/design/ebookService/BATCH_OPTIMIZATION_UNIFICATION_STRATEGY.md` - What happens after quota is complete

**For Code Review**:

- Review findings (from Session 3): Logging verbosity, test organization, fallback documentation

---

## Estimated Total Time

| Phase                | Tasks       | Est. Time    | Status      |
| -------------------- | ----------- | ------------ | ----------- |
| Phase 1 (Critical)   | 1, 2        | 1.75 hrs     | 🔴 BLOCKED  |
| Phase 2 (Deployment) | 3, 4, 5, 6  | 2.75 hrs     | ⏳ PENDING  |
| Phase 3 (Optional)   | 7, 8, 9     | 1.5 hrs      | 🟢 FLEXIBLE |
| **TOTAL**            | **9 tasks** | **~6 hours** |             |

---

## Agent Instructions

**Priority Execution Path**:

1. Start with TASK 1 immediately (15 min fix, highest ROI)
2. After Task 1 passes, run TASK 2 validation (1.5 hrs)
3. If both pass, proceed with TASK 3-6 (2.75 hrs) before batch optimization

**Success Criteria for Agent Handoff to Batch Optimization**:

- All TASK 1 items ✅
- All TASK 2 items ✅
- All TASK 6 items ✅
- Commit with message: `fix: Complete quota management and deployment validation`
- Update this document status to ✅ COMPLETE

**If Blocked**:

- Document blocker clearly
- Reference exact line numbers and file paths
- Provide reproduction steps
- Suggest workaround or escalate for human review

---

**Last Updated**: December 6, 2025  
**Next Review**: After TASK 1 completion  
**Owner**: Development Agent / Next Session
