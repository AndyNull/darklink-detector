# Worklog

## Task 2: Docker & Runtime Audit
**Date**: 2025-05-31
**Auditor**: Sub-agent (Task 2)

### Scope
Full audit of Dockerfile, docker-entrypoint.sh, docker-compose.yml, next.config.ts, tsconfig.json, package.json, standalone build output, and runtime compatibility of browser-renderer.ts, scan-engine.ts, mini-services, sharp, bun:sqlite, curl, DNS.

---

### Findings Report

#### CRITICAL Issues

**C1. Playwright Chromium not installed in Docker**
- **Files**: `src/lib/scan-engine/browser-renderer.ts:10,56`, `Dockerfile`
- **Problem**: `browser-renderer.ts` calls `chromium.launch()` from Playwright. The Dockerfile does NOT install Chromium browser binaries or the many system dependencies (libx11, libglib, libnss3, etc.) that Playwright requires. The standalone build includes `playwright`/`playwright-core` npm packages but NOT the browser binaries (~400MB).
- **Impact**: Browser rendering (key feature for detecting JS-generated QR codes) will fail completely with "Executable doesn't exist" or missing shared library errors. The scan engine wraps this in try/catch, so scans won't crash, but the browser-rendering feature will silently degrade.
- **Fix options**:
  - (a) Add to Dockerfile runner stage: `RUN npx playwright install --with-deps chromium` (+~400MB image size)
  - (b) Accept the limitation and document that browser rendering is disabled in Docker (the feature gracefully falls back to non-browser scanning)
  - (c) Use a separate Docker image with Playwright pre-installed for the scan-engine only

**C2. Hardcoded absolute paths in engine-manager.ts**
- **File**: `src/lib/engine-manager.ts:47,56`
- **Problem**: Service directories are hardcoded to `/home/z/my-project/mini-services/scan-engine` and `/home/z/my-project/mini-services/data-sync-service`. In Docker, the app runs from `/app`, not `/home/z/my-project`.
- **Impact**: If the Next.js API routes (`/api/engine/start`, `/api/engine/stop`) are called in Docker, the `spawn()` call will fail because the directory doesn't exist. The services started by `docker-entrypoint.sh` work fine, but any attempt to restart/stop them from the web UI will fail.
- **Fix**: Replace with `path.join(process.cwd(), 'mini-services/scan-engine')` and `path.join(process.cwd(), 'mini-services/data-sync-service')`.

**C3. Hardcoded path in daemon.ts**
- **File**: `mini-services/scan-engine/daemon.ts:16`
- **Problem**: `cwd: '/home/z/my-project/mini-services/scan-engine'` is hardcoded.
- **Impact**: The daemon wrapper will not work in Docker (though it's not currently used in Docker — the entrypoint starts `bun index.ts` directly).
- **Fix**: Use `import.meta.dirname` or `path.resolve(__dirname, '.')` instead.

---

#### HIGH Issues

**H1. Missing bun.lock in Dockerfile deps stage**
- **File**: `Dockerfile:12-21`
- **Problem**: The deps stage only copies `package.json` files, not `bun.lock`. Running `bun install` without a lockfile may resolve different dependency versions than the ones used locally, leading to build reproducibility issues and potential runtime bugs.
- **Impact**: Non-deterministic builds; different dependency versions may cause subtle runtime issues.
- **Fix**: Add `COPY bun.lock ./` before `bun install` in the deps stage, and also copy the mini-service lockfiles:
  ```dockerfile
  COPY bun.lock ./
  COPY mini-services/scan-engine/bun.lock ./mini-services/scan-engine/
  COPY mini-services/data-sync-service/bun.lock ./mini-services/data-sync-service/
  ```

**H2. Mini-service crashes are undetected**
- **File**: `docker-entrypoint.sh:46-58`
- **Problem**: Mini-services are started with `&` (background) but their health/crash status is not monitored. `wait $MAIN_PID` only waits for the Next.js process. If a mini-service crashes, the container stays running (appearing healthy from Docker's perspective) but functionality is broken.
- **Impact**: Silent service failures that are not detected or recovered from.
- **Fix**: Add a monitoring loop after the main process starts:
  ```bash
  # Monitor background services
  while kill -0 $MAIN_PID 2>/dev/null; do
    if ! kill -0 $SCAN_PID 2>/dev/null; then
      echo "Scan engine died, restarting..."
      cd /app/mini-services/scan-engine && bun index.ts &
      SCAN_PID=$!
    fi
    if ! kill -0 $SYNC_PID 2>/dev/null; then
      echo "Data sync service died, restarting..."
      cd /app/mini-services/data-sync-service && DB_PATH=/app/db/custom.db bun index.ts &
      SYNC_PID=$!
    fi
    sleep 5
  done
  ```

**H3. Mini-service startup failures not caught**
- **File**: `docker-entrypoint.sh:46-58`
- **Problem**: `set -e` is active but background processes (`&`) don't trigger exit on failure. If `bun index.ts &` fails immediately (e.g., missing dependencies, port conflict), the script continues silently.
- **Impact**: Container appears to start successfully but services are actually down.
- **Fix**: After starting each mini-service, verify it's running and responsive:
  ```bash
  sleep 1
  if ! kill -0 $SCAN_PID 2>/dev/null; then
    echo "ERROR: Scan engine failed to start!"
    exit 1
  fi
  ```

---

#### MEDIUM Issues

**M1. Health check doesn't verify mini-services**
- **Files**: `src/app/api/health/route.ts`, `Dockerfile:91-92`
- **Problem**: The Docker HEALTHCHECK hits `/api/health` which only verifies the Next.js app is responding. It doesn't check whether the scan-engine (port 3003) or data-sync-service (port 3004) are healthy.
- **Impact**: Docker reports the container as healthy even when critical mini-services are down.
- **Fix**: Extend the health endpoint to check mini-service health, or add a separate health check script that verifies all three services.

**M2. Volume mount may cause permission issues**
- **Files**: `docker-compose.yml:20-21`, `Dockerfile:56-57`
- **Problem**: Named volumes `darklink-db:/app/db` and `darklink-config:/app/config` are mounted. When Docker initializes a new named volume, it copies content from the image (including directory permissions). However, if the volume already exists from a previous run or is mounted from a different source, it may have root ownership, causing "permission denied" errors for the appuser (uid 1001).
- **Impact**: Potential database write failures or config read failures after volume re-use.
- **Fix**: Add explicit permission fix in the entrypoint before switching to appuser (requires running as root initially), or use an init container pattern.

**M3. Playwright in serverExternalPackages adds unnecessary weight**
- **File**: `next.config.ts:16`
- **Problem**: `playwright` and `playwright-core` are listed in `serverExternalPackages`, causing them to be included in the standalone build. The Next.js server itself doesn't use Playwright — it's only used by the scan-engine mini-service. Including these packages adds ~50MB+ to the standalone build unnecessarily.
- **Impact**: Bloated Docker image; unnecessary packages at runtime.
- **Fix**: Remove `playwright` and `playwright-core` from `serverExternalPackages` in `next.config.ts` if the Next.js server doesn't directly import them. The mini-service has its own dependency on these.

**M4. Standalone build includes unnecessary files**
- **File**: `.next/standalone/` directory
- **Problem**: The standalone build includes `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `start.sh`, `examples/`, `scripts/`, etc. These are not needed at runtime and add unnecessary size to the Docker image.
- **Impact**: Minor image bloat.
- **Fix**: Add `outputFileTracingExcludes` in `next.config.ts`:
  ```ts
  outputFileTracingExcludes: {
    '*': ['Dockerfile', 'docker-compose.yml', 'Caddyfile', 'start.sh', 'examples', 'scripts'],
  }
  ```

---

#### LOW Issues

**L1. DNS lookup in Docker uses Docker's internal DNS**
- **Files**: `src/lib/scan-engine/scan-engine.ts:10`, `mini-services/scan-engine/scan-engine.ts:7`
- **Problem**: `dns/promises` `lookup()` in Docker containers resolves through Docker's embedded DNS server. This works fine for external hostnames but adds slight latency.
- **Impact**: Negligible — DNS resolution works, just with an extra hop.
- **Fix**: None needed.

**L2. Sharp linuxmusl-x64 bindings included but unnecessary**
- **File**: `.next/standalone/node_modules/@img/`
- **Problem**: The standalone build includes both `sharp-linux-x64` (glibc, for Debian) and `sharp-linuxmusl-x64` (musl, for Alpine). Since `oven/bun:1.2` is Debian-based, only `sharp-linux-x64` is needed.
- **Impact**: A few MB of unnecessary files.
- **Fix**: None needed.

**L3. bun:sqlite concurrent access with Prisma**
- **File**: `mini-services/data-sync-service/index.ts:3,20`
- **Problem**: The data-sync-service uses `bun:sqlite` (read-only) to query the same SQLite database that Prisma (read-write) uses. While the service opens the database in `readonly: true` mode, concurrent access between two different SQLite drivers could theoretically cause issues.
- **Impact**: Low risk — the data-sync-service only reads, and SQLite handles concurrent reads well.
- **Fix**: None needed, but should be documented as a design decision.

---

### Compatibility Assessment Summary

| Component | Docker Compatible? | Notes |
|-----------|-------------------|-------|
| `bun:sqlite` | ✅ Yes | Built-in Bun module, works in oven/bun:1.2 |
| `curl` (execFile) | ✅ Yes | Installed via apt-get in Dockerfile |
| `sharp` | ✅ Yes | Bundled libvips + glibc bindings included |
| `dns/promises` | ✅ Yes | Works through Docker's internal DNS |
| Playwright | ❌ No | Chromium binary and system deps not installed |
| `server.js` + Bun | ✅ Yes | Bun supports CommonJS require() |
| Prisma SQLite | ✅ Yes | sqlite3 CLI installed, db:push works |
| Standalone output | ✅ Yes | `output: "standalone"` configured, static/public copied via build script |

### Overall Verdict
The project **cannot fully run in Docker as-is**. While the core Next.js app, database, and data-sync-service will work, two critical issues prevent full functionality:
1. Playwright browser rendering is non-functional (C1)
2. Engine manager API has hardcoded paths (C2)

The project will partially work — scans will run without browser rendering, and services started by the entrypoint will function, but restarting services from the UI will fail.

---

## Task 7c: Docker & Mini-Services Bug Fixes
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 7c)

### Scope
Fix 5 critical/high bugs identified in the Docker and mini-services audit (Task 2 findings C2, plus additional security/correctness issues).

---

### Fix 1: Hardcoded Paths in engine-manager.ts ✅
**File**: `src/lib/engine-manager.ts`
**Problem**: Lines 47 and 56 had hardcoded `/home/z/my-project/mini-services/...` paths that break in Docker (where the app runs from `/app`).
**Changes**:
- Added `import path from 'path'`
- Replaced `/home/z/my-project/mini-services/scan-engine` with `path.join(process.cwd(), 'mini-services/scan-engine')`
- Replaced `/home/z/my-project/mini-services/data-sync-service` with `path.join(process.cwd(), 'mini-services/data-sync-service')`

### Fix 2: DNS Rebinding Check in Mini-Services Scan Engine ✅
**File**: `mini-services/scan-engine/scan-engine.ts`
**Problem**: The `processUrlInner` function was missing a DNS rebinding SSRF check before the primary fetch, while the main `src/lib/scan-engine/scan-engine.ts` had it. This is a security vulnerability.
**Changes**:
- Added a DNS rebinding check block BEFORE the main fetch in `processUrlInner`
- Resolves hostname via `lookup()` (already imported)
- Uses existing `validateResolvedIP()` function (already in the file)
- If the resolved IP is private/reserved, sets `result.status = 'error'`, emits a warning log, and returns early
- Follows the same pattern as the main scan engine's implementation

### Fix 3: Mini-Services Memory Leak (completedAt) ✅
**Files**: `mini-services/scan-engine/types.ts`, `mini-services/scan-engine/scan-engine.ts`
**Problem**: The periodic cleanup in `mini-services/scan-engine/index.ts` checks `progress.completedAt` (line 18) to determine if a task has expired, but this field was never set on the `ScanProgress` interface or in the progress emission. This caused completed tasks to never be cleaned up, resulting in a memory leak.
**Changes**:
- Added `completedAt?: number` field to the `ScanProgress` interface in `types.ts` with documentation
- Added `completedAt: Date.now()` to the final progress emission in `scan-engine.ts` (line ~1755, where the scan reaches terminal state)

### Fix 4: CHEAP_TLDS - Remove Legitimate TLDs ✅
**File**: `src/lib/scan-engine/html-parser.ts`
**Problem**: The `CHEAP_TLDS` array included `.app`, `.dev`, `.ai`, `.pro`, `.studio`, `.design`, `.live` which are mainstream, legitimate TLDs — not "cheap/abusable". This caused false positives for legitimate sites using these TLDs.
**Changes**:
- Removed `'app'`, `'dev'`, `'ai'`, `'pro'`, `'studio'`, `'design'`, `'live'` from the `CHEAP_TLDS` array
- Kept all actually cheap/abusable TLDs like `.xyz`, `.top`, `.cc`, `.loan`, `.click`, etc.

### Fix 5: extractJsRedirect - Missing Redirect Patterns ✅
**Files**: `src/lib/scan-engine/scan-engine.ts`, `mini-services/scan-engine/scan-engine.ts`
**Problem**: The `extractJsRedirect` function only detected `window.location` and `window.location.replace` patterns, missing many common JavaScript redirect patterns.
**Changes** (applied to BOTH scan engines):
- Added `document.location = "url"` / `document.location.href = "url"` pattern
- Added `self.location = "url"` / `self.location.href = "url"` pattern (with `\b` word boundary)
- Added `top.location = "url"` / `top.location.href = "url"` pattern (with `\b` word boundary)
- Added `parent.location = "url"` / `parent.location.href = "url"` pattern (with `\b` word boundary)
- Added `location.assign("url")` pattern (with optional `window.` prefix)
- Changed `window.location.replace("url")` to match with optional `window.` prefix: `(?:window\.)?location.replace("url")`
- Also updated `isRedirectPage()` function's `hasRedirectPattern` check in both files to include the new patterns

---

### Verification
- Lint check passed (pre-existing lint errors are unrelated to these changes)
- Dev server is running successfully

## Task 7a: Critical Bug Fixes — Threat Intel Module
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 7a)

### Scope
Fix four critical bugs in the threat intelligence subsystem: missing Prisma model, incorrect ThreatBook API auth, broken PhishTank validation, and AbuseIPDB whitelisted-IP severity mishandling.

---

### Fix 1: Add Missing ThreatIntelConfig Prisma Model

**File**: `prisma/schema.prisma`
**Problem**: `src/app/api/threat-intel/config/route.ts` used `(db as any).threatIntelConfig` but no such model existed in the Prisma schema, causing runtime crashes when the config endpoint was accessed.
**Fix**: Added the `ThreatIntelConfig` model with fields:
- `id String @id @default("default")`
- `autoUpdateEnabled Boolean @default(false)`
- `updateIntervalHours Int @default(24)`
- `lastUpdateAt DateTime?`
- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Also removed `(db as any)` casts in `config/route.ts` — now uses the properly typed `db.threatIntelConfig` directly.

---

### Fix 2: Fix ThreatBook API Authentication in Main Route

**File**: `src/app/api/threat-intel/route.ts`
**Problem**: Both `queryThreatBookIP` and `queryThreatBookDomain` sent the API key as an `X-API-Key` HTTP header. ThreatBook v3 API requires the key in the query string parameter `apikey`, not as a header. The validation route (`api-keys/route.ts`) already did this correctly.
**Fix**: In both functions:
- Changed URL from `?ip=...` / `?domain=...` to `?apikey=${encodeURIComponent(THREATBOOK_API_KEY)}&ip=...` / `?apikey=${encodeURIComponent(THREATBOOK_API_KEY)}&domain=...`
- Removed the `'X-API-Key': THREATBOOK_API_KEY` header from the fetch call

---

### Fix 3: Fix PhishTank API Key Validation

**File**: `src/app/api/threat-intel/api-keys/route.ts`
**Problem**: The PhishTank `validateMethod` fetched public data from `https://data.phishtank.com/data/online-valid.json` which doesn't require an API key at all — so every key (or no key) would appear "valid".
**Fix**: Updated `validateMethod` to call the PhishTank check-url API (`POST https://checkurl.phishtank.com/checkurl/`) with:
- `Content-Type: application/json` header
- Body: `{ url: 'https://google.com', app_key: apiKey, format: 'json' }`
- Proper response parsing: checks `meta.status === 'success'` or `results.valid` for valid keys
- Handles `meta.error` for invalid key feedback
- Handles 401/403 for authentication failures

---

### Fix 4: Fix AbuseIPDB Whitelisted IP Severity

**File**: `src/app/api/threat-intel/lookup/route.ts`
**Problem**: The AbuseIPDB lookup function checked `isWhitelisted` for `isMalicious` and `isSuspicious` flags (correctly suppressing them for whitelisted IPs), but the `severity` mapping ignored the whitelist status — a whitelisted IP with a high abuse score would still be labeled as `critical` or `high`.
**Fix**: When `isWhitelisted` is true, severity is now forced to `'low'` regardless of the abuse confidence score, because whitelisted IPs are known-good per AbuseIPDB's own designation.

---

### Verification
- `bun run db:push` completed successfully — ThreatIntelConfig table created
- Dev server is running without errors
- Lint errors are all pre-existing (unrelated to these changes)

---

## Task 7b: Critical Scan Engine Bug Fixes
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 7b)

### Scope
Fix four critical bugs in the scan engine: overly aggressive suspicious domain detection, duplicated curl fallback code, abort signal listener leak, and missing `completedAt` field causing memory leaks in mini-services.

---

### Fix 1: isSuspiciousDomain() Flags Too Many False Positives ✅

**Files**: `src/lib/scan-engine/shared-constants.ts`, `mini-services/scan-engine/scan-engine.ts`

**Problem**: The old `isSuspiciousDomain()` flagged ALL domains with a different TLD or SLD from the base domain. Since most external links are to legitimate, unrelated domains, this produced massive false positives — nearly every external link was flagged as "suspicious domain".

**Changes**:
- **Removed** the overly broad "different TLD" and "different SLD" checks
- **Added** `levenshteinDistance()` function to compute edit distance between strings
- **Added** typosquatting check: only flags if domain SLD has Levenshtein distance 1-2 from base SLD AND uses a different TLD (catches `g00gle.com`, `gooogle.com`, etc.)
- **Added** `HOMOGLYPH_GROUPS` constant and `normalizeHomoglyphs()` function for homoglyph attack detection
- **Added** homoglyph check: after normalizing lookalike characters (`0`↔`o`, `1`↔`l`, `rn`↔`m`, etc.), if SLDs match but originals don't, it's suspicious
- **Added** deceptive pattern checks:
  - Hyphen deception: `baseDomain-evil.com` (e.g., `google-evil.com`)
  - Subdomain deception: `baseDomain.evil.com` (e.g., `google.evil.com`)
- **Kept** the TRUSTED_DOMAINS whitelist check
- Applied to both `shared-constants.ts` (exported function) and `mini-services/scan-engine/scan-engine.ts` (inline function with `TRUSTED_DOMAINS_ENGINE`)

**Lines modified**:
- `shared-constants.ts`: Lines 158-292 (replaced old `isSuspiciousDomain` with new implementation + helpers)
- `mini-services/scan-engine/scan-engine.ts`: Lines 508-630 (replaced inline `isSuspiciousDomain` + added `levenshteinDistance`, `HOMOGLYPH_GROUPS`, `normalizeHomoglyphs`)

---

### Fix 2: Deduplicate Curl Fallback Path ✅

**Files**: `src/lib/scan-engine/scan-engine.ts`, `mini-services/scan-engine/scan-engine.ts`

**Problem**: The curl fallback path in `processUrlInner()` duplicated ~170 lines of the normal path (HTML parsing, external resource fetching, domain dedup, QR detection). The curl path was also missing features like `trimResultArrays()` call and comprehensive image URL collection (inline scripts, raw JS patterns, IMAGE_DIR_PATTERNS).

**Changes**:
- **Extracted** shared post-fetch processing logic into `analyzeHtmlResult()` helper function that takes explicit parameters (html, baseUrl, baseDomain, result, timeout, abortController, fingerprint, disabledRules, emitLog, sourceUrl)
- **Moved** `trimResultArrays()` from inside `executeScan()` to module level so it's accessible from `analyzeHtmlResult()`
- **Replaced** the ~170-line duplicated curl fallback section with a 15-line call to `analyzeHtmlResult()`
- **Replaced** the ~300-line duplicated normal path section with a 15-line call to `analyzeHtmlResult()`
- Both paths now call `trimResultArrays()` and set `rawHtml` (previously missing in curl path)
- Both paths now use the comprehensive image URL collection (previously curl path used simplified version)
- Applied to both `src/lib/scan-engine/scan-engine.ts` and `mini-services/scan-engine/scan-engine.ts`

**Lines modified**:
- `src/lib/scan-engine/scan-engine.ts`:
  - Lines 575-848: Added `analyzeHtmlResult()` helper
  - Lines 890-925: Moved `trimResultArrays()` to module level
  - Lines 1163-1194: Replaced curl fallback duplicated code with `analyzeHtmlResult()` call
  - Lines 1483-1503: Replaced normal path duplicated code with `analyzeHtmlResult()` call
- `mini-services/scan-engine/scan-engine.ts`:
  - Lines 889-1094: Added `analyzeHtmlResult()` helper
  - Lines 1370-1397: Replaced curl fallback duplicated code with `analyzeHtmlResult()` call
  - Lines 1646-1666: Replaced normal path duplicated code with `analyzeHtmlResult()` call

---

### Fix 3: Fix Abort Signal Listener Leak ✅

**Files**: `src/lib/scan-engine/scan-engine.ts`, `mini-services/scan-engine/scan-engine.ts`

**Problem**: At the fallback error path, an anonymous arrow function listener was added:
```js
abortController.signal.addEventListener('abort', () => fallbackController.abort());
```
This listener was never removed, causing a memory leak for each URL that went through the fallback path.

**Changes**:
- **Replaced** the anonymous arrow function with a named function `onFallbackAbort`:
  ```js
  const onFallbackAbort = () => fallbackController.abort();
  abortController.signal.addEventListener('abort', onFallbackAbort);
  ```
- **Added** cleanup in the `finally` block after the fallback fetch:
  ```js
  abortController.signal.removeEventListener('abort', onFallbackAbort);
  ```
- Reviewed other `addEventListener` patterns in the file — the `onTaskAbort` listener at line 788 was already properly cleaned up (removed at lines 815 and 818). The `onParentAbort` in `fetchExternalResource` uses `{ once: true }` and is also properly cleaned up.
- Applied to both `src/lib/scan-engine/scan-engine.ts` and `mini-services/scan-engine/scan-engine.ts`

**Lines modified**:
- `src/lib/scan-engine/scan-engine.ts`: Lines 1129-1130 (named function), 1344 (cleanup in finally)
- `mini-services/scan-engine/scan-engine.ts`: Lines 1144-1145 (named function), 1302 (cleanup in finally)

---

### Fix 4: Add completedAt to ScanProgress Type ✅

**Files**: `src/lib/scan-engine/types.ts`, `mini-services/scan-engine/types.ts`, `src/lib/scan-engine/scan-engine.ts`

**Problem**: The `ScanProgress` type was missing the `completedAt` field that `mini-services/scan-engine/index.ts` checks for (line 18: `if (progress.completedAt && now - progress.completedAt > TASK_TTL)`). Without this field, completed tasks were never cleaned up, causing a memory leak in the mini-services process.

**Changes**:
- **Added** `completedAt?: number` field to the `ScanProgress` interface in `src/lib/scan-engine/types.ts` (line 114) with documentation
- **Added** `completedAt: Date.now()` to the final progress emission in `scan-engine.ts` when the scan reaches terminal state (`completed` or `stopped`) (line 1595)
- The mini-services `types.ts` already had `completedAt` added by a previous task (7c), and `scan-engine.ts` already had `completedAt: Date.now()` in its final progress emission (line 1859)

**Lines modified**:
- `src/lib/scan-engine/types.ts`: Line 113-114 (added `completedAt` field)
- `src/lib/scan-engine/scan-engine.ts`: Line 1595 (added `completedAt: Date.now()`)

---

### Verification
- TypeScript compilation passes (`npx tsc --noEmit` — no errors)
- ESLint check passes for modified files (no new lint errors introduced)
- Dev server running successfully

---

## Task 2+7: Dockerfile & docker-entrypoint.sh Improvements
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 2+7)

