#!/usr/bin/env node

/**
 * Diagnostic Script: Quota Tracking Bug Root Cause Analysis
 *
 * This script runs three diagnostic tests to identify why quotaTracker.callCount
 * is not incrementing when Gemini API calls are made.
 *
 * Usage: node scripts/diagnose-quota-bug.js
 *
 * Tests:
 * 1. Direct QuotaTracker test (no network)
 * 2. Singleton pattern verification
 * 3. Mock vs Real service check
 */

console.log("\n=== QUOTA TRACKING BUG DIAGNOSTIC ===\n");

// TEST 1: Direct QuotaTracker functionality
console.log("TEST 1: Direct QuotaTracker Test");
console.log("--------------------------------");

try {
  const { quotaTracker } = require("../server/geminiClient");

  console.log("Initial quota status:");
  const initial = quotaTracker.getStatus();
  console.log(`  callCount: ${initial.callCount}`);
  console.log(`  limit: ${initial.limit}`);
  console.log(`  percentUsed: ${initial.percentUsed}%`);
  console.log(
    `  window start: ${new Date(initial.windowStart || 0).toISOString()}`
  );

  console.log("\nCalling recordCall() 5 times...");
  for (let i = 0; i < 5; i++) {
    const result = quotaTracker.recordCall();
    const status = quotaTracker.getStatus();
    console.log(
      `  Call ${i + 1}: success=${result.success}, callCount=${
        status.callCount
      }/${status.limit}`
    );
  }

  const final = quotaTracker.getStatus();
  console.log("\nFinal quota status:");
  console.log(`  callCount: ${final.callCount}`);
  console.log(`  percentUsed: ${final.percentUsed}%`);

  if (final.callCount === 5) {
    console.log("✅ TEST 1 PASSED: QuotaTracker increments correctly");
  } else {
    console.log(
      `❌ TEST 1 FAILED: Expected callCount=5, got ${final.callCount}`
    );
    console.log(
      "   ROOT CAUSE: QuotaTracker.recordCall() is not incrementing counter"
    );
  }
} catch (e) {
  console.error("❌ TEST 1 ERROR:", e.message);
}

// TEST 2: Singleton pattern verification
console.log("\n\nTEST 2: Singleton Pattern Verification");
console.log("--------------------------------------");

try {
  // Require geminiClient multiple times
  delete require.cache[require.resolve("../server/geminiClient")];
  const gc1 = require("../server/geminiClient");

  const gc2 = require("../server/geminiClient");

  console.log("Checking if quotaTracker is same instance across requires:");
  console.log(
    `  gc1.quotaTracker === gc2.quotaTracker: ${
      gc1.quotaTracker === gc2.quotaTracker
    }`
  );

  if (gc1.quotaTracker === gc2.quotaTracker) {
    console.log("✅ TEST 2 PASSED: Singleton pattern working - same instance");
  } else {
    console.log("❌ TEST 2 FAILED: Different instances detected!");
    console.log(
      "   ROOT CAUSE: Multiple QuotaTracker instances - call counts scattered"
    );
  }
} catch (e) {
  console.error("❌ TEST 2 ERROR:", e.message);
}

// TEST 3: Service selection (Mock vs Real)
console.log("\n\nTEST 3: AI Service Selection");
console.log("----------------------------");

