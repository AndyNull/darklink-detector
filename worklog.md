# Worklog

<!-- Older entries have been trimmed. See git history for full worklog. -->

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

---

## Task 11: Fix HIGH Priority Issues from MAGI R5 Audit
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 11)

### Scope
Fix 6 HIGH severity issues from the MAGI R5 audit: S1 (redirect SSRF bypass), D2 (SQLite busy_timeout), C1 (raw error messages in production), A1 (race condition on scan starts), F1 (ErrorBoundary missing componentDidCatch), and S2 (no HTML size limit).

---

### Fix 1: S1 — HTTP redirect to private IP bypasses DNS rebinding check ✅

**Files**: `src/lib/scan-engine/browser-sim.ts`, `mini-services/scan-engine/browser-sim.ts`

**Problem**: In `fetchWithRedirectControl`, the SSRF protection for HTTP redirects only validated DNS-resolved hostnames. When the redirect target hostname was already a literal IP address (e.g., `http://192.168.1.1/admin`), the check was skipped entirely because of the condition `if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(redirectHost))`. This allowed redirects to private IPs to bypass SSRF protection.

**Changes** (applied to BOTH browser-sim.ts files):
- Replaced the single-branch DNS check with a two-branch approach:
  1. If redirect hostname is a literal IP → validate it directly against `validateResolvedIP()` / `validateResolvedIPInline()`
  2. If redirect hostname is a domain → resolve via DNS and validate the resolved IP
- This closes the SSRF bypass where `http://192.168.1.1/admin` redirects were not blocked

---

### Fix 2: D2 — SQLite write locking, no busy_timeout configured ✅

**Files**: `src/lib/config.ts`, `src/lib/db.ts`

**Problem**: Prisma with SQLite didn't have a `busy_timeout` configured, so concurrent writes would fail with SQLITE_BUSY. No WAL mode was set for concurrent read/write performance.

**Changes**:

`src/lib/config.ts` — `buildDatabaseUrl()`:
- Changed SQLite URL from `file:${path}` to `file:${path}?busy_timeout=5000&connection_limit=1`
- `busy_timeout=5000` makes SQLite wait up to 5 seconds when the database is locked
- `connection_limit=1` ensures serialized writes to avoid concurrent write contention

`src/lib/db.ts`:
- Added `import { getEffectiveProvider } from './config'`
- Added WAL mode initialization: `db.$executeRawUnsafe('PRAGMA journal_mode=WAL')` when using SQLite
- WAL mode allows concurrent readers and writers, dramatically improving performance under load

---

### Fix 3: C1 — /api/scan/route.ts exposes raw error messages in production ✅

**File**: `src/app/api/scan/route.ts`

**Problem**: Error responses returned `(err as Error).message` directly, bypassing `safeErrorResponse()`. This leaked internal error details in production.

**Changes**:
- Added `import { safeErrorResponse } from '@/lib/api-error'`
- Replaced 3 instances of `(err as Error).message` with `safeErrorResponse()`:
  - `action=start` catch: `safeErrorResponse(err, '扫描启动失败')`
  - `action=stop` catch: `safeErrorResponse(err, '停止扫描失败')`
  - `action=delete` catch: `safeErrorResponse(err, '删除任务失败')`
- `safeErrorResponse` hides error details in production, shows them in development

---

### Fix 4: A1 — Race condition, no guard against concurrent scan starts ✅

**Files**: `src/app/api/scan/route.ts`, `src/app/api/scan/start/route.ts`, `src/lib/scan-engine/task-store.ts`

**Problem**: No check whether a user already has a running scan. Double-clicking "Start Scan" would start multiple concurrent scans.

**Changes**:

`src/lib/scan-engine/task-store.ts`:
- Added `isAnyTaskRunning(): boolean` — checks if `activeScanPromises.size > 0`
- Added `getActiveTaskCount(): number` — returns count of active scan promises

`src/app/api/scan/start/route.ts`:
- Imported `isAnyTaskRunning` from task-store
- Added guard after URL validation: if `isAnyTaskRunning()` returns true, return 409 Conflict with message "已有扫描任务正在运行"

`src/app/api/scan/route.ts`:
- Added equivalent guard in the inline `action=start` handler using `store.activeScanPromises.size > 0`
- Returns 409 Conflict with message "已有扫描任务正在运行"

---

### Fix 5: F1 — ErrorBoundary missing componentDidCatch ✅