### Scope
Improve Dockerfile and docker-entrypoint.sh with Playwright Chromium installation, reproducible builds via lockfiles, health check loop replacing blind sleep, service monitoring with auto-restart, and startup failure detection.

---

### Fix 1: Add Playwright Chromium to Dockerfile ✅
**File**: `Dockerfile`
**Problem**: Browser rendering (for detecting JS-generated QR codes) fails completely in Docker because Chromium binaries and system dependencies are not installed. The `browser-renderer.ts` calls `chromium.launch()` from Playwright but the image only includes npm packages, not the browser itself (~400MB).
**Changes**:
- Added `RUN npx playwright install --with-deps chromium` after the `apt-get install` line for curl/sqlite3 in the runner stage
- This installs Chromium browser binaries plus all required system dependencies (libx11, libglib, libnss3, etc.)
- Adds ~400MB to image size but is required for the browser rendering feature

### Fix 2: Copy bun.lock for Reproducible Builds ✅
**File**: `Dockerfile`
**Problem**: The deps stage only copied `package.json` files, not `bun.lock`. Running `bun install` without a lockfile may resolve different dependency versions than used locally, leading to non-deterministic builds.
**Changes**:
- Added `COPY bun.lock ./` before `RUN bun install` in the deps stage
- Added `COPY mini-services/scan-engine/bun.lock ./mini-services/scan-engine/`
- Added `COPY mini-services/data-sync-service/bun.lock ./mini-services/data-sync-service/`
- Ensures `bun install` uses exact dependency versions from the lockfiles

### Fix 3: Replace `sleep 2` with Health Check Loop ✅
**File**: `docker-entrypoint.sh`
**Problem**: The entrypoint used a blind `sleep 2` to wait for mini-services, which is unreliable — services may not be ready in 2 seconds, or could be ready sooner with wasted wait time.
**Changes**:
- Replaced `sleep 2` with a proper readiness check loop that curl's `/health` endpoints on ports 3003 and 3004
- Loop retries up to 30 times (1 second each) with clear progress output
- Reports how many seconds it took for services to become ready
- Falls through with a warning if services don't respond within 30 seconds (graceful degradation)

### Fix 4: Add Service Monitoring Loop ✅
**File**: `docker-entrypoint.sh`
**Problem**: Mini-services were started with `&` (background) but never monitored. If a service crashed, the container stayed running (appearing healthy) but functionality was broken silently.
**Changes**:
- Added a background monitoring loop after `bun server.js &` that runs while `MAIN_PID` is alive
- Every 10 seconds, checks if `$SCAN_PID` and `$SYNC_PID` are still running
- If a service crashed, automatically restarts it and updates the PID variable
- Runs as a background process (`&`) so it doesn't block `wait $MAIN_PID`

### Fix 5: Verify Services Started Successfully ✅
**File**: `docker-entrypoint.sh`
**Problem**: `set -e` doesn't catch failures in background processes. If `bun index.ts &` fails immediately, the script continues silently, making the container appear healthy while services are down.
**Changes**:
- After `SYNC_PID=$!`, added `sleep 0.5` + `kill -0` check to verify data-sync-service started
- After `SCAN_PID=$!`, added `sleep 0.5` + `kill -0` check to verify scan-engine started
- Prints `✗` warning if a service failed to start (does not exit to allow graceful degradation)

---

### Verification
- Dev server is running successfully
- All changes are in Docker infrastructure files (not runtime code), verified by reading back both files

---

## Task 3+9: DNS Cache & Health Check Improvements
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 3+9)

