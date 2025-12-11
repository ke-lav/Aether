const fs = require("fs");
const path = require("path");

/**
 * Gemini API Quota Tracker
 *
 * Manages per-minute call counting, quota exhaustion detection, and backoff logic.
 * Implements a simple counter-based rate limiter for Gemini free tier (20 calls/minute).
 */
class QuotaTracker {
  constructor(limit = 20, windowMs = 60000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.callCount = 0;
    this.windowStart = Date.now();
    this.pauseUntil = null;
    this.dailyCallCount = 0;
    this.lastError = null;
    this.lastCallTime = Date.now();
  }

  recordCall() {
    this.rotateWindow();

    if (this.isPaused()) {
      const waitMs = this.pauseUntil - Date.now();
      const waitSec = Math.ceil(waitMs / 1000);
      return {
        success: false,
        reason: "paused",
        message: `Still in quota cooldown. Wait ${waitSec}s.`,
      };
    }

    if (this.callCount >= this.limit) {
      this.pause();
      const waitMs = this.pauseUntil - Date.now();
      const waitSec = Math.ceil(waitMs / 1000);
      return {
        success: false,
        reason: "quota_exhausted",
        message: `Quota exhausted (${this.callCount}/${this.limit}). Pausing ${waitSec}s.`,
      };
    }

    this.callCount++;
    this.dailyCallCount++;
    this.lastCallTime = Date.now();

    const percentUsed = (this.callCount / this.limit) * 100;
    if (percentUsed >= 75) {
      console.warn(
        `[QuotaTracker] WARNING: ${this.callCount}/${
          this.limit
        } calls used (${Math.round(percentUsed)}%)`
      );
    }

    return {
      success: true,
      callCount: this.callCount,
      remaining: this.limit - this.callCount,
    };
  }

  getStatus() {
    this.rotateWindow();
    const percentUsed = Math.round((this.callCount / this.limit) * 100);
    const isPaused = this.isPaused();
    const secondsUntilReset = isPaused
      ? Math.ceil((this.pauseUntil - Date.now()) / 1000)
      : 0;

    return {
      callCount: this.callCount,
      limit: this.limit,
      remaining: Math.max(0, this.limit - this.callCount),
      percentUsed,
      isPaused,
      pauseUntil: this.pauseUntil,
      secondsUntilReset: Math.max(0, secondsUntilReset),
      dailyCallCount: this.dailyCallCount,
      lastError: this.lastError,
    };
  }

  getMessage() {
    const percentUsed = Math.round((this.callCount / this.limit) * 100);
    const isPaused = this.isPaused();
    const remaining = Math.max(0, this.limit - this.callCount);
    const secondsUntilReset = isPaused
      ? Math.ceil((this.pauseUntil - Date.now()) / 1000)
      : 0;

    if (isPaused) {
      return `Quota cooldown active. Resume in ${secondsUntilReset}s.`;
    }
    if (percentUsed >= 90) {
      return `Quota at ${percentUsed}%. ${remaining} calls remaining.`;
    }
    if (percentUsed >= 75) {
      return `Quota approaching. ${remaining} calls left.`;
    }
    return `Quota normal. ${remaining}/${this.limit} calls available.`;
  }

  rotateWindow() {
    const now = Date.now();
    if (now - this.windowStart > this.windowMs) {
      console.log(
        `[QuotaTracker] Window rotated. Calls in previous window: ${this.callCount}/${this.limit}`
      );
      this.windowStart = now;
      this.callCount = 0;
      this.pauseUntil = null;
    }
  }

  isPaused() {
    if (!this.pauseUntil) return false;
    return Date.now() < this.pauseUntil;
  }

  pause() {
    const pauseDuration = 65000;
    this.pauseUntil = Date.now() + pauseDuration;
    console.error(
      `[QuotaTracker] QUOTA EXHAUSTED. Pausing ${
        pauseDuration / 1000
      }s until ${new Date(this.pauseUntil).toISOString()}`
    );
  }

  handleQuotaError(error) {
    this.lastError = error.message || error.toString();
    const retryAfter = this.parseRetryAfter(error);
    if (retryAfter) {
      const pauseDuration = (retryAfter + 5) * 1000;
      this.pauseUntil = Date.now() + pauseDuration;
      console.warn(
        `[QuotaTracker] Quota error. Pause until ${new Date(
          this.pauseUntil
        ).toISOString()}`
      );
    } else {
      this.pause();
    }
  }

  parseRetryAfter(error) {
    const message = error.message || error.toString();
    const match = message.match(/retry in (\d+\.?\d*)\s*s/i);
    return match ? Math.ceil(parseFloat(match[1])) : null;
  }

  reset() {
    console.log("[QuotaTracker] Resetting quota tracker");
    this.callCount = 0;
    this.windowStart = Date.now();
    this.pauseUntil = null;
    this.lastError = null;
  }
}

// Export singleton instance
const quotaTracker = new QuotaTracker();
console.log("[QuotaTracker] Initialized (20 calls/min)");

