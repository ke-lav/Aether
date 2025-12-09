/**
 * ebookService + CallManager Integration Tests [SEQ-INTEGRATION-002]
 *
 * Tests quota/time orchestration with ebook generation
 * Coverage: Happy path, quota exhaustion, time boundary, error handling
 */

import { describe, it, expect } from "vitest";
const CallManager = require("../CallManager");

describe("[SEQ-INTEGRATION-002] CallManager + ebookService Integration", () => {
  // Test 1: Happy path - basic CallManager orchestration with multiple chapters
  it("[SEQ-CORE-001-A] executes structure call + chapter calls with quota tracking", async () => {
    const cm = new CallManager({
      quotaLimit: 20,
      quotaWindow: 60000,
    });

    // Structure call (callIndex=0)
    await cm.executeCall(
      () => Promise.resolve({ chapters: 5 }),
      0,
      "structure"
    );

    // Chapter calls (callIndex > 0)
    for (let i = 1; i <= 5; i++) {
      await cm.executeCall(
        () => Promise.resolve({ content: `chapter-${i}` }),
        i,
        `chapter-${i}`
      );
    }

    expect(cm.getQuotaStatus().callsInWindow).toBe(6);
    expect(cm.totalCallsAttempted).toBe(6);
    expect(cm.totalCallsSucceeded).toBe(6);
  });

  // Test 2: Quota deferral on exhaustion triggers transparently
  it("[SEQ-QUOTA-001-C] defers when quota exhausted, waits, then retries", async () => {
    const cm = new CallManager({
      quotaLimit: 2,
      quotaWindow: 100,
    });

    // Fill quota with structure + one chapter
    await cm.executeCall(() => Promise.resolve({}), 0, "structure");
    await cm.executeCall(() => Promise.resolve({}), 1, "chapter-1");

    expect(cm.getQuotaStatus().callsInWindow).toBe(2);
    expect(cm.getQuotaStatus().isExhausted).toBe(true);

    // Third call should defer then succeed
    const start = Date.now();
    await cm.executeCall(() => Promise.resolve({}), 2, "chapter-2");
    const elapsed = Date.now() - start;

    // Should have waited for reset (>100ms)
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(cm.totalCallsSucceeded).toBe(3);
  });

  // Test 3: Quota status observable provides accurate metrics
  it("[SEQ-CORE-001-B] provides accurate quota status metrics", async () => {
    const cm = new CallManager({
      quotaLimit: 20,
    });

    // Execute 10 calls
    for (let i = 0; i < 10; i++) {
      await cm.executeCall(() => Promise.resolve({ data: i }), i, `call-${i}`);
    }

    const quota = cm.getQuotaStatus();

    expect(quota.callsInWindow).toBe(10);
    expect(quota.quotaLimit).toBe(20);
    expect(quota.percentUsed).toBe(50);
    expect(quota.isExhausted).toBe(false);
  });

  // Test 4: Time status observable provides budget metrics
  it("[SEQ-TIME-001-A] reports time status metrics", () => {
    const now = Date.now();
    const cm = new CallManager({
      deadline: now + 10000,
      startTime: now,
    });

    const time = cm.getTimeStatus();

    expect(time.budgetMs).toBeGreaterThanOrEqual(9900); // Allow slight clock drift
    expect(time.percentUsed).toBeLessThanOrEqual(1); // Very fresh, almost no time used
    expect(time.isExceeded).toBe(false);
  });

  // Test 5: Comprehensive status snapshot
  it("[SEQ-CORE-001-F] provides comprehensive status snapshot", async () => {
    const cm = new CallManager();

    for (let i = 0; i < 3; i++) {
      await cm.executeCall(() => Promise.resolve({ data: i }), i, `call-${i}`);
    }

    const status = cm.getStatus();

    expect(status).toBeDefined();
    expect(status.timestamp).toBeDefined();
    expect(status.quotaStatus).toBeDefined();
    expect(status.timeStatus).toBeDefined();
    expect(status.callMetrics).toBeDefined();

    expect(status.callMetrics.totalAttempted).toBe(3);
    expect(status.callMetrics.totalSucceeded).toBe(3);
    expect(status.isHealthy).toBeDefined();
  });

  // Test 6: Call history tracking with metadata
  it("[SEQ-CORE-001-E] tracks call history with metadata", async () => {
    const cm = new CallManager();

    await cm.executeCall(
      () => Promise.resolve({ title: "Test" }),
      0,
      "structure"
    );
    await cm.executeCall(
      () => Promise.resolve({ content: "Chapter 1" }),
      1,
      "chapter-1"
    );

    expect(cm.callHistory).toHaveLength(2);

    const [structure, chapter] = cm.callHistory;
    expect(structure.callIndex).toBe(0);
    expect(structure.callType).toBe("structure");
    expect(structure.status).toBe("success");

    expect(chapter.callIndex).toBe(1);
    expect(chapter.callType).toBe("chapter-1");
    expect(chapter.status).toBe("success");
  });

  // Test 7: Fatal error fails immediately without retry
  it("[SEQ-ERROR-001-B] fails immediately on fatal errors", async () => {
    const cm = new CallManager();

    const fatality = await cm
      .executeCall(
        async () => {
          const err = new Error("AUTHENTICATION_FAILED");
          err.code = "AUTHENTICATION_FAILED";
          throw err;
        },
        0,
        "test"
      )
      .catch((err) => err);

    // Verify it failed
    expect(fatality).toBeInstanceOf(Error);
    expect(fatality.message).toContain("AUTHENTICATION_FAILED");

    // Only one attempt, no retry
    expect(cm.totalCallsAttempted).toBe(1);
    expect(cm.totalCallsFailed).toBe(1);
  });

  // Test 8: Retriable error (quota) defers instead of failing
  it("[SEQ-ERROR-001-C] retriable errors defer transparently", async () => {
    const cm = new CallManager({
      quotaLimit: 1,
      quotaWindow: 100,
    });

    let callCount = 0;

    // First call succeeds
    await cm.executeCall(() => Promise.resolve({}), 0, "call-0");

    // Second call hits quota, defers, and retries
    await cm.executeCall(
      async () => {
        callCount++;
        return { data: "success" };
      },
      1,
      "call-1"
    );

    expect(cm.totalCallsSucceeded).toBe(2);
    // callCount should be 1 (one attempt after deferral)
  });

  // Test 9: Reset clears state for new request
  it("[SEQ-CORE-001-G] reset clears all state", async () => {
    const cm = new CallManager();

    for (let i = 0; i < 5; i++) {
      await cm.executeCall(() => Promise.resolve({ data: i }), i, `call-${i}`);
    }

    expect(cm.totalCallsAttempted).toBe(5);
    expect(cm.callHistory).toHaveLength(5);

    cm.reset();

    expect(cm.totalCallsAttempted).toBe(0);
    expect(cm.totalCallsSucceeded).toBe(0);
    expect(cm.totalCallsFailed).toBe(0);
    expect(cm.callHistory).toHaveLength(0);
  });

  // Test 10: Model rotation (Pro for structure, Flash for chapters)
  it("[SEQ-CORE-001-H] tracks model assignment in call history", async () => {
    const cm = new CallManager();

    // Structure call with Pro model
    await cm.executeCall(
      () => Promise.resolve({ title: "Test" }),
      0,
      "structure",
      "gemini-2.5-pro"
    );

    // Chapter calls with Flash model
    for (let i = 1; i <= 3; i++) {
      await cm.executeCall(
        () => Promise.resolve({ content: `Chapter ${i}` }),
        i,
        `chapter-${i}`,
        "gemini-2.5-flash"
      );
    }

    const [structure, ...chapters] = cm.callHistory;

    expect(structure.model).toBe("gemini-2.5-pro");
    chapters.forEach((ch) => {
      expect(ch.model).toBe("gemini-2.5-flash");
    });
  });
});
