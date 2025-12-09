/**
 * CallManager - Orchestrates AI model access with quota and time awareness
 *
 * Purpose:
 * - Track per-minute quota consumption (20 calls/min for Gemini free tier)
 * - Manage time budget relative to deadline
 * - Defer calls transparently when quota exhausted
 * - Never fail on infrastructure constraints (only on genuine errors)
 * - Provide observable metrics for frontend progress tracking
 *
 * Architecture Document: PATIENCE_TIMER_BLUEPRINT.md [SEQ-CORE-001]
 */

class CallManager {
  /**
   * Initialize CallManager with time and quota configuration.
   *
   * @param {Object} options - Configuration options
   * @param {number} options.deadline - When generation must complete (ms timestamp)
   * @param {number} options.startTime - Start reference point (defaults to now)
   * @param {number} options.quotaLimit - Max calls per window (default 20)
   * @param {number} options.quotaWindow - Window duration in ms (default 60000)
   * @param {Object} options.aiService - AI service instance (optional)
   * @param {boolean} options.autoRetry - Auto-retry retriable errors (default true)
   * @param {number} options.maxDeferralWait - Max time to wait for retry (default 120000)
   * @param {Function} options.onStatusChange - Callback for status updates
   * @param {Function} options.onDeferral - Callback for deferral events
   */
  constructor(options = {}) {
    // Validate deadline
    const deadline = options.deadline || Date.now() + 600000; // 10min default
    const now = Date.now();

    if (deadline <= now) {
      console.warn(
        "[CallManager] Deadline in the past, using 600s default instead"
      );
      this.deadline = now + 600000;
    } else {
      this.deadline = deadline;
    }

    // Time Management
    this.startTime = options.startTime || Date.now();

    // Quota Management
    this.quotaLimit = options.quotaLimit || 20; // calls per minute
    this.quotaWindow = options.quotaWindow || 60000; // milliseconds

    // Call Tracking
    this.callHistory = []; // [{ timestamp, callIndex, callType, model, status }, ...]

    // State Tracking
    this.isProcessing = false;
    this.lastWindowReset = Date.now();
    this.deferralCount = 0;
    this.totalCallsAttempted = 0;
    this.totalCallsSucceeded = 0;
    this.totalCallsFailed = 0;

    // Configuration
    this.config = {
      autoRetry: options.autoRetry !== false,
      maxDeferralWait: options.maxDeferralWait || 120000, // 2 minutes
      onStatusChange: options.onStatusChange || (() => {}),
      onDeferral: options.onDeferral || (() => {}),
    };

    // Diagnostics
    this.createdAt = Date.now();
    this.logDiagnostics();
  }

  /**
   * Log diagnostic information for debugging.
   * @private
   */
  logDiagnostics() {
    const now = Date.now();
    const deadline = this.deadline;
    const budgetMs = deadline - this.startTime;
    const budgetSeconds = Math.round(budgetMs / 1000);

    console.log("[CallManager] Initialized");
    console.log(`  - Deadline: ${budgetSeconds}s from start`);
    console.log(
      `  - Quota limit: ${this.quotaLimit} calls per ${this.quotaWindow}ms`
    );
    console.log(`  - Auto-retry: ${this.config.autoRetry}`);
  }