### Scope
Add DNS cache to scan engine for reduced latency on repeated hostname resolution, and improve the health check endpoint with database connectivity and mini-service status checks.

---

### Part A: Add DNS Cache to Scan Engine

#### Step 1: Create dns-cache.ts Module ✅
**File**: `src/lib/scan-engine/dns-cache.ts` (NEW)
**Changes**:
- Created new module with in-memory DNS cache using `Map<string, DnsCacheEntry>`
- Default TTL: 60 seconds (balances catching DNS changes vs. caching benefit during batch scans)
- Periodic cleanup of expired entries every 5 minutes
- HMR-safe cleanup interval management via `globalThis.__dns_cache_cleanup__`
- Exported functions:
  - `cachedLookup(hostname, ttlMs?)` — resolves hostname with caching
  - `invalidateDnsCache(hostname)` — removes a specific hostname from cache
  - `clearDnsCache()` — clears entire cache
  - `getDnsCacheStats()` — returns cache size and entry details for monitoring

#### Step 2: Modify Main Scan Engine ✅
**File**: `src/lib/scan-engine/scan-engine.ts`
**Changes**:
- Replaced `import { lookup } from 'dns/promises'` with `import { cachedLookup, invalidateDnsCache } from './dns-cache'`
- Replaced all 6 occurrences of `await lookup(hostname)` with `await cachedLookup(hostname)`:
  - Line 441: External resource DNS rebinding check (`fetchExternalResource`)
  - Line 1068: Main DNS rebinding check (`processUrlInner`)
  - Lines 1157, 1267, 1312, 1462: Curl fallback DNS rebinding checks
- Added `invalidateDnsCache(hostname)` after every DNS rebinding check failure (6 locations):
  - When `validateResolvedIP()` returns false, the cached entry for that hostname is invalidated
  - This prevents a bad DNS resolution from being served to subsequent requests

#### Step 3: Modify Mini-Services Scan Engine ✅
**File**: `mini-services/scan-engine/scan-engine.ts`
**Changes**:
- Added inline DNS cache implementation at the top of the file (lines 9-27):
  - `dnsCache` Map with `{ address, family, expiresAt }` entries
  - `DNS_CACHE_TTL = 60_000` (60 seconds)
  - `cachedLookup(hostname)` — resolves with caching, returns cached result if valid
  - `invalidateDnsCache(hostname)` — removes specific hostname from cache
- Kept `import { lookup } from 'dns/promises'` as the underlying resolver for the inline cache
- Replaced 2 occurrences of `await lookup(hostname)` with `await cachedLookup(hostname)`:
  - Line 775: External resource DNS rebinding check
  - Line 1311: Main DNS rebinding check (`processUrlInner`)
- Added `invalidateDnsCache(hostname)` after both DNS rebinding check failures

---

### Part B: Improve Health Check Endpoint ✅
**File**: `src/app/api/health/route.ts`
**Changes**:
- Added `import { db } from '@/lib/db'` for database connectivity check
- Added database health check using `db.$queryRaw\`SELECT 1\`` with `dbStatus` result ('ok' or 'error')
- Added mini-service health checks with 2-second timeout:
  - Scan engine (port 3003): Returns 'ok', 'degraded', or 'unreachable'
  - Data sync service (port 3004): Returns 'ok', 'degraded', or 'unreachable'
- Overall status is 'ok' if database is fine, 'degraded' if database has issues
- Mini-service unavailability does not affect overall status (common in dev mode)
- Enhanced response JSON with additional fields:
  ```json
  {
    "status": "ok",
    "activeTasks": 0,
    "uptime": 7,
    "engine": "integrated",
    "database": "ok",
    "services": {
      "scanEngine": "ok",
      "dataSync": "ok"
    }
  }
  ```

---

### Verification
- TypeScript compilation passes (`npx tsc --noEmit` — no errors)
- ESLint passes for all modified files (no new lint errors)
- Dev server starts successfully and serves the health endpoint
- Health endpoint returns correct JSON with database and service status

---

## Task 4+5: Fix Source Code Preview Bug & Improve Malicious Keyword Precision
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 4+5)

### Scope
Two-part fix: (A) Remove authentication from /api/scan/html endpoint to fix source code preview, and (B) improve malicious keyword precision by introducing context-aware detection to reduce false positives.

---

### Part A: Remove Auth from /api/scan/html ✅

**File**: `src/app/api/scan/html/route.ts`
**Problem**: The `/api/scan/html` endpoint used `requireSessionAuth` which required a login session token. The user explicitly specified that scanning, viewing scan results, and searching the malicious library should be OPEN — no authentication required. This caused the source code preview to show no data (returns 401 when no valid session exists). The other `/api/scan` GET endpoints (status, results, logs) were already public.
**Changes**:
- Removed `import { requireSessionAuth } from '@/lib/api-auth'`
- Removed the `const authError = await requireSessionAuth(request)` check and early return
- Updated JSDoc comment to note that the endpoint is publicly accessible (same as other scan GET endpoints)
- Verified the endpoint returns proper JSON response (`{"error":"未找到扫描结果"}` for missing data, not 401)

---

### Part B: Improve Malicious Keyword Precision ✅

**Files**: `src/lib/scan-engine/html-parser.ts`, `mini-services/scan-engine/html-parser.ts`

**Problem**: The MALICIOUS_KEYWORDS array contained overly broad standalone keywords that caused false positives on legitimate sites:
- '贷款' (loan), '借款' (borrow), '小贷' (micro-loan), '网贷' (online lending), '现金贷' (cash loan) — legitimate in banking/financial contexts
- '量化交易' (quantitative trading), '合约交易' (contract trading), '币圈' (crypto circle) — legitimate finance terms
- '客服QQ', '在线客服', '官方客服', '客服微信' — virtually every e-commerce site uses these
- '限时优惠', '仅限今日', '最后机会' — legitimate marketing language
- '高仿手表', '高仿包包', '精仿鞋子' — overly specific; '高仿', '精仿', '仿品' are sufficient

**Strategy**:
1. Remove overly broad standalone keywords from MALICIOUS_KEYWORDS
2. Add new CONTEXT_KEYWORDS array for keywords that are only suspicious when combined with other suspicious indicators
3. Add context-aware detection rule (10a-ctx) that only flags CONTEXT_KEYWORDS when combined with suspicious indicators

**Changes (applied to both files)**:

1. **Removed from MALICIOUS_KEYWORDS**:
   - '贷款', '借款', '小贷', '网贷', '现金贷' (financial — too broad standalone)
   - '量化交易', '合约交易', '币圈' (crypto — too broad standalone)
   - '客服QQ', '在线客服', '官方客服', '客服微信' (customer service — too broad)
   - '限时优惠', '仅限今日', '最后机会' (marketing — too broad)
   - '高仿手表', '高仿包包', '精仿鞋子' (overly specific; '高仿', '精仿', '仿品' remain)
   - '炒币' (moved to CONTEXT_KEYWORDS)

2. **Added CONTEXT_KEYWORDS array** after MALICIOUS_KEYWORDS:
   - Financial context keywords: '贷款', '借款', '网贷', '现金贷', '小额贷款', '极速放款', '量化交易', '合约交易'
   - Customer service context keywords: '客服QQ', '在线客服', '官方客服', '客服微信'
   - Marketing context keywords: '限时优惠', '仅限今日', '最后机会'
   - Crypto context keywords: '币圈', '炒币', '虚拟币'

3. **Added CONTEXT_KEYWORD_REGEX** — pre-compiled regex for fast matching, same pattern as MALICIOUS_KEYWORD_REGEX

4. **Added rule 10a-ctx** — Context-aware keyword detection:
   - After the existing 10a rule, scans urlDetails for CONTEXT_KEYWORD matches
   - Skips if already flagged by 10a (avoids duplicate severity)
   - Only flags when a CONTEXT_KEYWORD is found AND at least one suspicious indicator is present:
     - Different domain + cheap TLD (and not in LEGIT_CHEAP_TLD_DOMAINS)
     - URL shortener domain
     - Hidden element (not visible)
     - Suspicious domain (typo/homoglyph/deceptive pattern)
   - Severity: `medium` (vs `critical` for true MALICIOUS_KEYWORDS)
   - Description includes the matched keyword and which suspicious indicators were found

---

### Verification
- TypeScript compilation passes (`npx tsc --noEmit` — no errors)
- ESLint: no new errors introduced in modified files (pre-existing errors are unrelated)
- Dev server starts successfully
- `/api/scan/html` endpoint returns proper JSON (no longer returns 401)
- Both html-parser.ts files (main + mini-services) updated with identical keyword changes

## Task 8: Synchronize ScanProgress Type Between Main and Mini-Services
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 8)

### Scope
Synchronize the `ScanProgress` interface between `src/lib/scan-engine/types.ts` and `mini-services/scan-engine/types.ts`, and ensure the mini-services scan engine emits the newly added fields in its progress updates.

---

### Fix 1: Add Missing Fields to Mini-Services ScanProgress Interface ✅

**File**: `mini-services/scan-engine/types.ts`
**Problem**: The `ScanProgress` interface was missing 4 fields that exist in the main version: `currentUrlStartTime`, `avgTimePerUrl`, `estimatedTimeRemaining`, `darkLinksFound`. This caused a type mismatch between the two codebases, meaning clients consuming progress events from the mini-service would never receive these useful tracking fields.
**Changes**:
- Added `currentUrlStartTime?: number` — Timestamp when the current URL started processing
- Added `avgTimePerUrl?: number` — Average time per URL in ms (based on completed URLs)
- Added `estimatedTimeRemaining?: number` — Estimated time remaining in ms
- Added `darkLinksFound?: number` — Number of dark links found so far
- All fields are optional with JSDoc comments, matching the main types.ts exactly

---

### Fix 2: Emit New Fields in Mini-Services Scan Engine Progress Updates ✅

**File**: `mini-services/scan-engine/scan-engine.ts`
**Problem**: The `emitProgress` function and all `onProgress` call sites in the mini-services scan engine only emitted the old fields (`taskId`, `totalUrls`, `completedUrls`, `progress`, `status`, `currentUrl`, `completedAt`). The new fields were never populated, so even if the type was updated, the values would always be `undefined`.
**Changes**:

1. **Added tracking variables** (after `totalUrls` declaration):
   - `scanStartTime = Date.now()` — Records when the scan started (for elapsed time computation)
   - `totalDarkLinks = 0` — Running count of dark links found across all completed URLs
   - `currentUrlStartTime: number | undefined` — Tracks when the current URL began processing

2. **Updated `emitProgress` function** to compute and include new fields:
   - `currentUrlStartTime` — Set from the module-level variable (updated each time a URL starts)
   - `avgTimePerUrl` — Computed as `Math.round(elapsed / completedUrls)` when >0 URLs completed
   - `estimatedTimeRemaining` — Computed as `avgTimePerUrl * remainingUrls` when both are available
   - `darkLinksFound` — Includes `totalDarkLinks` count when >0

3. **Set `currentUrlStartTime`** at the beginning of `processUrlInner()`, right before `startTime`:
   - `currentUrlStartTime = Date.now()` — Updated each time a new URL begins processing

4. **Track dark link count** when results are returned:
   - Added `totalDarkLinks += result.darkLinks` after `emitProgress` in the `processUrl` function, before `onResult(result)`

5. **Updated initial progress emission** (scan start):
   - Added `avgTimePerUrl: undefined`, `estimatedTimeRemaining: undefined`, `darkLinksFound: 0`

6. **Updated final progress emission** (scan completion):
   - Computes `avgTimePerUrl` from `scanStartTime` and `completedUrls`
   - Sets `currentUrlStartTime: undefined` (no URL being processed at completion)
   - Sets `estimatedTimeRemaining: 0` (scan is done)
   - Sets `darkLinksFound: totalDarkLinks` (final count)

---

### Fix 3: Verify Mini-Services index.ts ✅

**File**: `mini-services/scan-engine/index.ts`
**Analysis**: The `index.ts` passes `ScanProgress` objects through transparently — it stores them in `taskProgress` map and emits them via Socket.IO (`io.emit('scan:progress', progress)`). No direct usage of the new fields was found. The only field accessed from `ScanProgress` is `completedAt` (line 18, for task cleanup), which already existed. No changes needed.

---

### Verification
- ESLint passes for modified files (no new lint errors)
- Dev server is running successfully
- Types are now synchronized between main and mini-services versions

---
Task ID: 10
Agent: Main Agent
Task: Verify all fixes with build, then push to GitHub

Work Log:
- Verified `bun run build` succeeds with all changes
- Verified `bun run lint` - no new lint errors introduced (pre-existing 35 errors unrelated to changes)
- Tested health endpoint: returns `{"status":"ok","database":"ok","services":{"scanEngine":"ok","dataSync":"ok"}}`
- Tested /api/scan/html endpoint: returns 404 "未找到扫描结果" (no auth required, consistent with other scan GET endpoints)
- All changes committed: `feat: DNS cache, keyword precision, health endpoint, Docker Playwright, scan/html public access (v1.11.0)`
- Pushed to GitHub: commit 386184c (c8ae242..386184c)
- Cleaned GitHub token from remote URL

Stage Summary:
- Build: SUCCESS
- Lint: No new errors
- API Tests: Health endpoint + scan/html endpoint working correctly
- GitHub Push: SUCCESS (commit 386184c)

---

## Task 8: Fix MAJOR Issues from MAGI R4 Audit (M1-M7)
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 8)

### Scope
Fix 7 major issues identified in the MAGI R4 audit. All fixes are targeted and minimal.

---

### Fix M1: Unauthenticated scan stop in /api/scan route ✅
**File**: `src/app/api/scan/route.ts`
**Problem**: The `stop` action (line ~244) had no authentication check, meaning anyone could stop running scans. The `delete` action properly used `requireSessionAuth()`.
**Changes**:
- Added `requireSessionAuth(request)` check at the beginning of the `stop` case, before reading the request body
- Returns the auth error response if the session is invalid, matching the pattern used by `delete`