**File**: `src/components/error-boundary.tsx`

**Problem**: No `componentDidCatch` — errors were silently swallowed with no logging. The retry button just reset `hasError` without remounting children, so stale state could persist.

**Changes**:
- Added `componentDidCatch(error: Error, info: React.ErrorInfo)` that logs the error and component stack to `console.error()`
- Added `resetKey` state (starts at 0, incremented on retry)
- Changed retry handler to increment `resetKey` in addition to clearing the error state
- Wrapped children with `<React.Fragment key={this.state.resetKey}>` to force remount on retry
- This ensures children get a fresh lifecycle when the user clicks "重试"

---

### Fix 6: S2 — No HTML size limit, 10MB+ pages can exhaust memory ✅

**Files**: `src/lib/scan-engine/scan-engine.ts`, `mini-services/scan-engine/scan-engine.ts`

**Problem**: No limit on HTML response size before parsing with cheerio. A 10MB+ page could exhaust memory.

**Changes** (applied to BOTH scan-engine files):

1. Added constant `MAX_HTML_SIZE = 2 * 1024 * 1024` (2MB)

2. In `analyzeHtmlResult()`:
   - Added size check at the top: if `html.length > MAX_HTML_SIZE`, truncate to MAX_HTML_SIZE and emit a warning log
   - Use `effectiveHtml` variable for all downstream operations (parseHtml, extractExternalResources, extractImageUrls, inlineScriptRegex, rawHtml)

3. In `processUrlInner()`:
   - After `response.text()`, added same truncation check before any processing
   - This catches oversized HTML at the entry point before it enters the redirect/challenge logic

4. Both truncation points log the original and truncated sizes for debugging

---

### Verification
- TypeScript compilation passes (`bunx tsc --noEmit` — no errors)

## Task 12: Fix MEDIUM Priority Issues from MAGI R5 Audit
**Date**: 2025-05-31
**Agent**: Sub-agent (Task 12)

### Scope
Fix 6 MEDIUM priority issues identified in the MAGI R5 audit: DNS timeout, socket reconnect, poll timeout cleanup, WebSocket input validation, Prisma graceful shutdown, and configurable CORS origins.

---

### Fix 1: S3 — DNS Timeout Not Configurable ✅
**File**: `src/lib/scan-engine/dns-cache.ts`
**Problem**: `cachedLookup()` called `dns.promises.lookup()` with no timeout. Default system DNS timeout can be 30+ seconds, causing scans to hang on unresponsive DNS servers.
**Changes**:
- Added `DNS_TIMEOUT_MS = 5000` constant (5-second timeout)
- Wrapped `lookup(hostname)` in a `Promise.race` with a timeout promise that rejects with `DNS timeout for ${hostname}`
- Added try/catch around the race to re-throw errors (timeout or DNS failures) to callers
- Cache store only happens on successful resolution

### Fix 2: F2 — Socket Never Reconnects After Server-Initiated Disconnect ✅
**File**: `src/lib/socket.ts`
**Problem**: When the server initiates a disconnect (`io server disconnect`), the socket.io client does NOT auto-reconnect. The old code only logged a warning.
**Changes**:
- Replaced the passive warning with an active reconnect attempt
- On `io server disconnect`, logs a warning and schedules `socket.connect()` after a 2-second delay
- Only reconnects if the socket is not already connected (guards against race conditions)

### Fix 3: F3 — pollScanUntilComplete No clearTimeout on Stop ✅
**File**: `src/lib/scan-api.ts`
**Problem**: `pollScanUntilComplete` used `setTimeout(poll, intervalMs)` but didn't store the timeout ID. When `stop()` was called, the timer could still fire, causing unexpected polling after stop.
**Changes**:
- Added `timeoutId: ReturnType<typeof setTimeout> | null = null` variable
- Store the timeout ID from both the initial `setTimeout(poll, 500)` and the recurring `setTimeout(poll, intervalMs)`
- Converted `stop()` from an inline arrow to a named function that clears the timeout and sets it to null
- Return `{ stop }` instead of `{ stop: () => { stopped = true; } }`

### Fix 4: A4 — WebSocket Events Lack Input Validation ✅
**File**: `mini-services/scan-engine/index.ts`
**Problem**: The `scan:start` WebSocket event handler didn't validate `concurrency`/`timeout` values. A client could set `concurrency: 10000`, causing resource exhaustion.
**Changes**:
- Added input validation at the start of the `scan:start` handler:
  - `concurrency` is clamped to range [1, 50]
  - `timeout` is clamped to range [1000, 60000] (1–60 seconds)
  - `urls` must be a non-empty array, otherwise emits `scan:error` and returns early

