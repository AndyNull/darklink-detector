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