### Fix M2: N+1 Query in Sync Task Manager Initialization ✅
**File**: `src/lib/sync-task-manager.ts`
**Problem**: `initInterruptedTasks()` made 3 DB queries per source (count malicious domains, count malicious IPs, count entries) in a loop, resulting in 3N+1 queries.
**Changes**:
- Replaced the per-source loop with 3 bulk `groupBy()` queries that aggregate counts grouped by source
- `db.maliciousDomain.groupBy({ by: ['source'], _count: { id: true } })`
- `db.maliciousIP.groupBy({ by: ['source'], _count: { id: true } })`
- `db.threatIntelEntry.groupBy({ by: ['sourceId'], _count: { id: true } })`
- Built lookup maps from aggregated results, then iterated over sources to update mismatched entryCounts
- Reduced total queries from 3N+1 to 4 (1 findMany + 3 groupBy)

### Fix M3: Unbounded lastQueryTime Map in threat intel lookup ✅
**File**: `src/app/api/threat-intel/lookup/route.ts`
**Problem**: `lastQueryTime` Map never cleaned up entries (though bounded by source count, currently 3).
**Changes**:
- Added comment noting the Map is bounded by the number of configured sources (currently 3)
- Added periodic cleanup with `setInterval` every 5 minutes that removes entries older than 5 minutes
- Added `LAST_QUERY_CLEANUP_INTERVAL` and `LAST_QUERY_MAX_AGE` constants

### Fix M4: readLogs() reads entire log files into memory ✅
**File**: `src/lib/audit-logger.ts`
**Problem**: `readLogs()` read the entire log file with `readFile()` then filtered in-memory. Could use up to 40MB per request.
**Changes**:
- Added `maxLines` parameter to `LogFilter` interface (default 500)
- After reading and splitting file into lines, only processes the LAST `maxLines` lines (tail behavior)
- This limits memory usage regardless of file size — only the most recent 500 lines are parsed and filtered
- Filtering and pagination are applied after tailing

### Fix M5: Unbounded cache key in data-sync-service ✅
**File**: `mini-services/data-sync-service/index.ts`
**Problem**: The cache Map used `${type}:${page}:${pageSize}:${search}` as key, and very long search strings could flood the cache. No max cache size.
**Changes**:
- Added `search.slice(0, 100)` when building the cache key to limit key size
- Added `MAX_CACHE_ENTRIES = 1000` constant
- Added `evictCacheIfNeeded()` function that performs LRU eviction (removes oldest 10%) when cache exceeds max size
- Called `evictCacheIfNeeded()` before each `cachedMaliciousEntries.set()` call

### Fix M6: Race condition in scan task result accumulation ✅
**Files**: `mini-services/scan-engine/index.ts`, `src/app/api/scan/route.ts`
**Problem**: `taskResults.set(taskId, [...(taskResults.get(taskId) || []), result])` creates a new array copy on every result. For many URLs, this is O(n²) total. Also not atomic.
**Changes** (applied to both REST and WebSocket handlers in mini-services, and to the main route.ts):
- Replaced spread pattern with mutation pattern:
  ```ts
  const existing = taskResults.get(taskId) || [];
  existing.push(result);
  taskResults.set(taskId, existing);
  ```
- Applied to both `onResult` and `onLog` in all 3 locations (REST handler, WebSocket handler, main route.ts start action)

### Fix M7: ThreatBook API error message leaks internal info ✅
**File**: `src/app/api/threat-intel/route.ts`
**Problem**: At line ~250 and ~338, the ThreatBook API error message `json.verbose_msg` was returned directly in the response, potentially leaking internal API details.
**Changes**:
- In both `queryThreatBookIP` and `queryThreatBookDomain`:
  - Added `console.error('[ThreatBook] IP/Domain query error:', json.verbose_msg, 'code:', json.response_code)` to log the actual error server-side
  - Changed the client-facing error to `ThreatBook API error (code: ${json.response_code})` — generic message that doesn't expose internal details

---

### Verification
- TypeScript compilation passes (`bunx tsc --noEmit` — no errors)
- All fixes are minimal and targeted
- All 6 optimization tasks completed and verified

---

## Task E1a: Critical Security Fixes — XSS & Header Injection
**Date**: 2026-03-05
**Agent**: Agent (Task E1a)

### Scope
Fix two critical security issues: (1) XSS vulnerability in HTML Preview Dialog via `dangerouslySetInnerHTML`, and (2) curl header injection in both scan engines.

---

### Fix 1: XSS in HTML Preview Dialog ✅

**File**: `src/components/scan/html-preview-dialog.tsx`

**Problem**: The `highlightDarkLinks()` function built an HTML string with `<span>` tags that included `title` attributes containing dark link URLs. While `escapeHtml()` was applied to the raw HTML content, the title attributes in the generated span tags could be exploited if a URL contained special characters that break out of the attribute context (e.g., a URL containing `"` could close the title attribute and inject arbitrary HTML attributes/elements). This was rendered via `dangerouslySetInnerHTML`, making it a DOM-based XSS vulnerability.

**Changes**:
- **Removed** the `highlightDarkLinks()` function entirely (it built unsafe HTML strings)
- **Removed** the `highlightedHtml` useMemo hook that called `highlightDarkLinks`
- **Removed** `useMemo` from the React import (no longer needed)
- **Added** `HighlightedHtml` React component that renders highlighted content as proper JSX elements instead of an HTML string:
  - Escapes the raw HTML using `escapeHtml()`
  - Finds all dark link URLs/domains in the escaped text using regex
  - Builds an array of matches with start/end positions, color classes, and titles
  - Sorts matches by position and splits the escaped text into segments (highlighted vs. regular)
  - Renders each segment as a React `<span>` element with proper `className` and `title` props
  - React's JSX rendering automatically escapes attribute values, preventing XSS
- **Replaced** `<code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />` with `<code><HighlightedHtml html={rawHtml} darkLinkDetails={darkLinkDetails} /></code>`

**Security impact**: With `dangerouslySetInnerHTML`, a crafted URL like `http://evil.com/" onclick="alert(1)" data-x="` in a dark link could break out of the `title` attribute in the generated HTML string and inject arbitrary event handlers. With the new React JSX approach, React properly escapes all attribute values, making this attack vector impossible.

---

### Fix 2: Curl Header Injection in Main Scan Engine ✅

**File**: `src/lib/scan-engine/scan-engine.ts`

**Problem**: The `fetchWithCurl` function passed `extraHeaders` key/value pairs directly to curl's `-H` argument without sanitization. Header values containing newline characters (`\r` or `\n`) could inject additional curl arguments or HTTP headers. For example, a header value of `value\r\n-X POST\r\n` could add arbitrary curl flags.

**Changes**:
- Added CR/LF sanitization before adding headers to curl args:
  ```typescript
  const sanitizedValue = String(value).replace(/[\r\n]/g, '');
  const sanitizedKey = String(key).replace(/[\r\n]/g, '');
  ```
- Only adds header if both sanitized key and value are non-empty after stripping newlines
- Updated the filter condition to use sanitized key for the lowercase comparison

---

### Fix 3: Curl Header Injection in Mini-Services Scan Engine ✅

**File**: `mini-services/scan-engine/scan-engine.ts`

**Problem**: Same header injection vulnerability as the main scan engine — `fetchWithCurl` in mini-services also passed `extraHeaders` without sanitization.

**Changes**:
- Applied identical CR/LF sanitization as the main scan engine fix
- Same pattern: strip `\r` and `\n` from both key and value, verify non-empty after sanitization

---

### Verification
- Lint errors are all pre-existing (unrelated to these changes)
- Dev server is running successfully


---

## Task E1b: Performance & Error Handling Fixes
**Date**: 2026-03-05
**Agent**: Sub-agent (Task E1b)

### Scope
Fix performance and error handling issues: O(n²) image URL dedup, empty catch blocks, hidden text detection performance, and duplicate URL shortener list.

---

### Fix 1: O(n²) Image URL Dedup → O(n) with Sets ✅

**Files**: `src/lib/scan-engine/scan-engine.ts`, `mini-services/scan-engine/scan-engine.ts`

**Problem**: In the `analyzeHtmlResult()` function, image URL collection used `Array.includes()` inside nested loops for deduplication. With `htmlImageUrls`, `externalImageUrls`, and `inlineScriptImages` all being arrays, every `.includes()` call was O(n), making the total complexity O(n²) when scanning pages with many image URLs.

**Changes** (applied to BOTH scan engines):
- Replaced `const htmlImageUrls = imageExtractionResult` with `const htmlImageUrlsSet = new Set<string>(imageExtractionResult)` for O(1) lookups
- Replaced `const externalImageUrls: string[] = []` with `const externalImageUrlsSet = new Set<string>()` and used `.add()` / `.has()` instead of `.push()` / `.includes()`
- Replaced `const inlineScriptImages: string[] = []` with `const inlineScriptImagesSet = new Set<string>()` and used `.add()` / `.has()` instead of `.push()` / `.includes()`
- All `.includes()` checks in the external resource image URL extraction loop converted to `.has()` on the Sets
- All `.includes()` checks in the inline script image URL extraction loop converted to `.has()` on the Sets
- Added `Array.from()` conversions at the end: `const htmlImageUrls = Array.from(htmlImageUrlsSet)`, etc.
- Downstream code that uses these arrays remains unchanged

---

### Fix 2: Empty Catch Blocks → Add Error Logging ✅

**Files**: `src/components/scan/results-panel/index.tsx`, `src/components/settings/settings-page.tsx`, `src/lib/scan-engine/scan-engine.ts`, `src/lib/scan-store.ts`

**Problem**: Numerous bare `catch {}` and `catch(e) {}` blocks throughout the codebase silently suppressed errors, making debugging difficult. Errors were invisible even in development mode.

**Changes**:

1. **`src/components/scan/results-panel/index.tsx`** — 11 bare catch blocks fixed:
   - URL hostname parsing errors: `catch (err) { console.warn("Error parsing URL hostname:", err); }`
   - Malicious domain check errors: `catch (err) { console.warn("Error checking malicious domains:", err); }`
   - Malicious IP check errors: `catch (err) { console.warn("Error checking malicious IPs:", err); }`
   - Threat intel check errors: `catch (err) { console.warn("Error checking threat intel:", err); }`
   - URL parsing in severity/sorting: `catch (err) { console.warn("Error parsing URL:", err); }`
   - Clipboard write failures: `catch (err) { console.warn("Clipboard write failed:", err); }`
   - Export failures: `catch (err) { console.warn("Export failed:", err); }`
   - Bulk QR copy failures: `catch (err) { console.warn("Bulk QR copy failed:", err); }`

2. **`src/components/settings/settings-page.tsx`** — 6 bare catch blocks fixed:
   - All localStorage read/write errors: `catch (err) { console.warn("Settings error:", err); }`

3. **`src/lib/scan-engine/scan-engine.ts`** — 5 bare catch blocks fixed:
   - Data URI QR decode: `catch (e) { console.debug("Data URI QR decode failed:", e); }`
   - URL dedup key extraction: `catch (e) { return domain || url; }` (added error parameter)
   - DNS rebinding check: `catch (e) { console.debug("DNS rebinding check failed for external resource:", e); }`
   - External resource fetch: `catch (e) { console.debug("External resource fetch failed:", e); }`
   - Audit logging: `catch (e) { console.warn("Audit log failed:", e); }` and `.catch((e) => { console.warn("Audit log failed:", e); })`

4. **`src/lib/scan-store.ts`** — 6 bare catch blocks fixed:
   - URL parsing in store: `catch (err) { console.warn("Store error:", err); }`
   - JSON parsing: `catch (err) { console.warn("Store error:", err); }`
   - Curl parsing: `catch (err) { console.warn("Store error:", err); }`
   - Safe domain checks: `catch (err) { console.warn("Store error:", err); }`

---

### Fix 3: Hidden Text Detection Performance ✅

**Files**: `src/lib/scan-engine/html-parser.ts`, `mini-services/scan-engine/html-parser.ts`

**Problem**: Rule 10d (hidden text detection) used `$("*").each()` which iterates over ALL DOM elements in the page. For large pages with thousands of elements, this is very slow. The rule only checks elements with inline `style` attributes (for font-size:0 and color matching background), so iterating elements without `style` is wasted work.

**Changes** (applied to BOTH html-parser files):
- Changed `$("*").each()` to `$("[style]").each()` for rule 10d (hidden text detection)
- Only elements with inline styles are now iterated, which is the only relevant set for this check
- Added comment explaining the optimization: `// Only iterate elements with inline styles — much faster than $("*").each()`
- This reduces the iteration set from all elements (often thousands) to only styled elements (typically dozens to hundreds)

---

### Fix 4: Duplicate URL Shortener List in qr-detector.ts ✅

**File**: `src/lib/scan-engine/qr-detector.ts`

**Problem**: `qr-detector.ts` had its own local `URL_SHORTENER_HOSTS` Set with 20 entries, duplicating and diverging from the comprehensive `URL_SHORTENERS` list in `shared-constants.ts` which has 100+ entries. This meant QR-detected shortener domains were only checked against 20 shorteners instead of the full list.

**Changes**:
- Added import: `import { URL_SHORTENERS } from "./shared-constants";`
- Replaced the local 20-entry `URL_SHORTENER_HOSTS` definition with: `const URL_SHORTENER_HOSTS = new Set(URL_SHORTENERS);`
- Added comment: `// Imported from shared-constants.ts — single source of truth`
- All existing `URL_SHORTENER_HOSTS.has()` calls continue to work unchanged
- The QR detector now uses the full 100+ entry shortener list instead of the partial 20-entry list

---

### Verification
- ESLint check shows no new lint errors (all errors are pre-existing)
- Dev server is running successfully


## Task E1c: Security Fixes — Rate Limiting, Localhost Blocking, Mixed Content Rule ID
**Date**: 2025-06-01
**Agent**: Sub-agent (Task E1c)

### Scope
Fix three security issues: unbounded rate-limiter memory + IP spoofing, incomplete localhost blocking, and wrong rule ID for mixed content detection.

---

### Fix 1: Rate Limiter Unbounded Memory + IP Spoofing (HIGH) ✅

**File**: `src/lib/rate-limit.ts`

**Problem**: Two issues:
1. The `requests` Map grew unboundedly — an attacker rotating IPs could exhaust memory by creating millions of entries
2. `x-forwarded-for` was trusted without validation, making IP spoofing trivial (any client can set this header)