  /**
   * Execute a single API call with quota and time management.
   *
   * Behavior:
   * - Quota exhausted? Defer transparently, wait for window reset, retry automatically
   * - Time tight (>80%)? Warn but continue (user controls deadline)
   * - Genuine error? Fail with enhanced context
   *
   * @param {Function} callFn - Async function that makes AI call
   *                            Signature: async (model) => result
   * @param {number} callIndex - Sequential index (0=Pro/structure, >0=Flash/chapters)
   * @param {string} callType - Type identifier for logging (structure|chapter-1|etc)
   * @returns {Promise<Object>} Result from callFn
   * @throws {Error} Enhanced error with context if call fails permanently
   */
  async executeCall(callFn, callIndex, callType = "content") {
    this.totalCallsAttempted++;

    // [SEQ-QUOTA-001] Manage quota before executing call
    await this.manageQuota();

    // [SEQ-TIME-001] Check time budget and warn if tight
    const timeStatus = this.getTimeStatus();
    if (timeStatus.percentUsed > 80 && timeStatus.percentUsed < 100) {
      this.emitStatus({
        type: "time-tight",
        phase: callType,
        percentUsed: timeStatus.percentUsed,
        remainingMs: timeStatus.remainingMs,
        message: `⚠️ Time budget ${
          timeStatus.percentUsed
        }% used (${this.formatMs(timeStatus.remainingMs)} remaining)`,
      });
    } else if (timeStatus.percentUsed >= 100) {
      this.emitStatus({
        type: "time-exceeded",
        elapsedMs: timeStatus.elapsedMs,
        budgetMs: timeStatus.budgetMs,
        message: `⏳ Deadline exceeded, continuing anyway...`,
      });
    }

    // Determine model based on call index (Pro for structure, Flash for chapters)
    const model = callIndex === 0 ? "gemini-2.5-pro" : "gemini-2.5-flash";

    // Record call start
    const callRecord = {
      timestamp: Date.now(),
      callIndex,
      callType,
      model,
      status: "executing",
      error: null,
    };

    try {
      // Execute the call
      const result = await callFn(model);

      // Record successful call
      callRecord.status = "success";
      this.callHistory.push(callRecord);
      this.totalCallsSucceeded++;

      return result;
    } catch (error) {
      // Record failed call
      callRecord.status = "error";
      callRecord.error = error.message;
      this.callHistory.push(callRecord);
      this.totalCallsFailed++;

      // [SEQ-ERROR-001] Classify error
      const isRetriable = this.isRetriableError(error);

      if (isRetriable && this.config.autoRetry) {
        // Deferrable error - emit event and retry
        this.deferralCount++;

        this.emitDeferral({
          callIndex,
          callType,
          model,
          error: error.message,
          retryAfter: "quota-reset",
          attemptNumber: 1,
        });

        // Wait for quota window reset
        await this.waitForQuotaReset();

        // Recursively retry
        return this.executeCall(callFn, callIndex, callType);
      } else {
        // Genuine error - fail with enhanced context
        const enhanced = this.enhanceError(error, {
          callIndex,
          callType,
          model,
          quotaStatus: this.getQuotaStatus(),
          timeStatus: this.getTimeStatus(),
        });

        throw enhanced;
      }
    }
  }

  /**
   * Manage quota before executing a call.
   *
   * Strategy:
   * 1. Check if quota window has expired (60s)
   * 2. Count successful calls in current window
   * 3. If at limit, wait for window to reset
   *
   * @private
   */
  async manageQuota() {
    const now = Date.now();
    const windowAge = now - this.lastWindowReset;

    // [SEQ-QUOTA-001-A] Reset window if expired
    if (windowAge >= this.quotaWindow) {
      // Clear old call history
      this.callHistory = this.callHistory.filter(
        (call) => now - call.timestamp < this.quotaWindow
      );
      this.lastWindowReset = now;
      return; // Window reset, quota available
    }

    // [SEQ-QUOTA-001-B] Count successful calls in current window
    const callsInWindow = this.callHistory.filter(
      (call) =>
        call.status === "success" && now - call.timestamp < this.quotaWindow
    ).length;

    // [SEQ-QUOTA-001-C] If at quota limit, wait for reset
    if (callsInWindow >= this.quotaLimit) {
      const waitTime = this.quotaWindow - windowAge + 100; // +100ms buffer

      this.emitStatus({
        type: "quota-deferral",
        callsInWindow,
        quotaLimit: this.quotaLimit,
        waitMs: Math.max(0, waitTime),
        percentUsed: Math.round((callsInWindow / this.quotaLimit) * 100),
        message: `⏸️ Quota exhausted (${callsInWindow}/${
          this.quotaLimit
        }). Waiting ${this.formatMs(Math.max(0, waitTime))} for reset.`,
      });

      // Sleep transparently
      await this.sleep(Math.max(0, waitTime));

      // Recursively check quota (should be OK now)
      return this.manageQuota();
    }
  }