### Fix 5: D3 — Prisma Connection Never Closed on Shutdown ✅
**File**: `src/lib/db.ts`
**Problem**: No `db.$disconnect()` call anywhere. In production, graceful shutdown should disconnect Prisma to release resources properly.
**Changes**:
- Added graceful shutdown handler with `db.$disconnect()` + `process.exit(0)`
- Registers `SIGTERM` and `SIGINT` handlers
- HMR-safe: uses `globalThis.__prisma_shutdown_registered` flag to prevent duplicate registration
- Includes try/catch around disconnect to handle errors gracefully

### Fix 6: C2 — Mini-Service CORS Hardcoded to Localhost ✅
**Files**: `mini-services/scan-engine/index.ts`, `mini-services/data-sync-service/index.ts`
**Problem**: `ALLOWED_ORIGINS` was hardcoded to `['http://localhost:3000', 'http://127.0.0.1:3000']`. In Docker or custom deployments, this breaks CORS for any origin other than localhost.
**Changes** (applied to both mini-services):
- Replaced hardcoded array with: `(process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim()).filter(Boolean)`
- Defaults to localhost origins if `CORS_ORIGINS` env var is not set (backward compatible)
- Supports comma-separated list of origins from the environment variable
- Trims whitespace and filters empty strings for robustness

---

### Verification
- TypeScript compilation passes (`bunx tsc --noEmit` — no errors)

## Task 15: MAGI R6 — Targeted Improvements
**Date**: 2025-06-01
**Agent**: Sub-agent (Task 15)

### Scope
Six targeted improvements for production reliability and maintainability: startup health recovery, scan rate limiting, improved error messages, WebSocket heartbeat, input sanitization, and version bump.

---

### Fix 1: Startup Health Recovery for Stale Running Tasks ✅

**File**: `src/lib/scan-engine/task-store.ts`
**Problem**: When the Next.js server restarts, scan tasks in the DB with `status = 'running'` remain in that state forever since the previous process is gone. The UI shows stale "running" scans after a restart.
**Changes**:
- Added `recoverStaleRunningTasksFromDB()` function that queries `ScanTask` records with `status = 'running'` and updates them to `status = 'error'` with log entries saying "服务器重启，扫描任务中断"
- Added `recoverStaleInMemoryTasks()` function that marks in-memory tasks with `status = 'running'` as `status = 'error'`
- Added exported `startupHealthRecovery()` function that runs both recovery steps (HMR-safe via globalThis guard)
- Added auto-execution on module load: `startupHealthRecovery().catch(...)` runs when the module is first imported

---

### Fix 2: Scan Rate Limiting per IP ✅

**Files**: `src/app/api/scan/route.ts`, `src/app/api/scan/start/route.ts`
**Problem**: Scan rate limiting was already implemented in both scan start routes using the existing `checkRateLimit` utility from `src/lib/rate-limit.ts`, but with English error messages.
**Changes**:
- Rate limiting was already correctly configured at 10 scan starts per IP per minute in both routes
- Updated the rate limit error message from English to Chinese: `'扫描请求过于频繁，请稍后再试'` with error code `'SCAN_RATE_LIMITED'`
- No new rate limiter instance was needed since the existing `checkRateLimit` function already supports custom `windowMs` and `maxRequests` parameters

---

### Fix 3: Improve Error Messages in Scan API ✅

**Files**: `src/app/api/scan/route.ts`, `src/app/api/scan/start/route.ts`
**Problem**: Scan API error messages were a mix of English and Chinese, inconsistent, and lacked error codes for programmatic handling.
**Changes** (applied to both files):

All error responses now include:
- Chinese error messages for user-facing display
- `code` field for programmatic error handling

Error codes added:
| Code | Chinese Message | Context |
|------|----------------|---------|
| `SCAN_RATE_LIMITED` | 扫描请求过于频繁，请稍后再试 | Rate limit exceeded |
| `SCAN_MISSING_PARAMS` | 缺少必要参数：taskId 或 request | Missing required parameters |
| `SCAN_INVALID_URLS` | 检测到无效或危险的URL | Invalid/dangerous URLs |
| `SCAN_ALREADY_RUNNING` | 已有扫描任务正在运行 | Concurrent scan guard |
| `SCAN_MISSING_TASK_ID` | 缺少必要参数：taskId | Missing taskId |
| `SCAN_UNKNOWN_ACTION` | 未知的操作类型 | Unknown action |