// Small wrapper to call Google's Generative Language endpoints for TEXT or IMAGE modalities.
// Selects URL/key based on modality and returns parsed response. Does not throw on API errors —
// returns an object with ok/status/json/rawText and imageData (base64) when present.
async function callGemini({
  prompt,
  modality = "TEXT",
  generationConfig = {},
  imageB64 = null, // optional base64 image when using IMAGERY
}) {
  // choose env vars by modality
  const isText = modality === "TEXT";
  const isImage = modality === "IMAGE";
  const isImagery = modality === "IMAGERY"; // image understanding / reverse-check

  const apiUrl =
    (isText
      ? process.env.GEMINI_API_URL_TEXT
      : isImage
      ? process.env.GEMINI_API_URL_IMAGE
      : isImagery
      ? process.env.GEMINI_API_URL_IMAGERY
      : null) || process.env.GEMINI_API_URL;
  const rawKey =
    (isText
      ? process.env.GEMINI_API_KEY_TEXT
      : isImage
      ? process.env.GEMINI_API_KEY_IMAGE
      : isImagery
      ? process.env.GEMINI_API_KEY_IMAGE
      : null) || process.env.GEMINI_API_KEY;

  if (process.env.DEBUG_GEMINI_API === "1") {
    console.error("[DEBUG_GEMINI_API] Modality:", modality);
    console.error(
      "[DEBUG_GEMINI_API] API URL:",
      apiUrl ? apiUrl.substring(0, 50) + "..." : "MISSING"
    );
    console.error(
      "[DEBUG_GEMINI_API] API Key:",
      rawKey ? "SET (length=" + rawKey.length + ")" : "MISSING"
    );
  }

  if (!apiUrl || !rawKey) {
    return {
      ok: false,
      status: 0,
      error: "Missing GEMINI API URL or KEY for modality " + modality,
    };
  }

  // fetch implementation
  let fetchImpl = globalThis.fetch;
  if (!fetchImpl) {
    try {
      ({ fetch: fetchImpl } = require("undici"));
    } catch (e) {
      return {
        ok: false,
        status: 0,
        error: "No fetch available (require Node 18+ or add undici)",
      };
    }
  }

  const headers = { "Content-Type": "application/json" };
  if (/^AIza[0-9A-Za-z-_]+$/.test(rawKey)) headers["X-goog-api-key"] = rawKey;
  else if (/^ya29\./.test(rawKey))
    headers["Authorization"] = `Bearer ${rawKey}`;
  else headers["X-goog-api-key"] = rawKey;

  // Build request body using Gemini 2.5 multimodal payload format
  // Supports both text-only and text+image payloads
  // Reference: https://ai.google.dev/gemini-api/docs/vision
  const textPart =
    typeof prompt !== "undefined" && prompt !== null
      ? { text: String(prompt) }
      : null;
  const parts = [];
  if (textPart) parts.push(textPart);

  if (imageB64) {
    // Gemini 2.5 uses inline_data structure for embedded images
    // This allows mixing text and images freely within parts array
    parts.push({
      inline_data: {
        mime_type: "image/png",
        data: String(imageB64).replace(/\s+/g, ""),
      },
    });
  }

  // Gemini 2.5 requires role field in contents
  // role: "user" for prompts, "model" for model responses
  const body = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    ...(Object.keys(generationConfig || {}).length ? { generationConfig } : {}),
  };

  try {
    const resp = await fetchImpl(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const raw = await resp.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      /* not JSON */
    }

    // Debug logging for troubleshooting API issues
    if (process.env.DEBUG_GEMINI_API === "1") {
      console.error("[DEBUG_GEMINI_API] Status:", resp.status);
      console.error("[DEBUG_GEMINI_API] Raw response:", raw.substring(0, 500));
      console.error(
        "[DEBUG_GEMINI_API] Parsed JSON:",
        JSON.stringify(json).substring(0, 500)
      );
    }

    // Check if the API response contains an error (even if HTTP 200)
    // Gemini API returns error structure: { error: { code, message, ... } }
    if (json?.error) {
      const errorMsg = json.error.message || JSON.stringify(json.error);
      return {
        ok: false,
        status: json.error.code || 400,
        error: errorMsg,
        json,
        rawText: raw,
      };
    }

    // Attempt to find text candidate
    const textContent =
      json?.candidates?.[0]?.content?.parts?.[0]?.text || null;

    // Try to find image data in common fields
    function findImage(o) {
      if (!o) return null;
      if (typeof o === "string") {
        const m = o.match(
          /data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\n\r]+)/
        );
        if (m)
          return {
            mime: m[1] === "jpeg" ? "image/jpeg" : "image/png",
            b64: m[2].replace(/\s+/g, ""),
          };
        if (o.length > 1000 && /^[A-Za-z0-9+/=\n\r]+$/.test(o))
          return { mime: "image/png", b64: o.replace(/\s+/g, "") };
      }
      if (Array.isArray(o)) {
        for (const v of o) {
          const f = findImage(v);
          if (f) return f;
        }
      }
      if (typeof o === "object") {
        for (const k of Object.keys(o)) {
          const f = findImage(o[k]);
          if (f) return f;
        }
      }
      return null;
    }

    const imageFound = findImage(json) || null;

    return {
      status: resp.status,
      json,
      rawText: raw,
      text: textContent,
      image: imageFound,
    };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

module.exports = { callGemini, quotaTracker };