  /**
   * Wait for quota window to reset after deferral.
   *
   * @private
   */
  async waitForQuotaReset() {
    const now = Date.now();
    const windowAge = now - this.lastWindowReset;
    const waitTime = this.quotaWindow - windowAge + 100; // +100ms buffer

    if (waitTime > 0) {
      this.emitStatus({
        type: "quota-wait-reset",
        waitMs: waitTime,
        message: `Waiting ${this.formatMs(waitTime)} for quota window reset...`,
      });

      await this.sleep(waitTime);
    }

    this.lastWindowReset = Date.now();
  }

  /**
   * Determine if error is retriable (infrastructure) vs fatal (genuine).
   *
   * Retriable errors cause automatic deferral and retry:
   * - QUOTA_EXHAUSTED: API rate limit
   * - SERVICE_UNAVAILABLE: Transient service issue
   * - TEMPORARY_FAILURE: Network timeout
   *
   * Fatal errors cause immediate failure:
   * - AUTHENTICATION_FAILED: API key invalid
   * - INVALID_ARGUMENT: Bad input to API
   * - PERMISSION_DENIED: Access control
   *
   * @private
   */
  isRetriableError(error) {
    const code = (error.code || error.status || error.message || "").toString();

    const retriableCodes = [
      "QUOTA_EXHAUSTED",
      "RATE_LIMIT_EXCEEDED",
      "SERVICE_UNAVAILABLE",
      "TEMPORARY_FAILURE",
      "RESOURCE_EXHAUSTED",
      "429", // HTTP: Too Many Requests
      "503", // HTTP: Service Unavailable
      "504", // HTTP: Gateway Timeout
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
    ];

    const fatalCodes = [
      "INVALID_ARGUMENT",
      "AUTHENTICATION_FAILED",
      "INVALID_API_KEY",
      "PERMISSION_DENIED",
      "NOT_FOUND",
      "400", // HTTP: Bad Request
      "401", // HTTP: Unauthorized
      "403", // HTTP: Forbidden
      "404", // HTTP: Not Found
    ];

    // Check retriable codes
    for (const retriable of retriableCodes) {
      if (code.includes(retriable)) {
        return true;
      }
    }

    // Check fatal codes
    for (const fatal of fatalCodes) {
      if (code.includes(fatal)) {
        return false;
      }
    }

    // Default: assume retriable (conservative approach)
    return true;
  }

  /**
   * Enhance error with diagnostic context.
   *
   * Includes:
   * - Call index, type, model
   * - Quota status at failure time
   * - Time status at failure time
   * - Recent call history for context
   *
   * @private
   */
  enhanceError(error, context) {
    const enhanced = new Error(
      `[${context.callType}#${context.callIndex}] ${error.message}`
    );

    enhanced.callIndex = context.callIndex;
    enhanced.callType = context.callType;
    enhanced.model = context.model;
    enhanced.quotaStatus = context.quotaStatus;
    enhanced.timeStatus = context.timeStatus;
    enhanced.recentCalls = this.callHistory.slice(-5); // Last 5 calls for context
    enhanced.originalError = error;
    enhanced.timestamp = Date.now();

    return enhanced;
  }

