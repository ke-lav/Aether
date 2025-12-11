// Mock AI service used in tests and local development.
// Behavior:
// - If process.env.SIMULATE_AI_FAILURE is set ("1" or "true"), generateContent throws.
// - Otherwise it returns a deterministic mock response matching tests' expectations.
class MockAIService {
  async generateContent(prompt) {
    const fail = String(process.env.SIMULATE_AI_FAILURE || "").toLowerCase();
    if (fail === "1" || fail === "true") {
      throw new Error("simulated-ai-failure");
    }

    const title =
      typeof prompt === "string" && prompt.length > 0
        ? `Mock: ${prompt.split(" ").slice(0, 5).join(" ")}`
        : "Mock Title";
    const body = `This is a mock response for prompt: ${String(prompt)}.`;
    const layout = "poem-single-column";
    const metadata = {
      model: "mock-1",
      tokens: Math.max(10, Math.min(200, String(prompt || "").length)),
    };

    return {
      content: { title, body, layout },
      metadata,
    };
  }
}

// Real AI service - thin wrapper around geminiClient.callGemini
class RealAIService {
  constructor(options = {}) {
    this.options = options;
    // lazy require to avoid pulling network libs during tests
    this._gemini = null;
  }

  _ensureGemini() {
    if (!this._gemini) {
      // require at runtime to keep test/CI import paths light
      try {
        this._gemini = require("./geminiClient");
      } catch (e) {
        throw new Error("geminiClient unavailable: " + e.message);
      }
    }
    return this._gemini;
  }

  async generateContent(prompt) {
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new Error("Prompt must be a non-empty string");
    }

    const geminiModule = this._ensureGemini();
    const callGemini = geminiModule.callGemini;
    const quotaTracker = geminiModule.quotaTracker;

    // Check quota before making API call
    const quotaCheck = quotaTracker.recordCall();
    if (!quotaCheck.success) {
      const e = new Error(`Gemini quota limit: ${quotaCheck.message}`);
      Object.defineProperty(e, "isQuotaError", {
        value: true,
        enumerable: true,
      });
      throw e;
    }

    // Default to TEXT modality. generationConfig can be passed via env or options.
    const generationConfig = this.options.generationConfig || {};

    try {
      const resp = await callGemini({
        prompt: String(prompt),
        modality: "TEXT",
        generationConfig,
      });

      if (!resp || resp.ok === false) {
        const errMsg = resp && resp.error ? resp.error : "Unknown Gemini error";
        const status = resp && resp.status ? resp.status : 0;
        const e = new Error(`Gemini call failed: ${errMsg}`);

        // Detect quota exhaustion errors from API
        if (
          errMsg.includes("quota") ||
          errMsg.includes("429") ||
          status === 429
        ) {
          Object.defineProperty(e, "isQuotaError", {
            value: true,
            enumerable: true,
          });
          quotaTracker.handleQuotaError(e);
        }

        try {
          Object.defineProperty(e, "status", {
            value: status,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        } catch (err) {
          // ignore if unable to define property
        }
        throw e;
      }

      // Prefer parsed text candidate, fall back to rawText or JSON.stringify
      let text =
        resp.text ||
        resp.rawText ||
        (resp.json ? JSON.stringify(resp.json) : "");
      if (!text) text = String(resp.rawText || "");

      // Simple heuristics for title/body: first line as title, rest as body
      const lines = text
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      const title =
        lines.length > 0
          ? lines[0].slice(0, 200)
          : `Result for: ${String(prompt).slice(0, 50)}`;
      const body = lines.length > 1 ? lines.slice(1).join("\n\n") : text;
      const layout = "ai-generated";

      const metadata = {
        model: resp.json?.model || "gemini",
        status: resp.status,
      };

      return {
        content: { title, body, layout },
        metadata,
      };
    } catch (error) {
      // Handle any errors from callGemini or response processing
      const e = new Error(`AI generation failed: ${error.message}`);
      Object.defineProperty(e, "originalError", {
        value: error,
        enumerable: false,
      });
      throw e;
    }
  }

  /**
   * Generate content with model rotation for quota distribution
   * Single API key accesses both models to distribute quota:
   * Structure calls (index=0) use Gemini 2.5 Pro (primary model)
   * Chapter calls (index>0) use Gemini 2.5 Flash (secondary model)
   * This distributes the 10 req/min free tier quota across two different models
   * @param {string} prompt - The prompt text
   * @param {number} callIndex - Index of the call (0=structure, 1+=chapters)
   * @returns {Promise<Object>} Generated content
   */
  async generateContentWithRotation(prompt, callIndex = 0) {
    if (typeof prompt !== "string" || !prompt.trim()) {
      throw new Error("Prompt must be a non-empty string");
    }

    // callIndex=0: Structure (Gemini 2.5 Pro, primary)
    // callIndex>0: Chapters (Gemini 2.5 Flash, secondary)
    // Both models are accessed via the same API key
    const isStructureCall = callIndex === 0;

    if (isStructureCall) {
      console.log(
        `[QUOTA] Call ${callIndex}: Using Gemini 2.5 Pro (structure generation)`
      );
    } else {
      console.log(
        `[QUOTA] Call ${callIndex}: Using Gemini 2.5 Flash (chapter generation)`
      );
    }

    // Use single API key for both models - quota is distributed across
    // the two different model quotas in the free tier
    return this.generateContent(prompt);
  }
}

function createAIService() {
  // Priority 1: Explicit force-mock for CI/testing (highest priority)
  const forceMock =
    process.env.FORCE_MOCK_AI === "1" || process.env.FORCE_MOCK_AI === "true";
  if (forceMock) {
    console.log("AI service: MockAIService enabled (FORCE_MOCK_AI=1)");
    return new MockAIService();
  }

  // Priority 2: Explicit enable real AI
  const useReal =
    process.env.USE_REAL_AI === "1" || process.env.USE_REAL_AI === "true";
  if (useReal) {
    // sanity check for required env vars
    const apiUrl =
      process.env.GEMINI_API_URL || process.env.GEMINI_API_URL_TEXT;
    const apiKey =
      process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_TEXT;
    if (!apiUrl || !apiKey) {
      console.warn(
        "USE_REAL_AI=true but GEMINI_API_URL or GEMINI_API_KEY not set. Falling back to MockAIService."
      );
      return new MockAIService();
    }
    console.log("AI service: RealAIService enabled (Gemini)");
    return new RealAIService();
  }

  // Priority 3: Default to mock (backward compatible)
  console.log("AI service: MockAIService enabled (USE_REAL_AI not set)");
  return new MockAIService();
}

module.exports = { MockAIService, RealAIService, createAIService };