---

### Fix 4: WebSocket Heartbeat to Detect Dead Connections ✅

**Files**: `src/lib/socket.ts`, `mini-services/scan-engine/index.ts`
**Problem**: The client-side Socket.IO connection could become silently dead without detection. While Socket.IO has built-in ping/pong, the client had no custom heartbeat to detect and recover from dead connections.
**Changes**:

**`src/lib/socket.ts`** (client-side):
- Added heartbeat mechanism with 25-second ping interval
- Each ping starts a 10-second timeout; if no `pong` is received, forces a disconnect/reconnect
- Heartbeat starts on `connect`, stops on `disconnect` and `connect_error`
- Properly cleans up intervals and timeouts to prevent memory leaks

**`mini-services/scan-engine/index.ts`** (server-side):
- Added `socket.on('ping', () => { socket.emit('pong'); })` handler to respond to client heartbeat pings

---

### Fix 5: Input Sanitization for URL Scan Targets ✅

**File**: `src/lib/security.ts`
**Problem**: Scan URLs were not sanitized before validation, leaving them vulnerable to control characters, Unicode homograph attacks, and duplicate scans from tracking parameters.
**Changes**:
- Added `sanitizeScanUrl()` function with four sanitization steps:
  1. **Trim whitespace** — Remove leading/trailing spaces
  2. **Remove control characters** — Strip C0 and C1 control codes (`\x00-\x1F`, `\x7F-\x9F`)
  3. **Normalize Unicode** — Apply NFC normalization to reduce homograph attack surface (e.g., visually identical characters with different code points)
  4. **Strip tracking parameters** — Remove common tracking query params (`utm_*`, `fbclid`, `gclid`, `msclkid`, `_ga`, `ref`, `spm`, `scm`, etc.) that cause duplicate scans
- Modified `validateScanUrls()` to call `sanitizeScanUrl()` on each URL before validation
- Sanitized URLs are used in the `valid` array, so downstream code gets clean URLs

---

### Fix 6: Update Version to 1.13.0 ✅

**File**: `package.json`
**Changes**:
- Changed `"version": "1.12.0"` to `"version": "1.13.0"`
- Ran `bun scripts/sync-version.ts` which updated both mini-service package.json files:
  - `mini-services/scan-engine/package.json`: 1.12.0 → 1.13.0 ✓
  - `mini-services/data-sync-service/package.json`: 1.12.0 → 1.13.0 ✓

---

### Verification
- TypeScript compilation passes (`bunx tsc --noEmit` — no errors)
- Build succeeds (`bun run build` — compiled successfully, 4 pre-existing Turbopack warnings unrelated to changes)

## Task 16: MAGI R7 — Final Review and Polish
**Date**: 2025-06-01
**Agent**: Sub-agent (Task 16)

### Scope
Final production readiness polish: fix auto-start crash loop, add Playwright error handling, scan timeout protection, SQLite path validation, and worklog cleanup.

---

### Fix 1: Auto-Start Cooldown and Retry Limit ✅

**Files**: `src/app/api/engine/status/route.ts`, `src/lib/engine-manager.ts`

**Problem**: When the engine status API detected offline services, it auto-started them every 30 seconds, which could cascade into crashes on the dev server. Spawning child processes from Next.js repeatedly is dangerous.

**Changes**:

`src/app/api/engine/status/route.ts`:
- Changed cooldown from 30s to 60s (`AUTO_START_COOLDOWN_MS = 60000`)
- Added `autoStartRetryCount` tracker and `MAX_AUTO_START_RETRIES = 3`
- If any service has exceeded max retries, skip auto-start entirely (`anyFailed` guard)
- Pass retry counter to `autoStartOfflineServices()` for tracking
- Added `mapStatus()` helper: services that hit max retries are reported as `'failed'` instead of `'offline'`

`src/lib/engine-manager.ts`:
- `autoStartOfflineServices()` now accepts optional `retryCount` and `maxRetries` parameters
- Skips services that exceeded max retries
- Resets retry counter when a service comes back online (health check succeeds)
- Resets retry counter on successful auto-start
- Increments retry counter on auto-start failure
- Logs a specific error when max retries are exceeded

---

### Fix 2: Graceful Playwright Missing Error Handling ✅