try {
  const env = process.env;

  console.log("Environment variables:");
  console.log(`  USE_REAL_AI: ${env.USE_REAL_AI || "NOT SET"}`);
  console.log(`  FORCE_MOCK_AI: ${env.FORCE_MOCK_AI || "NOT SET"}`);
  console.log(`  GEMINI_API_KEY: ${env.GEMINI_API_KEY ? "SET" : "NOT SET"}`);
  console.log(`  GEMINI_API_URL: ${env.GEMINI_API_URL ? "SET" : "NOT SET"}`);

  // Check which service will be selected
  const forceMock = env.FORCE_MOCK_AI === "1" || env.FORCE_MOCK_AI === "true";
  const useReal = env.USE_REAL_AI === "1" || env.USE_REAL_AI === "true";
  const hasCredentials = env.GEMINI_API_KEY && env.GEMINI_API_URL;

  console.log("\nService selection logic:");
  console.log(`  forceMock=${forceMock}`);
  console.log(`  useReal=${useReal}`);
  console.log(`  hasCredentials=${hasCredentials}`);

  let selectedService = "UNKNOWN";
  if (forceMock) {
    selectedService = "MockAIService (FORCE_MOCK_AI=1)";
  } else if (!useReal) {
    selectedService = "MockAIService (USE_REAL_AI not set - default)";
  } else if (!hasCredentials) {
    selectedService = "MockAIService (credentials missing - fallback)";
  } else {
    selectedService = "RealAIService with Gemini API";
  }

  console.log(`\nSelected service: ${selectedService}`);

  if (selectedService === "RealAIService with Gemini API") {
    console.log(
      "✅ TEST 3 PASSED: Real service will be used, quota tracking should work"
    );
  } else {
    console.log("⚠️  TEST 3 WARNING: Mock service selected");
    console.log("   If quota not incrementing, might be using MockAIService");
    console.log("   (But MockAIService should still call quota tracking)");
  }
} catch (e) {
  console.error("❌ TEST 3 ERROR:", e.message);
}

// TEST 4: Check window rotation timing
console.log("\n\nTEST 4: Window Rotation Timing");
console.log("------------------------------");

try {
  const { quotaTracker } = require("../server/geminiClient");

  // Get internal state (if accessible)
  const status = quotaTracker.getStatus();
  console.log("Window state:");
  console.log(
    `  windowMs: ${quotaTracker.windowMs || 60000}ms (expected 60000)`
  );
  console.log(`  Current time: ${Date.now()}`);
  console.log(`  windowStart: ${status.windowStart || "unknown"}`);

  if (status.windowStart) {
    const elapsed = Date.now() - status.windowStart;
    console.log(`  Time since window start: ${elapsed}ms`);

    if (elapsed > 60000) {
      console.log("⚠️  TEST 4 WARNING: Window has been running for >60s");
      console.log("   Window rotation may have occurred, resetting counter");
    } else {
      console.log("✅ Window is fresh (<60s old)");
    }
  }
} catch (e) {
  console.error("❌ TEST 4 ERROR:", e.message);
}

// TEST 5: Check if quotaTracker exists in aiService
console.log("\n\nTEST 5: aiService Quota Integration");
console.log("-----------------------------------");

try {
  const aiService = require("../server/aiService");

  console.log("Checking aiService implementation...");

  // Try to see if generateContent method exists
  if (typeof aiService.generateContent === "function") {
    console.log("✅ aiService.generateContent exists");

    // Check source code for recordCall
    const fs = require("fs");
    const aiServiceCode = fs.readFileSync("../server/aiService.js", "utf8");

    if (aiServiceCode.includes("recordCall")) {
      console.log("✅ quotaTracker.recordCall() found in aiService code");
    } else {
      console.log("❌ quotaTracker.recordCall() NOT found in aiService code!");
      console.log(
        "   ROOT CAUSE: aiService.generateContent() not calling quota tracker"
      );
    }

    if (aiServiceCode.includes("quotaTracker")) {
      console.log("✅ quotaTracker is referenced in aiService");
    } else {
      console.log("❌ quotaTracker NOT referenced in aiService!");
    }
  } else {
    console.log("❌ aiService.generateContent does not exist");
  }
} catch (e) {
  console.error("❌ TEST 5 ERROR:", e.message);
}

console.log("\n\n=== DIAGNOSTIC COMPLETE ===\n");
console.log("Summary:");
console.log("--------");
console.log("If TEST 1 fails: quotaTracker.recordCall() has a bug");
console.log("If TEST 2 fails: Multiple tracker instances exist");
console.log(
  "If TEST 3 shows MockAIService: Check if quota tracking works with mocks"
);
console.log(
  "If TEST 4 shows elapsed >60s: Window rotation might be resetting counter"
);
console.log("If TEST 5 fails: aiService not calling quota tracker");
console.log("\nNext: Check server logs while running test-quota-real-api.js\n");