  /**
   * Get current quota status.
   *
   * Returns:
   * - callsInWindow: Successful calls in current 60s window
   * - quotaLimit: Maximum allowed calls per window
   * - percentUsed: Percentage of quota consumed
   * - nextResetAt: Timestamp when window resets
   * - resetInMs: Milliseconds until reset
   *
   * @returns {Object} Quota status object
   */
  getQuotaStatus() {
    const now = Date.now();
    const windowAge = now - this.lastWindowReset;

    const callsInWindow = this.callHistory.filter(
      (call) =>
        call.status === "success" && now - call.timestamp < this.quotaWindow
    ).length;

    const nextResetAt = this.lastWindowReset + this.quotaWindow;

    return {
      callsInWindow,
      quotaLimit: this.quotaLimit,
      percentUsed: Math.round((callsInWindow / this.quotaLimit) * 100),
      nextResetAt,
      resetInMs: Math.max(0, nextResetAt - now),
      isExhausted: callsInWindow >= this.quotaLimit,
    };
  }

  /**
   * Get current time budget status.
   *
   * Returns:
   * - elapsedMs: Time elapsed since start
   * - budgetMs: Total time budget
   * - remainingMs: Time remaining until deadline
   * - percentUsed: Percentage of budget consumed (0-100+)
   * - isExceeded: Whether deadline has passed
   *
   * @returns {Object} Time status object
   */
  getTimeStatus() {
    const now = Date.now();
    const elapsedMs = now - this.startTime;
    const budgetMs = this.deadline - this.startTime;
    const remainingMs = Math.max(0, this.deadline - now);

    return {
      elapsedMs,
      budgetMs,
      remainingMs,
      percentUsed: Math.round((elapsedMs / budgetMs) * 100),
      isExceeded: now > this.deadline,
      formattedRemaining: this.formatMs(remainingMs),
    };
  }

  /**
   * Get comprehensive status report.
   *
   * Includes:
   * - Current time (for debugging)
   * - Quota metrics
   * - Time metrics
   * - Call metrics (total, successful, failed)
   * - Recent call history (last 10 calls)
   * - Health assessment (quota ok, time ok, no errors)
   *
   * @returns {Object} Comprehensive status
   */
  getStatus() {
    const now = Date.now();

    return {
      timestamp: now,
      quotaStatus: this.getQuotaStatus(),
      timeStatus: this.getTimeStatus(),
      callMetrics: {
        totalAttempted: this.totalCallsAttempted,
        totalSucceeded: this.totalCallsSucceeded,
        totalFailed: this.totalCallsFailed,
        deferralCount: this.deferralCount,
      },
      recentCalls: this.callHistory.slice(-10).map((call) => ({
        timestamp: call.timestamp,
        callType: call.callType,
        callIndex: call.callIndex,
        model: call.model,
        status: call.status,
        age: now - call.timestamp,
      })),
      isHealthy: {
        quotaOk: this.getQuotaStatus().percentUsed < 100,
        timeOk: this.getTimeStatus().percentUsed < 100,
        noErrors: this.totalCallsFailed === 0,
      },
    };
  }

  /**
   * Emit status change event to listeners.
   *
   * @private
   */
  emitStatus(status) {
    try {
      this.config.onStatusChange(status);
    } catch (callbackError) {
      // Don't let callback errors interrupt execution
      console.error(
        "[CallManager] onStatusChange callback error:",
        callbackError
      );
    }
  }

  /**
   * Emit deferral event to listeners.
   *
   * @private
   */
  emitDeferral(info) {
    try {
      this.config.onDeferral(info);
    } catch (callbackError) {
      console.error("[CallManager] onDeferral callback error:", callbackError);
    }
  }

  /**
   * Sleep for specified duration.
   *
   * @private
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Format milliseconds as human-readable string (e.g., "2m 30s").
   *
   * @private
   */
  formatMs(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / 1000 / 60) % 60);
    const hours = Math.floor(ms / 1000 / 60 / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Reset CallManager state (clears call history and deferral count).
   * Useful for testing or starting fresh.
   *
   * @public
   */
  reset() {
    this.callHistory = [];
    this.lastWindowReset = Date.now();
    this.deferralCount = 0;
    this.totalCallsAttempted = 0;
    this.totalCallsSucceeded = 0;
    this.totalCallsFailed = 0;
  }
}

module.exports = CallManager;