**File**: `src/lib/scan-engine/browser-renderer.ts`

**Problem**: If Playwright/Chromium is not installed, `chromium.launch()` throws an unhandled error that can crash the scan engine. The error message is cryptic and doesn't tell users how to fix it.

**Changes**:
- Wrapped `chromium.launch()` in a try-catch inside the `getBrowser()` function
- On failure, resets `_browserLaunchPromise = null` so subsequent attempts can retry
- Detects common Playwright missing-installation error patterns:
  - `Executable doesn't exist`
  - `playwright install`
  - `Unsupported platform`
  - `Browser has been disconnected`
  - `Could not find browser`
- Logs a helpful Chinese + English message: `Playwright未安装或Chromium缺失，浏览器渲染功能不可用。请运行: bunx playwright install chromium`
- Throws a user-friendly error: `'Playwright未安装，请运行: bunx playwright install chromium'`
- The outer catch in `renderPageForImages()` already catches this and returns a `BrowserRenderResult` with `success: false` and the error message, so the scan engine won't crash

---

### Fix 3: Scan Request Timeout Protection ✅

**File**: `src/app/api/scan/start/route.ts`

**Problem**: Scans could run indefinitely with no maximum execution time. A stuck scan would block all future scans (due to the `isAnyTaskRunning` guard).

**Changes**:
- Added `MAX_SCAN_DURATION_MS = 10 * 60 * 1000` (10 minutes)
- After registering the scan promise, sets a `setTimeout` that:
  - Checks if the task is still running
  - Calls `stopTask(taskId)` to abort it
  - Adds a warning log entry with the timeout message
- The timeout is cleared when the scan finishes naturally via `scanPromise.finally(() => clearTimeout(scanTimeout))`
- Uses `isTaskRunning` and `stopTask` from scan-engine (already imported)

---

### Fix 4: SQLite Path Validation in buildDatabaseUrl() ✅

**File**: `src/lib/config.ts`

**Problem**: If `config.yaml` specifies a SQLite path outside the project directory (path traversal) or to a non-existent directory, the application would fail silently or crash.

**Changes**:
- Added `import { mkdirSync } from 'fs'` and `import { relative } from 'path'`
- In the SQLite case of `buildDatabaseUrl()`:
  - **Path traversal prevention**: Uses `relative(process.cwd(), dbPath)` to check that the resolved path doesn't escape the project directory. If it starts with `..` or doesn't resolve to the same absolute path, throws a descriptive error in Chinese
  - **Directory creation**: Checks if the parent directory exists, and creates it with `mkdirSync(dir, { recursive: true })` if not. Logs the creation. If creation fails (permission error), throws a descriptive error in Chinese

---

### Fix 5: Worklog Cleanup ✅

**File**: `/home/z/my-project/worklog.md`

**Problem**: The worklog had grown to 2187 lines (20+ task entries), making it slow to read and consuming excessive context.

**Changes**:
- Trimmed to the last 5 task entries (Task 7-b through Task 15)
- Added a comment noting that older entries are in git history
- Reduced from 2187 lines to ~445 lines

---

### Verification
- TypeScript compilation passes (`bunx tsc --noEmit` — no errors)
- Build succeeds (`bun run build` — compiled successfully, pre-existing warnings unrelated to changes)

## Task 17: Fix Dev Server OOM Crash — Lazy-Load Heavy Dependencies
**Date**: 2025-06-01
**Agent**: Sub-agent (Task 17)

### Scope
Fix Next.js 16 dev server OOM crash caused by Playwright, sharp, and jsqr being loaded at module-init time through static imports, inflating the Turbopack server bundle to ~877MB RSS even before any scan is run.

---

### Fix 1: Lazy-load browser-renderer (Playwright) in scan-engine.ts ✅

**File**: `src/lib/scan-engine/scan-engine.ts`

**Problem**: `import { renderPageForImages, closeBrowser } from './browser-renderer'` caused Turbopack to bundle the entire Playwright library (~500MB) into the server bundle at module-init time, even though Playwright is only needed during actual scans.

