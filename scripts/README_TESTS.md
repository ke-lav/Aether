# Test Scripts Documentation

This directory contains various test and validation scripts for the AetherPress application. Below is a comprehensive guide to each test script.

## Core Test Scripts

### test-step1.js

**Purpose**: End-to-End HTML Pipeline Testing

Tests the 3-layer logging infrastructure and HTML field flow for the ebook generation API.

**What it tests**:

- HTML field generation and presence
- HTML size validation (> 5000 bytes)
- Title field extraction and validity
- Chapters array structure and content
- Metadata (theme, page count)

**Usage**:

```bash
node scripts/test-step1.js
```

**Prerequisites**:

- Server running on localhost:3000
- `/api/ebook/generate` endpoint available

**Expected output**:

- HTML Pipeline status (PASS/FAIL)
- Title Display status (PASS/FAIL)
- Chapters validation status (PASS/FAIL)

---

### test-title-debug.js

**Purpose**: Detailed Title Debug Test

Debugs title extraction and data flow in ebook generation responses.

**What it tests**:

- Response title field
- Metadata title field
- First chapter title
- Full response structure inspection

**Usage**:

```bash
node scripts/test-title-debug.js
```

**Prerequisites**:

- Server running on localhost:3000
- `/api/ebook/generate` endpoint available

**Expected output**:

- Response title value
- Metadata title value
- Chapter title information
- Full response keys
- Sample response structure (first 1000 chars)

---

### test-cache-clear.js

**Purpose**: Cache Clear Endpoint Testing (Step 2.2)

Tests the cache clearing functionality via the API.

**What it tests**:

- POST /api/cache/clear endpoint
- Cache result deletion count
- Export job deletion count
- Success/failure status

**Usage**:

```bash
node scripts/test-cache-clear.js
```

**Prerequisites**:

- Server running on localhost:3000
- `/api/cache/clear` endpoint available

**Expected output**:

- Status Code
- Success boolean
- Message from server
- Number of cleared results
- Number of cleared export jobs
- Summary with ✅ or ❌ status

---

## Other Test Scripts in This Directory

### test-export-html-fallback.js

Tests HTML export fallback functionality for PDF generation.

### test-export-roundtrip.js

Tests the complete export roundtrip process.

### test-generate-preview.js

Tests preview generation without export.

### test-generate-preview-with-export.js

Tests preview generation with export functionality.

### test-load-demo.js

Tests demo data loading.

### test-summer-suggestion.js

Tests summer-related content suggestions.

### test-task1-fix.js

Tests Task 1 specific fixes.

### validate-ebook-e2e.js

End-to-end validation for ebook generation.

---

## Running Tests

### Prerequisites for All Tests

1. Server running on localhost:3000
2. Node.js environment with required dependencies
3. Appropriate API endpoints available

### Quick Testing Session

```bash
# Run the primary test sequence
node scripts/test-step1.js
node scripts/test-title-debug.js
node scripts/test-cache-clear.js
```

### Environment Variables

Some tests may require environment variables:

- `DEBUG_GEMINI_API=1` - For API credential tests
- `PORT` - Override default port (defaults to 3000)
- `NODE_ENV` - Set environment (development/production/test)

---

## Test Output Interpretation

### Success Indicators

- ✅ Green checkmarks in output
- Status Code 200 or 201
- `success: true` in JSON responses
- PASS status for pipeline tests

### Failure Indicators

- ❌ Red X marks in output
- Error status codes (4xx, 5xx)
- `success: false` in JSON responses
- FAIL status for pipeline tests

---

## Notes

- All tests use HTTP requests to localhost:3000
- Tests are designed to be run manually during development
- Some tests are dependency tests for validating specific features
- For CI/CD integration, see `.github/workflows/` directory
- Tests can be run in any order unless explicitly dependent
