/**
 * Unit Tests for CallManager [SEQ-CORE-001]
 *
 * Architecture Document: PATIENCE_TIMER_BLUEPRINT.md
 */

import { vi } from "vitest";
const CallManager = require("../CallManager");

describe("[IMPL-CORE-001] CallManager - Quota Management", () => {
  test("[SEQ-QUOTA-001-A] Tracks calls in current window", async () => {
    const cm = new CallManager({
      quotaLimit: 5,
      quotaWindow: 1000,
    });

    for (let i = 0; i < 5; i++) {
      await cm.executeCall(
        () => Promise.resolve({ result: `call-${i}` }),
        i,
        `test-${i}`
      );
    }

    const quotaStatus = cm.getQuotaStatus();
    expect(quotaStatus.callsInWindow).toBe(5);
    expect(quotaStatus.percentUsed).toBe(100);
  });

  test("[SEQ-QUOTA-001-C] Defers call when quota exhausted", async () => {
    const cm = new CallManager({
      quotaLimit: 2,
      quotaWindow: 100,
    });

    let deferralCount = 0;
    cm.config.onDeferral = () => {
      deferralCount++;
    };

    await cm.executeCall(() => Promise.resolve({}), 0, "test-0");
    await cm.executeCall(() => Promise.resolve({}), 1, "test-1");

    expect(cm.getQuotaStatus().callsInWindow).toBe(2);

    await cm.executeCall(() => Promise.resolve({}), 2, "test-2");

    expect(cm.totalCallsSucceeded).toBe(3);
  });

  test("[SEQ-QUOTA-001-A] Resets window after expiry", async () => {
    const cm = new CallManager({
      quotaLimit: 2,
      quotaWindow: 100,
    });

    await cm.executeCall(() => Promise.resolve({}), 0, "test-0");
    expect(cm.getQuotaStatus().callsInWindow).toBe(1);

    await cm.sleep(120);

    await cm.executeCall(() => Promise.resolve({}), 1, "test-1");
    expect(cm.getQuotaStatus().callsInWindow).toBe(1);
  });
});

describe("[IMPL-CORE-001] CallManager - Time Management", () => {
  test("[SEQ-TIME-001] Reports time status correctly", async () => {
    const now = Date.now();
    const cm = new CallManager({
      deadline: now + 10000,
      startTime: now,
    });

    const timeStatus = cm.getTimeStatus();
    expect(timeStatus.budgetMs).toBe(10000);
    expect(timeStatus.percentUsed).toBeLessThanOrEqual(5);
    expect(timeStatus.isExceeded).toBe(false);
  });

  test("[SEQ-TIME-001] Validates deadline in constructor", () => {
    const now = Date.now();
    const logSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const cm = new CallManager({
      deadline: now - 1000,
    });

    expect(cm.deadline).toBeGreaterThan(now);
    logSpy.mockRestore();
  });

  test("[SEQ-TIME-001] Continues if time exceeded", async () => {
    const now = Date.now();
    const cm = new CallManager({
      deadline: now - 1000,
      startTime: now - 2000,
    });

    const result = await cm.executeCall(
      () => Promise.resolve({ success: true }),
      0,
      "test"
    );

    expect(result.success).toBe(true);
  });
});