**Changes**:
- Removed top-level `import { renderPageForImages, closeBrowser as closeBrowserRenderer } from './browser-renderer'`
- Added `import type { renderPageForImages as RenderPageForImagesFn, closeBrowser as CloseBrowserFn } from './browser-renderer'` (type-only import, no runtime cost)
- Added lazy-loading helpers: `_renderPageForImages`, `_closeBrowserRenderer` module-level variables + `getBrowserRenderer()` async function that uses `await import('./browser-renderer')`
- Updated `analyzeHtmlResult()` to call `const { renderPageForImages } = await getBrowserRenderer()` before using `renderPageForImages()`
- Updated `closeBrowserRenderer()` call at end of `executeScan()` to `getBrowserRenderer().then(({ closeBrowser }) => closeBrowser()).catch(() => {})`

**Expected impact**: ~500MB RSS reduction at dev server startup

---

### Fix 2: Lazy-load qr-detector (sharp + jsqr) in scan-engine.ts ✅

**File**: `src/lib/scan-engine/scan-engine.ts`

**Problem**: `import { detectQrCodes, detectQrCodesFromUrls, detectQrCodesFromDataUri } from './qr-detector'` caused sharp (~50-100MB with native bindings) and jsqr to be loaded at module-init time.

**Changes**:
- Removed top-level `import { detectQrCodes, detectQrCodesFromUrls, detectQrCodesFromDataUri } from './qr-detector'`
- Added `import type { detectQrCodesFromDataUri as ..., detectQrCodesFromUrls as ... } from './qr-detector'` (type-only import)
- Added lazy-loading helpers: `_detectQrCodesFromDataUri`, `_detectQrCodesFromUrls` module-level variables + `getQrDetector()` async function
- Updated `detectQrFromDataUris()` helper to call `const { detectQrCodesFromDataUri } = await getQrDetector()`
- Updated `analyzeHtmlResult()` QR detection call to use `const { detectQrCodesFromUrls } = await getQrDetector()`
- Removed unused `detectQrCodes` import (was never directly used in scan-engine.ts)

**Expected impact**: ~50-100MB RSS reduction at dev server startup

---

### Fix 3: Make sharp/jsqr dynamic inside qr-detector.ts ✅

**File**: `src/lib/scan-engine/qr-detector.ts`

**Problem**: `import jsQR from 'jsqr'` and `import sharp from 'sharp'` at the top level meant that even if someone accidentally imported qr-detector directly, the heavy deps would still load.

**Changes**:
- Replaced `import jsQR from 'jsqr'` with `import type jsqrType from 'jsqr'` + lazy-loading `getJsqr()` function using `await import('jsqr')`
- Replaced `import sharp from 'sharp'` with `import type sharpType from 'sharp'` + lazy-loading `getSharp()` function using `await import('sharp')`
- Changed `jsqrFromRgba()` from sync to async (returns `Promise<string | null>`) since it now needs to await the lazy-loaded jsqr
- Updated all `jsqrFromRgba()` call sites to use `await jsqrFromRgba()`
- Added `const sharp = await getSharp()` at the top of `detectQrCodes()` and used it throughout
- In the fallback catch block (where `sharp` may not be available from the main try), added `const sharpFallback = await getSharp()` to get a fresh reference

**Expected impact**: Additional safety net ensuring sharp/jsqr never load at module-init time; even if qr-detector is imported directly, the heavy deps are deferred until first use

---

### Skipped: Lazy-loading html-parser/cheerio

**File**: `src/lib/scan-engine/html-parser.ts`

**Analysis**: cheerio (~2-3MB) is used extensively in html-parser.ts, and `resolveUrl` from html-parser is used throughout scan-engine.ts in non-scan utility functions. Lazy-loading the entire html-parser module would require invasive changes to many function signatures. The memory savings (~2-3MB) are modest compared to Playwright (~500MB) and sharp (~50-100MB). Not worth the complexity.

---

### Files Not Modified (Assessed, No Changes Needed)

- **`browser-sim.ts`**: Only imports lightweight Node.js modules (`dns/promises`, `../security`). Its functions (`getBrowserHeaders`, `fetchWithRedirectControl`, etc.) are used in many places throughout scan-engine.ts including non-scan paths, making lazy-loading impractical.
- **`browser-renderer.ts`**: Not modified directly; only how it's imported from scan-engine.ts was changed.
- **`mini-services/scan-engine/`**: The mini-service runs as a separate Bun process (not Turbopack), so the OOM issue doesn't apply there. No browser-renderer import exists in the mini-service.

---

### Verification
- TypeScript compilation passes (`bunx tsc --noEmit` — 0 errors)
- Lint passes for all modified files (`bun run lint` — 0 new errors, 35 pre-existing errors in unrelated files)
- No logic changes — only import patterns were modified