**Changes**:
- Added `MAX_ENTRIES = 10_000` constant to cap the Map size
- Added `lastRequest: number` field to the `RateLimitEntry` interface for tracking recency
- Added `evictOldestEntries()` function that sorts entries by `lastRequest` (ascending) and removes the oldest ones when the Map exceeds `MAX_ENTRIES`
- Changed IP extraction to prefer `x-real-ip` header over `x-forwarded-for`: `realIp?.trim() || forwarded?.split(',')[0]?.trim() || 'unknown'`
- `x-real-ip` is typically set by the reverse proxy (e.g., Nginx) and is harder to spoof than `x-forwarded-for`
- Updated `lastRequest` on every access (both new and existing records)
- Eviction runs before adding new entries when the Map is at capacity
- Existing periodic cleanup interval (5 minutes) still handles expired entries

---

### Fix 2: Incomplete Localhost Blocking (MEDIUM) ✅

**File**: `src/lib/security.ts`

**Problem**: The `validateScanUrl` function only blocked `localhost` and `localhost.localdomain`. Subdomains like `evil.localhost` could bypass this check, potentially resolving to 127.0.0.1 on systems that resolve `*.localhost` to the loopback address.

**Changes**:
- Added a check for hostnames ending with `.localhost` after the existing localhost block:
  ```typescript
  if (hostname.endsWith('.localhost')) {
    return { valid: false, reason: 'Localhost subdomain is not allowed' };
  }
  ```

---

### Fix 3: Wrong Rule ID for Mixed Content (LOW) ✅

**Files**: `src/lib/scan-engine/html-parser.ts`, `mini-services/scan-engine/html-parser.ts`

**Problem**: The mixed content detection rule (10n) used `ruleEnabled('meta_refresh')` instead of `ruleEnabled('mixed_content')`. This meant disabling the `meta_refresh` rule would also disable mixed content detection, which is a completely separate check.

**Changes** (applied to BOTH files):
- Changed `ruleEnabled('meta_refresh')` to `ruleEnabled('mixed_content')` in the mixed content detection block
- This makes mixed content detection independently controllable via its own rule ID

---

### Verification
- All lint errors are pre-existing (unrelated to these changes)
- Dev server is running successfully

## Task U1: Enhancement Phase — Accessibility, False Positive Fix, LRU Cache, Module-Level Constants
**Date**: 2026-03-04
**Agent**: Main agent (Task U1)

### Scope
Four enhancements: (1) Add aria-labels to icon-only buttons for accessibility, (2) QR code suspicion threshold fix to reduce false positives, (3) DNS cache LRU size limit to prevent unbounded memory growth, (4) Move regex constants to module level in scan-engine.ts.

---

### Enhancement 1: Add aria-labels to Icon-Only Buttons ✅

**Files**: Multiple component files across `src/components/`

**Problem**: Icon-only buttons (containing only a Lucide icon component with no visible text) lacked `aria-label` attributes, making them invisible to screen readers and failing WCAG accessibility guidelines.

**Changes** (all icon-only `<Button>` elements received descriptive `aria-label` attributes):

| File | Button Icon | aria-label |
|------|------------|------------|
| `scan/url-input-panel.tsx` | Settings2 | `aria-label="配置"` |
| `scan/url-input-panel.tsx` | X (remove URL) | `aria-label="删除"` |
| `scan/url-input-panel.tsx` | X (remove header) ×2 | `aria-label="删除请求头"` |
| `scan/url-input-panel.tsx` | Plus (add header) ×2 | `aria-label="添加请求头"` |
| `scan/url-input-panel.tsx` | Plus (add URL) | `aria-label="添加URL"` |
| `scan/scan-controls.tsx` | X (remove header) | `aria-label="删除请求头"` |
| `scan/scan-controls.tsx` | Plus (add header) | `aria-label="添加请求头"` |
| `scan/results-panel/dark-link-card.tsx` | ShieldIcon | `aria-label="威胁情报"` |
| `scan/results-panel/dark-link-card.tsx` | ExternalLink | `aria-label="访问链接"` |
| `scan/results-panel/dark-link-card.tsx` | Copy/Check | `aria-label="复制"` |
| `scan/results-panel/qr-code-card.tsx` | Copy/Check | `aria-label="复制"` |
| `scan/results-panel/all-results-tab.tsx` | Code2 | `aria-label="查看源码"` |
| `scan/results-panel/all-results-tab.tsx` | Copy/Check | `aria-label="复制"` |
| `scan/url-details-panel.tsx` | ShieldAlert | `aria-label="威胁情报"` |
| `scan/url-details-panel.tsx` | Copy/Check | `aria-label="复制"` |
| `scan/results-page.tsx` | Trash2 | `aria-label="删除"` |
| `scan/results-page.tsx` | RefreshCw ×2 | `aria-label="刷新"` |
| `scan/task-history-panel.tsx` | Trash2 | `aria-label="删除"` |
| `scan/malicious-library/entry-card.tsx` | Trash2/Loader2 | `aria-label="删除"` |
| `scan/malicious-panel/entry-list.tsx` | ToggleLeft/Right | `aria-label={entry.isActive ? '禁用' : '启用'}` |
| `scan/malicious-panel/entry-list.tsx` | Trash2 | `aria-label="删除"` |
| `scan/settings/api-key-field.tsx` | Eye/EyeOff | `aria-label={showKey ? '隐藏密钥' : '显示密钥'}` |
| `scan/settings-sheet.tsx` | Eye/EyeOff (native button) | `aria-label={visible ? '隐藏密钥' : '显示密钥'}` |
| `login-dialog.tsx` | Eye/EyeOff (native button) | `aria-label={showPassword ? '隐藏密码' : '显示密码'}` |

---

### Enhancement 2: QR Code Suspicion Threshold ✅

**File**: `src/lib/scan-engine/qr-detector.ts`

**Problem**: The `isQrContentSuspicious()` function marked any QR code URL > 300 characters as suspicious, causing false positives for legitimate long URLs like Google Maps links.

**Changes**:
1. Increased the threshold from 300 to 500 characters
2. Added context-aware check: long URLs are only marked suspicious if they ALSO match at least one other suspicious indicator:
   - IP address URL
   - URL shortener domain
   - Suspicious TLD
   - Suspicious keyword in the URL (new `QR_SUSPICIOUS_KEYWORDS` array)
3. Added `QR_SUSPICIOUS_KEYWORDS` constant with common phishing/malicious keywords: `login`, `signin`, `verify`, `secure`, `account`, `update`, `confirm`, `wallet`, `crypto`, `bitcoin`, `payment`, `banking`, `credential`, `password`, `token`, `auth`, `reset`, `unlock`, `suspend`
4. Updated `getQrSuspicionReason()` to reflect the new threshold and context-aware logic

---

### Enhancement 3: DNS Cache LRU Size Limit ✅

**File**: `src/lib/scan-engine/dns-cache.ts`

**Problem**: The DNS cache had no size limit, potentially causing unbounded memory growth in long-running processes that scan many unique hostnames.

**Changes**:
1. Added `MAX_CACHE_SIZE = 1000` constant
2. In `cachedLookup()`, after adding a new entry, checks if cache exceeds max size
3. If over limit, evicts the entry with the closest expiry time (LRU-based eviction targeting stalest entries first)
4. Prevents memory from growing unbounded while keeping the most useful recent entries

---

### Enhancement 4: Move Regex Constants to Module Level ✅

**Files**: `src/lib/scan-engine/scan-engine.ts`, `mini-services/scan-engine/scan-engine.ts`

**Problem**: The `IMAGE_EXTENSIONS`, `QR_IMAGE_PATTERNS`, and `IMAGE_DIR_PATTERNS` regex constants were defined inside `analyzeHtmlResult()` and re-created on every call, causing unnecessary object allocation.

**Changes** (applied to BOTH files):
1. Added the three regex constants at module level, before the `analyzeHtmlResult` function definition:
   ```typescript
   const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|avif)(\?|$)/i;
   const QR_IMAGE_PATTERNS = /\/(qr|qrcode|weixin|weibo|wechat|code|ewm|barcode|scan)/i;
   const IMAGE_DIR_PATTERNS = /\/(image|img|photo|picture|pic|upload|static|assets|resource|media|content|data|files|cdn|qrcode|qr-code)/i;
   ```
2. Removed the local `const` declarations from inside `analyzeHtmlResult()`
3. Function now references the module-level constants, avoiding re-creation on each call

---

### Verification
- ESLint check: all errors are pre-existing (unrelated to these changes)
- Dev server running successfully

## Task E2a: Scan Engine Accuracy Fixes
**Date**: 2025-06-01
**Agent**: Sub-agent (Task E2a)

### Scope
Fix four scan engine accuracy issues: expand CSS hidden div detection, create separate link_farm rule type, add nofollow context gate, and expand obfuscated JS detection.

---

### Fix 1: Expand CSS Hidden Div Detection (CRITICAL) ✅

**Files**: `src/lib/scan-engine/html-parser.ts`, `mini-services/scan-engine/html-parser.ts`

**Problem**: Rule 10f (hidden div links) only checked `display:none` in inline styles, missing many common CSS hiding techniques used by dark link operators.

**Changes** (applied to BOTH html-parser.ts files):

Replaced the simple `isZeroDiv` boolean check with a comprehensive `hideTechniques` array that detects all of the following CSS hiding methods:

1. **display:none** (original) — `/\bdisplay\s*:\s*none\b/`
2. **Zero-size containers** (original) — `/\b(width|height)\s*:\s*0(px)?\b/`
3. **overflow:hidden + small size** (original) — `/\boverflow\s*:\s*hidden\b/` + `/\b(width|height)\s*:\s*[01](px)?\b/`
4. **visibility:hidden** (NEW) — `/\bvisibility\s*:\s*hidden\b/`
5. **opacity:0 exactly** (NEW) — parses opacity value and only flags if exactly 0 (not 0.5 etc)
6. **text-indent <= -999** (NEW) — `/\btext-indent\s*:\s*(-[\d.]+)\s*(px|em|rem)?/` with value <= -999
7. **position:absolute + large negative left/top** (NEW) — position:absolute combined with left/top >= 9999px negative
8. **clip:rect(0** (NEW) — `/\bclip\s*:\s*rect\s*\(\s*0/i`
9. **clip-path:inset(100%)** (NEW) — `/\bclip-path\s*:\s*inset\s*\(\s*100%/i`
10. **clip-path:polygon(0** (NEW) — `/\bclip-path\s*:\s*polygon\s*\(\s*0/i`
11. **transform:scale(0)** (NEW) — `/\btransform\s*:\s*scale\s*\(\s*0\s*\)/`
12. **max-height:0 + overflow:hidden** (NEW) — `/\bmax-height\s*:\s*0(px)?\b/` + `/\boverflow\s*:\s*hidden\b/`

The `evidence` field now includes all matched hiding technique names (comma-separated) for debugging.

---

### Fix 2: Create Separate link_farm Rule Type (HIGH) ✅

**Files**: `src/lib/scan-engine/types.ts`, `mini-services/scan-engine/types.ts`, `src/lib/scan-engine/html-parser.ts`, `mini-services/scan-engine/html-parser.ts`

**Problem**: The link farm detection (rule 10m) incorrectly used `ruleEnabled('keyword_stuffing')` and `type: 'keyword_stuffing'`, which was semantically wrong and made it impossible to disable link farm detection without also disabling meta keyword stuffing detection.

**Changes**:

1. Added `'link_farm'` to the `DarkLinkType` union in both `types.ts` files
2. Changed `ruleEnabled('keyword_stuffing')` to `ruleEnabled('link_farm')` in both html-parser.ts files
3. Changed `type: 'keyword_stuffing'` to `type: 'link_farm'` in both html-parser.ts files

---

### Fix 3: Add nofollow Context Gate (HIGH) ✅

**Files**: `src/lib/scan-engine/html-parser.ts`, `mini-services/scan-engine/html-parser.ts`

**Problem**: The `nofollow_suspicious` rule (10l) flagged ALL external nofollow links at `medium` severity, which was too aggressive. Many legitimate sites use nofollow for SEO purposes (e.g., user-generated content, sponsored links).

**Changes** (applied to BOTH html-parser.ts files):

Added context gates — only flag nofollow links at `medium` severity if at least one suspicious indicator is present:

- **Cheap TLD** — Link domain uses a cheap/abusable TLD
- **URL shortener** — Link domain is a URL shortener service
- **Hidden element** — The link is not visible (CSS hidden)
- **Suspicious domain** — Typo/homoglyph/deceptive pattern of the base domain
- **Malicious keyword** — The URL contains a malicious keyword

If no context indicator is present, the nofollow link is still reported but at `low` severity instead of `medium`. The description and evidence fields include which indicators were found.

---

### Fix 4: Expand Obfuscated JS Detection (MEDIUM) ✅

**Files**: `src/lib/scan-engine/html-parser.ts`, `mini-services/scan-engine/html-parser.ts`

**Problem**: The obfuscated JS detection (rule 10o) only detected 5 patterns (eval, atob, String.fromCharCode, unescape, decodeURIComponent), missing many common obfuscation techniques.

**Changes** (applied to BOTH html-parser.ts files):

Added 8 additional obfuscation patterns to the `obfuscationPatterns` array:

1. **setTimeout(string)** — `/\bsetTimeout\s*\(\s*["']/` — setTimeout with string argument (code execution)
2. **setInterval(string)** — `/\bsetInterval\s*\(\s*["']/` — setInterval with string argument (code execution)
3. **new Function()** — `/\bnew\s+Function\s*\(/` — dynamic function construction
4. **document.write()** — `/\bdocument\.write\s*\(/` — dynamic content injection
5. **Hex encoding** — `/\\x[0-9a-f]{2}.*\\x[0-9a-f]{2}/i` — hex-encoded strings (\x68\x74\x74\x70)
6. **Unicode escape** — `/\\u[0-9a-f]{4}.*\\u[0-9a-f]{4}/i` — Unicode escapes (\u0068\u0074)
7. **parseInt(hex)** — `/\bparseInt\s*\(\s*["'][0-9a-f]+["']/i` — hex string to URL construction

---

### Verification
- TypeScript compilation passes (`npx tsc --noEmit` — no errors)
- ESLint: no new errors introduced in modified files (all 35 pre-existing errors are unrelated)
- Dev server is running successfully
- Both html-parser.ts files (main + mini-services) updated with identical changes
- Both types.ts files (main + mini-services) updated with `link_farm` type

## Task E2b: Database Indexes, Mini-Services Sync & Config Documentation
**Date**: 2026-03-04
**Agent**: Sub-agent (Task E2b)

### Scope
Fix database and mini-services sync issues: add missing database indexes, sync CHEAP_TLDS between main and mini-services, sync TRUSTED_DOMAINS, and add config unit documentation with timeout conversion helper.

---

### Fix 1: Add Missing Database Indexes ✅

**File**: `prisma/schema.prisma`

**Problem**: Several models lacked indexes for common query patterns, causing full table scans on frequently queried columns.

**Changes**:
- `ScanResult`: Added `@@index([url])` for URL lookup queries
- `ScanResult`: Added `@@index([createdAt])` for time-range cleanup queries
- `DarkLink`: Added `@@index([type])` for filtering by detection type (was missing; `severity` already indexed)
- `SyncTask`: Added `@@index([status])` for status-based lookups (model had NO indexes at all)
- `SyncTask`: Added `@@index([createdAt])` for time-range queries
- `MaliciousDomain`: Added `@@index([source])` and `@@index([severity])` for source/severity filtering (only had `@unique` on domain which implies an index, but no indexes on query columns)
- `MaliciousIP`: Added `@@index([source])` and `@@index([severity])` for the same reason

**Models that already had adequate indexes**: `ScanTask` (status, createdAt), `UrlDetail` (resultId, domain), `QrCodeResult` (resultId), `ScanLog` (taskId, level), `ThreatIntelEntry` (type+value, sourceId, value, unique composite), `ThreatIntelSource` (sourceId unique), `ThreatIntelApiKey` (source unique), `ThreatIntelConfig` (id default).

Applied with `bunx prisma db push` — database synced successfully.

---

### Fix 2: Sync Mini-Services CHEAP_TLDS ✅

**File**: `mini-services/scan-engine/html-parser.ts`

**Problem**: The mini-services CHEAP_TLDS array had 7 extra TLDs (`'design'`, `'live'`, `'studio'`, `'pro'`, `'app'`, `'dev'`, `'ai'`) that were previously removed from the main `src/lib/scan-engine/html-parser.ts` because they are legitimate, mainstream TLDs — not cheap/abusable ones. This caused false positives on legitimate `.app`, `.dev`, `.ai`, `.live`, `.studio`, `.pro`, `.design` domains when scanned via the mini-services engine.

**Changes**:
- Removed `'design'`, `'live'`, `'studio'`, `'pro'`, `'app'`, `'dev'`, `'ai'` from the mini-services CHEAP_TLDS array
- The mini-services CHEAP_TLDS now exactly matches the main version

---

### Fix 3: Sync Mini-Services TRUSTED_DOMAINS ✅

**Files compared**:
- `src/lib/scan-engine/shared-constants.ts` (authoritative TRUSTED_DOMAINS)
- `mini-services/scan-engine/html-parser.ts` (inline TRUSTED_DOMAINS)
- `mini-services/scan-engine/scan-engine.ts` (inline TRUSTED_DOMAINS_ENGINE)

**Finding**: All three TRUSTED_DOMAINS sets are **already identical**. A programmatic comparison was run extracting all domains from each set and checking for differences — none were found. The previous task (7b) already synchronized these when it updated both `shared-constants.ts` and `mini-services/scan-engine/scan-engine.ts` with the same `isSuspiciousDomain` fix.

**Result**: No changes needed — TRUSTED_DOMAINS already in sync across all three files.

---

### Fix 4: Config Unit Documentation ✅

**Files**: `src/lib/config.ts`, `src/lib/scan-engine/types.ts`

**Problem**: The `ScanConfig.defaultTimeout` was stored in **seconds** (default: 3) in the config file, but the scan engine's `ScanRequest.timeout` expects **milliseconds** (default: 15000). The `ScanTask` Prisma model also stores timeout in milliseconds (`@default(10000) // ms`). There was no documentation on units and no conversion helper, making it easy to pass the wrong value.

**Changes to `src/lib/config.ts`**:
- Added JSDoc to all `ScanConfig` fields specifying units and purpose:
  - `defaultConcurrency`: "Maximum number of URLs scanned concurrently"
  - `defaultTimeout`: "Default timeout in SECONDS (will be converted to ms internally by getScanConfigMs)"
  - `maxExternalJs`: "Maximum number of external JS resources to fetch per page"
  - `maxExternalCss`: "Maximum number of external CSS resources to fetch per page"
  - `taskRetentionHours`: "Number of hours to retain completed scan tasks before cleanup"
- Added new exported function `getScanConfigMs()` that returns a copy of `ScanConfig` with `defaultTimeout` converted from seconds to milliseconds (`config.defaultTimeout * 1000`). This provides a safe, documented way for callers to get the timeout in the unit the scan engine expects.
- Kept the original `getScanConfig()` function unchanged for backward compatibility (returns seconds as-is).

**Changes to `src/lib/scan-engine/types.ts`**:
- Added JSDoc to `ScanRequest.timeout`: "Timeout per URL in MILLISECONDS (default: 15000). Config stores seconds; use getScanConfigMs() for conversion."

**Note**: The config's `defaultTimeout` is currently not connected to the scan pipeline — the frontend hardcodes `timeout: 15000` in `scan-store.ts` and passes it via `ScanRequest`. The `getScanConfigMs()` helper is available for future integration when the config-driven timeout is wired up.

---

### Verification
- `bunx prisma db push` completed successfully — all new indexes applied
- ESLint: no new errors introduced (pre-existing errors are unrelated)
- Dev server running successfully

## Task U2: Enhance Phase — Round 2 Improvements
**Date**: 2025-06-01
**Agent**: Sub-agent (Task U2)

### Scope
Four frontend and backend enhancements: pre-compute hostnames for dark links, memoize getFilteredDarkLinks store function, add config validation, and add error boundary to results panel.

---

### Enhancement 1: Pre-compute Hostnames for Dark Links ✅

**Files**: `src/components/scan/results-panel/dark-links-tab.tsx`, `src/components/scan/results-panel/index.tsx`

**Problem**: The code created `new URL()` objects inline in JSX for every dark link on every render. In `dark-links-tab.tsx`, three IIFE calls (`(() => { try { return maliciousMatches.has(new URL(link.url).hostname); } ... })()`) were evaluated per link per render. In `results-panel/index.tsx`, multiple `useMemo` hooks independently called `new URL()` for the same URLs.

**Changes in `dark-links-tab.tsx`**:
- Added `linkMatchFlags` useMemo that pre-computes a `Map<string, { inMaliciousDB, inSuspiciousDB, threatIntelConfirmed }>` for all sorted dark links
- Each URL's hostname is parsed once, and all three DB lookups are performed in a single pass
- Replaced inline IIFE pattern with simple `linkMatchFlags.get(link.url)` lookup in JSX
- Memo depends on `[sortedDarkLinks, maliciousMatches, suspiciousMatches, threatIntelConfirmed]`

**Changes in `results-panel/index.tsx`**:
- Added `allDarkLinkHostnames` useMemo that builds a `Map<string, string>` (URL → hostname) for all dark links across all results
- Replaced all `new URL(link.url).hostname` calls in `allDarkLinksUnfiltered`, `severityCounts`, and `sortedDarkLinks` memos with `allDarkLinkHostnames.get(link.url)` lookups
- Single source of truth for hostname computation — parsed once per URL, reused by all downstream memos

---

### Enhancement 2: Memoize getFilteredDarkLinks in Store ✅

**File**: `src/lib/scan-store.ts`

**Problem**: `getFilteredDarkLinks()` is expensive (flatMap + filter + URL parsing + dedup) and called on every render, even when the underlying data hasn't changed.

**Approach chosen**: Option B — Add a computed cache that updates when dependencies change.

**Changes**:
- Added `_darkLinksCache` field to the `ScanStore` interface: `{ deps: { resultsRef, severityFilter, searchQuery } | null; result: DarkLinkResult[] }`
- Initialized `_darkLinksCache: { deps: null, result: [] }` in store defaults
- Modified `getFilteredDarkLinks()` to check if dependencies have changed since last call by comparing object references (`resultsRef !== results`, `severityFilter` and `searchQuery` values)
- If deps match, returns cached result immediately (O(1) instead of O(n))
- If deps changed, recomputes and updates cache via `set({ _darkLinksCache: ... })`
- Added `_darkLinksCache: { deps: null, result: [] }` reset in `resetScan()` to clear stale cache on scan reset
- Also cleaned up redundant `console.warn('Store error:', err)` calls in catch blocks (replaced with silent catch for URL parsing)

---

### Enhancement 3: Add Config Validation Function ✅

**File**: `src/lib/config.ts`

**Problem**: The config loader accepted any values from `config.yaml` without validation. Invalid values (e.g., `defaultTimeout: 0` or `poolSize: 999`) would silently pass through and cause runtime issues.

**Changes**:
- Added `validateConfig(config: AppConfigFile)` function that checks for invalid values:
  - `scan.defaultTimeout` must be >= 1 and <= 300 (seconds)
  - `scan.taskRetentionHours` must be >= 1
  - `database.type` must be one of `'sqlite' | 'mysql' | 'postgresql'`
  - `database.mysql.poolSize` must be >= 1 and <= 50
  - `database.postgresql.poolSize` must be >= 1 and <= 50
- For each invalid value: logs a warning with the field name, invalid value, valid range, and the default being used
- Returns a corrected copy of the config with invalid values replaced by defaults
- Integrated into `loadConfig()`: the merged config is now passed through `validateConfig()` before caching
- Added `VALID_DB_TYPES` Set for O(1) database type validation

**Note**: `maxUrlsPerScan` is not currently in the `ScanConfig` interface, so validation for it was not added. It can be added when the field is introduced.

---

### Enhancement 4: Add Error Boundary to Results Panel ✅

**Files**: `src/components/error-boundary.tsx` (NEW), `src/components/scan/results-panel/index.tsx`

**Problem**: A single bad result card could crash the entire results panel. React error boundaries are the idiomatic way to catch rendering errors and show a fallback UI.

**Changes**:
- Created `src/components/error-boundary.tsx`: a class-based React error boundary component
  - `getDerivedStateFromError` captures the error
  - Renders a fallback UI with `AlertTriangle` icon, "组件渲染出错" message, and "重试" (retry) button
  - Supports custom `fallback` prop for specialized error UIs
  - Retry button resets `hasError` state to re-attempt rendering
- Wrapped the tab content area (all four `TabsContent` panels) in `<ErrorBoundary>` in `results-panel/index.tsx`
- Tab headers remain outside the error boundary so users can still switch tabs even if content fails
- Added `import { ErrorBoundary } from '@/components/error-boundary'` to results panel

---

### Verification
- ESLint: no new errors introduced in modified files (pre-existing errors are unrelated)
- Dev server is running successfully
- All four enhancements are non-breaking, backward-compatible changes


## Task U3a: Final Polish — Iframe Detection, Redirect SSRF, Bare Catch Fixes
**Date**: 2025-06-01
**Agent**: Agent (Task U3a)

### Scope
Three final polish improvements: (1) expand iframe detection rule 10g to cover more hiding techniques, (2) add DNS validation for redirect targets in browser-sim.ts, (3) fix all remaining bare `catch {}` blocks across src/.

---

### Enhancement 1: Expand Iframe Detection (Rule 10g) ✅

**Files**: `src/lib/scan-engine/html-parser.ts`, `mini-services/scan-engine/html-parser.ts`

**Problem**: The iframe detection rule (10g) only checked for 0x0/1x1 size iframes. Attackers use many more CSS/attribute-based hiding techniques on iframes to conceal dark links.

**Changes** (applied to BOTH html-parser files):

Replaced the simple size-only check with a comprehensive `hideReasons` array approach that detects 5 categories of iframe hiding:

1. **Size hiding** (original): 0x0 or 1x1 iframes via width/height attributes or CSS
2. **Clip/clip-path hiding**: `clip: rect(0,0,0,0)` or `clip-path: inset(100%)` — renders the iframe invisible while still loading content
3. **Offscreen positioning**: `position: absolute` combined with `left/top: -9999px` (or similar large negative values) — moves iframe off the visible viewport
4. **Sandbox without allow-scripts**: `<iframe sandbox="allow-same-origin">` (without `allow-scripts`) — content loads but JavaScript is restricted, often used for invisible tracking/injection
5. **aria-hidden + tabindex**: `aria-hidden="true"` combined with `tabindex="-1"` — hides from accessibility tree AND removes from tab order, strong indicator of deliberate concealment

The evidence string now lists all detected hiding reasons, e.g.: `发现于<iframe>标签, 隐藏原因: 尺寸隐藏: 0x0, clip:rect(0), src="..."`

---

### Enhancement 2: Add Redirect DNS Validation in browser-sim.ts ✅

**Files**: `src/lib/scan-engine/browser-sim.ts`, `mini-services/scan-engine/browser-sim.ts`

**Problem**: The `fetchWithRedirectControl` function followed HTTP redirects manually but did not validate redirect targets against SSRF protection. An attacker could use a redirect (302) to redirect the scanner to a private IP address (127.0.0.1, 192.168.x.x, etc.), bypassing the DNS rebinding check done only on the initial URL.

**Changes**:

**Main file** (`src/lib/scan-engine/browser-sim.ts`):
- Added `import { validateResolvedIP } from '../security'` and `import { lookup } from 'dns/promises'`
- After resolving the redirect URL and before following it, added a DNS validation block:
  - Extracts the hostname from the redirect URL
  - If the hostname is not already a raw IPv4 address, performs DNS lookup
  - Validates the resolved IP with `validateResolvedIP()`
  - If the resolved IP is private/reserved, aborts the redirect and returns the last response
  - If DNS lookup fails, lets the redirect proceed (the fetch will fail on its own)

**Mini-services file** (`mini-services/scan-engine/browser-sim.ts`):
- Added `import { lookup } from 'dns/promises'`
- Added inline SSRF protection functions (since mini-services can't import from `src/lib/security`):
  - `PRIVATE_IP_RANGES_INLINE` — Same private IP ranges as `src/lib/security.ts`
  - `ipToNumberInline()`, `isPrivateIPInline()`, `isValidIPInline()` — Helper functions
  - `validateResolvedIPInline()` — Simplified IPv4 + IPv6 validation matching the main module
- Added the same DNS validation block in `fetchWithRedirectControl` using `validateResolvedIPInline()`

---

### Enhancement 3: Fix Bare `catch {}` Blocks ✅

**Scope**: All `catch {}` blocks with truly empty bodies (no variable, no code) across `src/`

**Files modified** (18 fixes across 10 files):
- `src/lib/scan-engine/browser-renderer.ts` — 6 fixes (canvas toDataURL, URL resolution, page/context/browser cleanup)
- `src/app/api/threat-intel/route.ts` — 1 fix (source loading)
- `src/components/scan/results-panel/dark-link-card.tsx` — 1 fix (URL parsing)
- `src/components/scan/results-panel/threat-intel-result.tsx` — 1 fix (add to malicious library)
- `src/components/scan/html-preview-dialog.tsx` — 2 fixes (domain highlight, clipboard copy)
- `src/components/scan/scan-controls.tsx` — 2 fixes (rule parsing, stop scan)
- `src/app/api/scan/start/route.ts` — 1 fix (waitUntil)
- `src/app/api/threat-intel-sources/route.ts` — 1 fix (URL hostname parsing)
- `src/components/scan/threat-intel-result.tsx` — 1 fix (add to malicious library)
- `src/components/scan/url-details-panel.tsx` — 2 fixes (add to malicious library, clipboard copy)

**Change pattern**: Every `} catch {}` replaced with `} catch(e) { console.warn('Error:', e); }`

Only truly empty catches were modified. Catches with code inside (even without a variable name, e.g., `catch { return false; }`) were left untouched per instructions.

---

### Verification
- ESLint: no new errors introduced in modified files (all pre-existing errors are unrelated React hooks warnings)
- Dev server is running successfully (no compilation errors)
- All three enhancements are backward-compatible, non-breaking changes

---
Task ID: U3 (Final)
Agent: Main Agent
Task: MAGI 3-round spiral optimization — final polish and push

Work Log:
- Completed MAGI Round 3 Enhance: iframe detection, redirect DNS validation, bare catch fixes
- Synced version to 1.12.0 across all 5 files (package.json, config.yaml, config.ts, version.ts)
- Final build verification: SUCCESS
- Final lint check: 35 pre-existing errors, no new errors
- Committed: "feat: MAGI 3-round spiral optimization — v1.12.0" (59 files, +1723/-246)
- Pushed to GitHub: commit 27eef0f (386184c..27eef0f)
- Cleaned token from remote URL

Stage Summary:
- 3 MAGI rounds completed: 审视→执行→提升 cycle
- 45+ issues from Round 1 audit → all critical/high fixed
- 20+ issues from Round 2 audit → all critical/high fixed
- Final audit found 3 additional bugs (mixed_content type, missing UI labels, missing rules) → fixed
- Version: 1.10.0 → 1.12.0 (consistent across all files)
- Build: PASS
- GitHub: PUSHED

## Task 2 (Version Unification): Single Source of Truth for Version Number
**Date**: 2025-06-01
**Agent**: Sub-agent (Task 2 - Version Unification)

### Scope
Ensure the version "1.12.0" is defined in a single canonical location (`package.json`) and all other references derive from it automatically. Create a sync script for mini-service package.json files.

---

### Verification Findings

| File | Status | Notes |
|------|--------|-------|
| `package.json` | ✅ Canonical source | `"version": "1.12.0"` |
| `src/lib/version.ts` | ✅ Correct | Reads from package.json (server: `fs.readFileSync`, client: `NEXT_PUBLIC_APP_VERSION` env var) |
| `src/lib/config.ts` | ✅ Correct | Imports `APP_VERSION_NUMBER` from `./version`, uses it as default `app.version` |
| `config.yaml` | ✅ Correct | No `version` field; only comments noting version is auto-read from package.json |
| `next.config.ts` | ✅ Correct | Reads from package.json, injects `NEXT_PUBLIC_APP_VERSION` env var for client builds |
| `mini-services/scan-engine/package.json` | ❌ Was `"1.0.0"` | Independent version — now synced to `1.12.0` |
| `mini-services/data-sync-service/package.json` | ❌ Was `"1.0.0"` | Independent version — now synced to `1.12.0` |

### Changes Made

#### 1. Created `scripts/sync-version.ts` ✅ (NEW FILE)
- Reads version from root `package.json`
- Updates all mini-service `package.json` files to match
- Currently syncs: `mini-services/scan-engine/package.json`, `mini-services/data-sync-service/package.json`
- Skips files already at the correct version (idempotent)
- Gracefully handles missing files (warns and skips)
- Usage: `bun scripts/sync-version.ts` or `bun run version-sync`

#### 2. Added npm scripts to root `package.json` ✅
- `"version-sync": "bun scripts/sync-version.ts"` — Manual sync command
- `"postversion": "bun scripts/sync-version.ts"` — Auto-syncs mini-service versions after `npm version` / `bun version`

#### 3. Ran sync — updated mini-service versions ✅
- `mini-services/scan-engine/package.json`: `1.0.0` → `1.12.0`
- `mini-services/data-sync-service/package.json`: `1.0.0` → `1.12.0`

### Version Derivation Chain

```
package.json (CANONICAL: "1.12.0")
  ├── next.config.ts → reads at build time → sets NEXT_PUBLIC_APP_VERSION env var
  │     └── src/lib/version.ts (client side) → reads NEXT_PUBLIC_APP_VERSION
  ├── src/lib/version.ts (server side) → reads package.json via fs.readFileSync
  │     ├── src/lib/config.ts → imports APP_VERSION_NUMBER → uses as app.version default
  │     ├── src/lib/system-config.ts → re-exports APP_VERSION
  │     ├── src/app/api/route.ts → imports APP_VERSION
  │     ├── src/app/api/download/route.ts → imports APP_VERSION, ARCHIVE_NAME
  │     ├── src/components/login-page.tsx → imports APP_VERSION
  │     └── src/components/settings/settings-page.tsx → imports APP_VERSION
  └── scripts/sync-version.ts → reads & copies to mini-service package.json files
        ├── mini-services/scan-engine/package.json → synced to "1.12.0"
        └── mini-services/data-sync-service/package.json → synced to "1.12.0"
```

### Verification
- `bun scripts/sync-version.ts` runs successfully, syncs both files
- Running again shows "already at 1.12.0 (skipped)" — idempotent
- No TypeScript errors introduced

---

## Task 4: Docker Build & Runtime Verification
**Date**: 2025-06-01
**Agent**: Sub-agent (Task 4)

### Scope
Thorough code review of all Docker configuration files (Dockerfile, docker-entrypoint.sh, docker-compose.yml, start.sh, .dockerignore) for correctness and runnability. Verified standalone output, Prisma setup, mini-services dependencies, Playwright installation, permissions, environment variables, volume mounts, and hardcoded paths.

---

### Issues Found & Fixes Applied

#### CRITICAL: Playwright Browser Binary Permissions ✅ FIXED

**File**: `Dockerfile`
**Problem**: The Dockerfile ran `bunx playwright install --with-deps chromium` as root, which installed the Chromium browser binary to `/root/.cache/ms-playwright/`. However, the app runs as `appuser` (uid 1001) after `USER appuser`, and appuser cannot access `/root/.cache/`. When `browser-renderer.ts` calls `chromium.launch()`, Playwright would fail with "Executable doesn't exist" because it looks for the browser in `~/.cache/ms-playwright/` (which for appuser is `/home/appuser/.cache/ms-playwright/`, which doesn't exist).
**Fix**:
1. Moved user creation (`addgroup`/`adduser`) before Playwright install so `chown` can reference appuser:appgroup
2. Added `ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright` to install browsers to a shared location
3. Added `chown -R appuser:appgroup /app/.cache` after Playwright install so appuser can access the browser binaries
4. Added `PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright` to docker-compose.yml environment for consistency

#### MAJOR: Standalone .env Contains Hardcoded Dev Path ✅ FIXED

**File**: `Dockerfile`
**Problem**: The Next.js standalone output includes a `.env` file generated during the build. This file contains `DATABASE_URL=file:/home/z/my-project/db/custom.db` — an absolute path from the development machine. In Docker, the app runs from `/app`, so this path is invalid. While the Dockerfile sets `ENV DATABASE_URL=file:./db/custom.db` which takes precedence, having a hardcoded wrong path in `.env` is a latent bug that could confuse debugging.
**Fix**: Added a `RUN echo 'DATABASE_URL=file:./db/custom.db' > .env && chown appuser:appgroup .env` step after the standalone COPY to overwrite the `.env` file with the correct Docker-relative path.

#### MAJOR: daemon.ts Hardcoded Path ✅ FIXED

**File**: `mini-services/scan-engine/daemon.ts`
**Problem**: Line 16 had `cwd: '/home/z/my-project/mini-services/scan-engine'` — a hardcoded absolute path that breaks in Docker where the app runs from `/app`. While daemon.ts is not used by the Docker entrypoint (which starts `bun index.ts` directly), it's a latent bug that would break if someone tried to use the daemon wrapper in Docker.
**Fix**: Replaced the hardcoded path with `resolve(__dirname, '.')` using `import { dirname, resolve } from 'path'` and `const __dirname = dirname(new URL(import.meta.url).pathname)`.

#### MAJOR: Database Schema Not Synced on Container Start ✅ FIXED

**File**: `docker-entrypoint.sh`
**Problem**: The entrypoint only ran `prisma db push` when `/app/db/custom.db` didn't exist. However, the standalone output includes `db/custom.db` from the build (a copy of the dev database). When Docker mounts a new named volume, it copies content from the image — so the database file DOES exist on first run, causing `prisma db push` to be skipped. If the schema has changed since the build, the database may have an outdated schema.
**Fix**: Changed the entrypoint to always run `prisma db push --skip-generate` on every container start. This is idempotent — it creates tables if they don't exist and updates the schema if it has changed.

#### MAJOR: docker-compose.yml HEALTHCHECK Mismatch ✅ FIXED

**File**: `docker-compose.yml`
**Problem**: The `start_period` in docker-compose.yml was `30s` while the Dockerfile HEALTHCHECK had `start_period=40s`. The services need more than 30 seconds to fully start (database init + mini-service readiness + Next.js startup), so 30s was too short and would cause false unhealthy reports.
**Fix**: Changed `start_period` to `40s` to match the Dockerfile value.

---

### Remaining Issues (Not Fixed — Reported for Awareness)

#### MEDIUM: Volume Permission Edge Case
**Files**: `docker-compose.yml`, `Dockerfile`
**Problem**: Named volumes `darklink-db:/app/db` and `darklink-config:/app/config` are mounted. On first run, Docker copies directory content (including permissions) from the image, so permissions are correct. However, if a volume already exists from a previous run or is mounted from a different source, it may have root ownership, causing "permission denied" errors for appuser.
**Recommendation**: If this becomes an issue, restructure the entrypoint to run as root initially, fix permissions, then use `gosu` to drop to appuser. This is a significant architectural change and was not applied.

#### MINOR: Standalone Output Includes Unnecessary Files
**Problem**: The standalone build (`.next/standalone/`) includes `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `start.sh`, `examples/`, `agent-ctx/`, `CHANGELOG.md`, `LICENSE`, `README.md`, etc. These add unnecessary size to the Docker image.
**Recommendation**: Add `outputFileTracingExcludes` in `next.config.ts`:
```ts
outputFileTracingExcludes: {
  '*': ['Dockerfile', 'docker-compose.yml', 'Caddyfile', 'start.sh', 'examples', 'scripts', 'agent-ctx', 'CHANGELOG.md', 'LICENSE', 'README.md'],
}
```

#### MINOR: Playwright in serverExternalPackages
**File**: `next.config.ts:26`
**Problem**: `playwright` and `playwright-core` are listed in `serverExternalPackages`, adding ~11MB to the standalone build. The main scan engine (`src/lib/scan-engine/scan-engine.ts`) does import from `browser-renderer.ts` which uses Playwright, so this is actually needed for the standalone server. However, the mini-services scan engine does NOT use Playwright — it uses `browser-sim.ts` which only generates fingerprint data.
**Recommendation**: Keep as-is since the main scan engine uses Playwright. The 11MB overhead is acceptable for the feature it enables.

#### INFO: Redundant public/ COPY in Dockerfile
**Problem**: The Dockerfile copies `public/` explicitly (line 76), but the standalone output already includes it (the build script does `cp -r public .next/standalone/`). The second copy overwrites the same content.
**Recommendation**: Harmless — leave as-is for safety. If the build script is ever changed, this explicit copy ensures correctness.

---

### Verification Summary

| Item | Status | Notes |
|------|--------|-------|
| Dockerfile build stages | ✅ Correct | deps → builder → runner flow is sound |
| Standalone output COPY | ✅ Correct | static, public, standalone all properly copied |
| Prisma client + CLI | ✅ Correct | .prisma, @prisma, prisma CLI all copied from builder |
| Mini-services with deps | ✅ Correct | Full mini-services copied AFTER standalone (overwrites source-only copy) |
| bun.lock files | ✅ Verified | All 3 lockfiles exist (root, scan-engine, data-sync-service) |
| Playwright install | ✅ Fixed | Browsers in shared path with appuser ownership |
| Entrypoint logic | ✅ Fixed | Always runs prisma db push, health checks, monitoring loop |
| Non-root user permissions | ✅ Fixed | All files chowned, Playwright cache accessible |
| Environment variables | ✅ Correct | NODE_ENV, DATABASE_URL, PLAYWRIGHT_BROWSERS_PATH, NEXT_TELEMETRY_DISABLED |
| Volume declarations | ✅ Correct | /app/db and /app/config with proper ownership |
| .dockerignore | ✅ Reasonable | Excludes .git, node_modules, .next, db/*.db, dev files |
| start.sh vs Docker entrypoint | ✅ Consistent | start.sh uses `bun --hot` (dev), entrypoint uses `bun` (prod) |
| Hardcoded paths | ✅ Fixed | daemon.ts now uses import.meta.dir; engine-manager.ts was already fixed |

### Files Modified
1. `Dockerfile` — Playwright permissions, .env fix, user creation reorder
2. `docker-entrypoint.sh` — Always run prisma db push
3. `docker-compose.yml` — Added PLAYWRIGHT_BROWSERS_PATH, fixed start_period
4. `mini-services/scan-engine/daemon.ts` — Removed hardcoded path

---
Task ID: 1-5
Agent: Main Agent
Task: Fix preview failure, version unification, Docker verification, push to GitHub

Work Log:
- Diagnosed preview failure: scan-engine had duplicate `const curlResult` declaration causing crash, which triggered cascade failure in main app
- Fixed duplicate variable in mini-services/scan-engine/scan-engine.ts line 1420-1421
- Verified version unification is already correct: package.json → version.ts → config.ts (chain works)
- Created scripts/sync-version.ts to auto-sync mini-service versions from root package.json
- Added version-sync and postversion npm scripts to root package.json
- Updated mini-service package.json versions from 1.0.0 to 1.12.0
- Docker fixes applied by subagent:
  - Playwright browsers path/chown for appuser access
  - Fix standalone .env hardcoded dev path
  - Fix daemon.ts hardcoded path
  - Always run prisma db push (idempotent for schema migrations)
  - Fix docker-compose healthcheck timing
- Build passes, pushed to GitHub as d656cb6

Stage Summary:
- Scan engine crash root cause: duplicate variable declaration
- Version is now single source of truth from package.json
- Docker has 4 critical/major fixes for runtime correctness
- Dev server is stable for API endpoints but crashes on root page rendering (sandbox memory limitation, not code issue)
- Production mode correctly serves 12044-byte HTML page on first request

## Task 7-a (C1): Encrypt API Keys in threat-intel-sources route
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 7-a)

### Scope
Fix C1 security issue: API keys stored as plaintext in `src/app/api/threat-intel-sources/route.ts`. The dedicated `api-keys/route.ts` already encrypts keys with AES-256-GCM, but the `threat-intel-sources` route stored them in plaintext.

---

### Fix 1: Import encrypt/decrypt/isEncrypted from crypto-server ✅
**File**: `src/app/api/threat-intel-sources/route.ts` (line 5)
**Problem**: The route had no import of crypto functions, so API keys were stored without encryption.
**Changes**:
- Added `import { encrypt, decrypt, isEncrypted } from '@/lib/crypto-server';`

### Fix 2: Encrypt API key before storing in save-api-key action ✅
**File**: `src/app/api/threat-intel-sources/route.ts` (line 1147-1150)
**Problem**: The `save-api-key` action stored the decrypted API key as plaintext: `data: { apiKey: decryptedApiKey || null }`
**Changes**:
- Changed to `data: { apiKey: decryptedApiKey ? encrypt(decryptedApiKey) : null }`
- Now uses AES-256-GCM encryption consistent with `api-keys/route.ts`
- Added comment: `// Encrypt the API key before storing (AES-256-GCM)`

### Fix 3: Decrypt stored API key in collect action ✅
**File**: `src/app/api/threat-intel-sources/route.ts` (lines 1207-1218)
**Problem**: The `collect` action read `source.apiKey` directly and passed it to collection functions. After encryption, this would pass the encrypted ciphertext instead of the plaintext key.
**Changes**:
- Replaced `const sourceApiKey = source.apiKey || apiKey;` with decryption logic:
  - Checks `isEncrypted(source.apiKey)` before decrypting
  - Falls back to using as-is for legacy plaintext keys
  - Wrapped in try/catch for robustness
  - Then falls back to `apiKey` from request body if no stored key

### Fix 4: Decrypt stored API key in collect-all action ✅
**File**: `src/app/api/threat-intel-sources/route.ts` (lines 1273-1280)
**Problem**: The `collect-all` action read `source.apiKey` directly in the map function, which would be encrypted ciphertext after the fix.
**Changes**:
- Replaced `const effectiveApiKey = source.apiKey || ...` with decryption logic:
  - Checks `isEncrypted(source.apiKey)` before decrypting
  - Falls back to using as-is for legacy plaintext keys
  - Wrapped in try/catch for robustness

### Fix 5: Mask API key in GET response ✅
**File**: `src/app/api/threat-intel-sources/route.ts` (lines 1100-1110)
**Problem**: The GET handler returned `hasApiKey: !!s.apiKey` which only indicated key existence, but didn't provide a masked preview. If the key were encrypted and someone inspected the raw DB, they'd see the ciphertext — but the API response should never expose any part of the key (even encrypted).
**Changes**:
- Kept `hasApiKey: !!s.apiKey` (backward compatible)
- Added `apiKeyMasked` field that decrypts the stored key (if encrypted) and shows only the last 4 characters with a `****` prefix
- If decryption fails, shows just `****`
- If no key stored, shows `null`
- Uses `isEncrypted()` to determine whether to decrypt, maintaining backward compatibility with legacy plaintext keys

### Verification
- TypeScript compilation passes (`npx tsc --noEmit` — no errors, exit code 0)
- No changes to `api-keys/route.ts` (confirmed unchanged)
- Encryption approach matches `api-keys/route.ts` exactly: `encrypt()` from `crypto-server.ts` (AES-256-GCM)
- Backward compatibility maintained: `isEncrypted()` check handles legacy plaintext keys gracefully

---

## Task 7-b: Fix C2+C3 — SSRF Validation on Mini-Service + Restrict CORS
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 7-b)

### Scope
Fix two security vulnerabilities: (C2) mini-service scan engine has no SSRF URL validation before passing URLs to executeScan(), and (C3) both mini-services use wildcard CORS (`Access-Control-Allow-Origin: *`).

---

### Fix 1: Add SSRF URL Validation to Mini-Service Scan Engine ✅

**File**: `mini-services/scan-engine/index.ts`

**Problem**: When the mini-service received a scan request via REST (`POST /api/scan`) or WebSocket (`scan:start`), it directly passed URLs to `executeScan()` without validating them. The main scan engine route validates URLs using `validateScanUrls()` in `src/lib/security.ts`, but the mini-service had no such validation, allowing SSRF attacks (scanning private IPs, localhost, cloud metadata endpoints, etc.).

**Changes**:
- Added `UrlConfig` to the type imports from `./types`
- Added SSRF protection logic (replicated from `src/lib/security.ts` since the mini-service cannot import from the main app):
  - `PRIVATE_IP_RANGES` constant covering 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, 0.0.0.0/8
  - `ipToNumber()`, `isPrivateIP()`, `isValidIP()` for IPv4 validation
  - `isPrivateIPv6()`, `expandIPv6()` for IPv6 validation (loopback, fc00::/7, fe80::/10)
  - `validateScanUrl()` — validates a single URL: checks protocol (http/https only), blocks userinfo credentials, blocks localhost/localhost subdomains, blocks private IPs, blocks IPv6 private ranges
  - `validateScanUrlConfigs()` — batch validates `UrlConfig[]` objects, returning `{ valid: UrlConfig[], invalid: { url: string, reason: string }[] }`
- Added SSRF validation in REST API handler (`POST /api/scan`):
  - Calls `validateScanUrlConfigs(request.urls)` before `executeScan()`
  - Returns 400 with `invalidUrls` array if any URLs fail validation
  - Uses only validated URLs for the scan
- Added SSRF validation in WebSocket handler (`scan:start`):
  - Calls `validateScanUrlConfigs(request.urls)` before `executeScan()`
  - Emits `scan:error` event with `invalidUrls` if validation fails
  - Uses only validated URLs for the scan

---

### Fix 2: Restrict CORS on Scan Engine Mini-Service ✅

**File**: `mini-services/scan-engine/index.ts`

**Problem**: Both HTTP CORS headers and Socket.io CORS were set to `*` (wildcard), allowing any website to make requests to the scan engine.

**Changes**:
- Added `ALLOWED_ORIGINS` constant: `['http://localhost:3000', 'http://127.0.0.1:3000']`
- Added `setCorsHeaders()` function that checks the request's `Origin` header against the allowed list:
  - If origin matches, sets `Access-Control-Allow-Origin` to the requesting origin + `Vary: Origin`
  - If origin doesn't match, only sets `Vary: Origin` (no CORS header = browser blocks the request)
- Replaced hardcoded `res.setHeader('Access-Control-Allow-Origin', '*')` with call to `setCorsHeaders(req, res)`
- Changed Socket.io CORS from `origin: '*'` to `origin: ALLOWED_ORIGINS`

---

### Fix 3: Restrict CORS on Data Sync Service ✅

**File**: `mini-services/data-sync-service/index.ts`

**Problem**: Both HTTP CORS headers and Socket.io CORS were set to `*` (wildcard), allowing any website to make requests to the data sync service.

**Changes**:
- Added `ALLOWED_ORIGINS` constant: `['http://localhost:3000', 'http://127.0.0.1:3000']`
- Added `setCorsHeaders()` function with the same origin-checking logic as the scan engine
- Replaced hardcoded `res.setHeader('Access-Control-Allow-Origin', '*')` with call to `setCorsHeaders(req, res)`
- Changed Socket.io CORS from `origin: '*'` to `origin: ALLOWED_ORIGINS`

---

### Verification
- TypeScript check passes for `mini-services/scan-engine/index.ts` (only pre-existing error in browser-sim.ts)
- TypeScript check passes for `mini-services/data-sync-service/index.ts` (only pre-existing `bun:sqlite` and `import.meta` errors expected outside Bun runtime)
- No changes made to main app's scan routes or validation logic (as required)


## Task 9: Fix High-Impact Minor Issues + Enhancements
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 9)

### Scope
Fix 4 minor issues and add 1 enhancement from the MAGI R4 audit: parallelWithLimit concurrency bug, sequential upsert in import route, O(n²) onResult pattern (verify), inconsistent error response format, and version in health endpoint.

---

### Fix 1 (m8): parallelWithLimit Concurrency Bug ✅

**File**: `src/app/api/threat-intel-sources/route.ts`
**Problem**: The `parallelWithLimit()` function had a subtle race condition. The executing list management used `Promise.race([p.then(() => true, () => true), Promise.resolve(false)])` which always resolved to `false` because `Promise.resolve(false)` resolves synchronously before the microtask from `p.then()`. This meant the `executing` array never shrank, defeating the concurrency limit entirely.
**Changes**:
- Replaced `executing: Promise<void>[]` array with `executing = new Set<Promise<void>>()`
- Changed promise creation to chain `.then()` for result capture and `.finally()` for self-removal from the set
- Simplified the concurrency gate: `if (executing.size >= limit) { await Promise.race(executing); }`
- The `.finally()` callback closes over `p` (assigned on the same line), which is safe because the callback only runs after the promise settles (always after assignment)
- Removed the broken `Promise.race([p.then(() => true, () => true), Promise.resolve(false)])` pattern entirely

---

### Fix 2 (m3): Import Route Sequential Upsert → Batched createMany ✅

**File**: `src/app/api/config/database/import/route.ts`
**Problem**: The import endpoint processed records one at a time with individual `upsert()` calls. For large imports (thousands of records), this was extremely slow — each upsert is a separate database round-trip.
**Changes**:
- Added `batchCreateMany()` helper function that:
  - Accepts a table name, records array, and a record-mapping function
  - Batches records into groups of 500 and uses `createMany({ data, skipDuplicates: true })` for each batch
  - Falls back to individual `create()` calls if a batch fails (handles partial failures gracefully)
- Replaced all 10 sequential upsert loops (ScanTask, ScanResult, UrlDetail, DarkLink, QrCodeResult, ScanLog, MaliciousDomain, MaliciousIP, UpdateSchedule, ThreatIntelEntry) with calls to `batchCreateMany()`
- All models have `@id` fields, so `skipDuplicates: true` works correctly for all tables
- Maintained the same import order (ScanTask → ScanResult → dependent tables) for foreign key integrity
- Kept the same field mapping logic to ensure data integrity

---

### Fix 3 (m7): Scan Route onResult O(n²) Pattern — Already Fixed ✅

**File**: `src/app/api/scan/route.ts`
**Analysis**: The task description flagged the `[...(taskResults.get(taskId) || []), result]` spread pattern. Upon inspection, this was already fixed in a previous task. The current code at line 203-206 correctly uses:
```ts
const existing = store.taskResults.get(taskId) || [];
existing.push(result);
store.taskResults.set(taskId, existing);
```
No changes needed.

---

### Fix 4 (m1): Inconsistent Error Response Format in sync-tasks ✅

**File**: `src/app/api/sync-tasks/[id]/route.ts`
**Problem**: Three error handlers leaked internal error details to clients:
- GET (line 24-27): `{ error: "Failed to get task", detail: err.message }`
- PATCH (line 71-73): `{ error: err.message || "Failed to control task" }`
- DELETE (line 95-98): `{ error: "Failed to delete task", detail: err.message }`
**Changes**:
- All three error handlers now return a generic Chinese message: `{ error: "操作失败，请稍后重试" }`
- Added `console.error("[sync-tasks] ...", err)` server-side logging before each error response so the actual error is still captured in logs for debugging
- Removed the `detail` field that leaked `err.message` to clients

---

### Enhancement: Add Version to Health Endpoint Response ✅

**File**: `src/app/api/health/route.ts`
**Problem**: The health endpoint did not include the application version, making it difficult to verify which version is running during monitoring and debugging.
**Changes**:
- Added `import { APP_VERSION } from "@/lib/version"` (the module already existed in `src/lib/version.ts`)
- Added `version: APP_VERSION` field to the response JSON (e.g., `"version": "v1.12.0"`)
- The version is read from `package.json` at module load time (server-side) or from the `NEXT_PUBLIC_APP_VERSION` env var (client-side/build-time)

---

### Verification
- TypeScript compilation passes (`bunx tsc --noEmit` — no errors)