describe("[IMPL-CORE-001] CallManager - Error Classification", () => {
  test("[SEQ-ERROR-001] Classifies retriable vs fatal errors", () => {
    const cm = new CallManager();

    expect(cm.isRetriableError({ code: "QUOTA_EXHAUSTED" })).toBe(true);
    expect(cm.isRetriableError({ code: "RATE_LIMIT_EXCEEDED" })).toBe(true);
    expect(cm.isRetriableError({ code: "SERVICE_UNAVAILABLE" })).toBe(true);
    expect(cm.isRetriableError({ code: "429" })).toBe(true);
    expect(cm.isRetriableError({ code: "AUTHENTICATION_FAILED" })).toBe(false);
    expect(cm.isRetriableError({ code: "INVALID_API_KEY" })).toBe(false);
    expect(cm.isRetriableError({ code: "401" })).toBe(false);
  });

  test("[SEQ-ERROR-001] Fails immediately on fatal errors", async () => {
    const cm = new CallManager();

    await expect(
      cm.executeCall(
        async () => {
          throw new Error("AUTHENTICATION_FAILED: Invalid API key");
        },
        0,
        "structure"
      )
    ).rejects.toThrow("AUTHENTICATION_FAILED");
  });

  test("[SEQ-ERROR-001] Enhances errors with context", () => {
    const cm = new CallManager();

    const originalError = new Error("API Error");
    const context = {
      callIndex: 5,
      callType: "chapter-5",
      model: "gemini-2.5-flash",
      quotaStatus: { percentUsed: 50 },
      timeStatus: { percentUsed: 30 },
    };

    const enhanced = cm.enhanceError(originalError, context);

    expect(enhanced.message).toContain("chapter-5");
    expect(enhanced.callIndex).toBe(5);
    expect(enhanced.model).toBe("gemini-2.5-flash");
    expect(enhanced.quotaStatus.percentUsed).toBe(50);
  });
});

describe("[IMPL-CORE-001] CallManager - Status Methods", () => {
  test("[SEQ-CORE-001] getQuotaStatus returns correct metrics", async () => {
    const cm = new CallManager({
      quotaLimit: 20,
      quotaWindow: 60000,
    });

    for (let i = 0; i < 5; i++) {
      await cm.executeCall(() => Promise.resolve({}), i, `test-${i}`);
    }

    const quota = cm.getQuotaStatus();

    expect(quota.callsInWindow).toBe(5);
    expect(quota.quotaLimit).toBe(20);
    expect(quota.percentUsed).toBe(25);
    expect(quota.isExhausted).toBe(false);
  });

  test("[SEQ-CORE-001] getTimeStatus returns correct metrics", () => {
    const now = Date.now();
    const cm = new CallManager({
      deadline: now + 10000,
      startTime: now,
    });

    const time = cm.getTimeStatus();

    expect(time.budgetMs).toBe(10000);
    expect(time.percentUsed).toBeLessThanOrEqual(5);
    expect(time.isExceeded).toBe(false);
  });

  test("[SEQ-CORE-001] getStatus returns comprehensive metrics", async () => {
    const cm = new CallManager();

    for (let i = 0; i < 3; i++) {
      await cm.executeCall(() => Promise.resolve({}), i, `test-${i}`);
    }

    const status = cm.getStatus();

    expect(status.timestamp).toBeDefined();
    expect(status.quotaStatus).toBeDefined();
    expect(status.timeStatus).toBeDefined();
    expect(status.callMetrics.totalAttempted).toBe(3);
    expect(status.callMetrics.totalSucceeded).toBe(3);
    expect(status.callMetrics.totalFailed).toBe(0);
    expect(status.isHealthy.quotaOk).toBe(true);
  });
});

describe("[IMPL-CORE-001] CallManager - Utilities", () => {
  test("Formats milliseconds correctly", () => {
    const cm = new CallManager();

    expect(cm.formatMs(45000)).toBe("45s");
    expect(cm.formatMs(65000)).toBe("1m 5s");
    expect(cm.formatMs(125000)).toBe("2m 5s");
  });

  test("Reset clears state", async () => {
    const cm = new CallManager();

    for (let i = 0; i < 5; i++) {
      await cm.executeCall(() => Promise.resolve({}), i, `test-${i}`);
    }

    expect(cm.totalCallsAttempted).toBe(5);

    cm.reset();

    expect(cm.totalCallsAttempted).toBe(0);
    expect(cm.totalCallsSucceeded).toBe(0);
    expect(cm.callHistory).toHaveLength(0);
  });
});
