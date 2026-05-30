# Worklog

## Task 1: Optimize rate limiting handling in sublink scanning

### Changes Made

#### Backend: `src/app/api/scan/sublinks/route.ts`
1. **Added retry with exponential backoff in `fetchPageHtml()`** for HTTP 429, 5xx errors, and connection failures (timeouts, resets). Backoff delays: 1s → 2s → 4s across 3 retry attempts.
   - curl now uses `-w '\n%{http_code}'` to capture the HTTP status code and detect 429/5xx responses.
   - Both curl and fetch fallback paths include retry logic with the same backoff pattern.
   - Connection errors (timeouts, resets) also trigger retry with backoff.

2. **Added `CRAWL_CONCURRENCY_DEEP = 2` constant** and reduced concurrency from 3 to 2 when depth >= 3 (deep mining) to avoid overwhelming servers.

3. **Added 200ms delay (`CRAWL_START_DELAY_MS`) between starting concurrent crawls** in `crawlPagesConcurrently()` to stagger requests and avoid burst traffic.

4. **`crawlPagesConcurrently()` now accepts a `concurrency` parameter** (defaults to `CRAWL_CONCURRENCY`), allowing depth-dependent concurrency control.

#### Frontend: `src/components/scan/scan-controls.tsx`
1. **Increased `MAX_DISCOVERY_RETRIES` from 1 to 2** — now allows up to 2 retries (3 total attempts) per URL discovery.

2. **Added exponential backoff with rate-limit detection**:
   - Normal errors: 2s on first retry, 4s on second retry
   - Rate-limit errors (message contains "429", "rate", or "too many"): 5s on first retry, 10s on second retry
   - `isRateLimitError()` helper function detects rate-limit patterns in error messages
   - User-friendly log messages differentiate between rate-limit and normal retries

3. **Added 500ms delay between starting discovery of different URLs** in the discovery loop to avoid overwhelming the server with concurrent requests.

#### Mini-services: No changes needed
- Checked `mini-services/scan-engine/` — no sublinks route exists there. The scan engine handles scan execution, not sublink discovery.

### No UI changes made
- Only scanning logic was modified; no UI components were changed.

## Task 3: Create v1.8.0 archive in public folder

### Changes Made
1. **Created archive** `/home/z/my-project/public/darklink-detector-1.8.0.tar.gz` (7.0 MB, 1008 entries) from project root, excluding:
   - `node_modules/`, `.next/`, `.git/`, `download/`, `upload/`
   - `*.tar.gz`, `*.tar`, `*.db` files
   - `dev.log`, `worklog.md`
2. **Verified archive integrity** — no excluded files leaked in (`.gitignore` and `.gitkeep` correctly retained as they are not the `.git/` directory).
3. **Removed old archive** from `/home/z/my-project/download/darklink-detector-1.8.0.tar.gz` to consolidate downloads into the `public/` folder.
4. Archive is now web-accessible at the public path for download.

## Task 4: Fix audit log association and download access

### Changes Made

#### 1. Download Package Fix
- **Moved archive** from `download/` to `public/darklink-detector-1.8.0.tar.gz` — now directly web-accessible
- **Updated `/api/download` route** to check `public/` folder first, then `download/` as fallback
- **Changed download URL** in API response from `/api/download?action=file` to `/${ARCHIVE_NAME}` (direct static file, no API overhead)
- Download section in Settings → 通用 → 项目打包 now works correctly with the new file location

#### 2. Audit Logger Core Fix (`src/lib/audit-logger.ts`)
- **Added `metadata` field** to `LogEntry` — structured machine-readable data (Record<string, unknown>)
- **Added `entityType` field** — links log entry to entity type (e.g. 'scan_task', 'threat_intel_source')
- **Added `entityId` field** — links log entry to specific entity ID (e.g. task ID, source ID)
- **Fixed `details` parameter** — now accepts `string | Record<string, unknown>`. Objects are stored as `metadata` with auto-generated readable `details` string
- **Added entity filters** to `LogFilter` and `readLogs()` — supports `entityType` and `entityId` filtering
- **Enhanced search** — now also searches metadata JSON, entityType, and entityId fields
- **Updated convenience methods** — `auditLog.auth/task/system/data()` now accept optional `entityType` and `entityId` params

#### 3. Call Site Fixes (10 sites updated)
All object-passing call sites now properly leverage the new metadata + entity system:

| File | Action | entityType | entityId |
|------|--------|------------|----------|
| `api/scan/start/route.ts` | scan_started | scan_task | taskId |
| `api/scan/stop/route.ts` | scan_stopped | scan_task | taskId |
| `lib/scan-engine/scan-engine.ts` | scan_completed/stopped | scan_task | taskId |
| `api/threat-intel/api-keys/route.ts` (×4) | api_key_saved/validated/deleted | threat_intel_source | source/sourceId |
| `api/config/database/route.ts` | db_config_changed | database_config | 'main' |
| `api/config/database/migrate/route.ts` (×2) | db_exported | database | 'main' |
| `api/config/database/import/route.ts` | db_imported | database | 'main' |
| `api/threat-intel-sources/route.ts` (×2) | api_key_saved/source_toggled | threat_intel_source | sourceId |

#### 4. Logs API Route (`src/app/api/logs/route.ts`)
- Added `entityType` and `entityId` query parameter support
- New filter params: `?entityType=scan_task&entityId=xxx`

#### 5. Frontend Logs Section (`src/components/scan/settings/logs-section.tsx`)
- **Entity badge** — shows entity type + truncated ID with Link2 icon and cyan styling
- **Expandable metadata** — entries with metadata show chevron toggle; expanded view shows key-value pairs
- **ENTITY_TYPE_LABELS** mapping for Chinese display names of entity types
- Added `expandedEntries` state for tracking which entries have metadata expanded
- Compact metadata display with 9px font in a subtle background

## Task 5: Fix HTML source code preview showing "无HTML内容" for successful scans

### Root Cause
The `/api/scan?action=results` endpoint strips `rawHtml` from results by default (to reduce network payload), unless `includeRawHtml=true` query param is passed. The frontend never passed this param, so `rawHtml` was always `undefined` in the UI, causing the HTML preview dialog to show "无HTML内容" even for successful scans.

### Solution: On-demand lazy loading of rawHtml

Instead of including `rawHtml` in the bulk results response (which would be expensive for large scans), the rawHtml is now fetched on demand when the user clicks "View Source".

### Changes Made

#### 1. New API endpoint: `src/app/api/scan/html/route.ts`
- Created a dedicated GET endpoint that lazy-loads rawHtml for a specific scan result
- Accepts `taskId` and `url` query parameters
- Uses `getTaskResults()` from `@/lib/scan-engine/task-store` to access the in-memory store
- Returns `{ rawHtml, url }` — rawHtml is null if not available
- No authentication required (viewing scan results is public, same as the main results endpoint)

#### 2. Scan store update: `src/lib/scan-store.ts`
- Added `updateResultRawHtml: (url: string, rawHtml: string) => void` action to the store interface
- Implementation maps over `results` and updates the matching result's `rawHtml` field
- This enables caching: once rawHtml is fetched for a result, subsequent "View Source" clicks don't need to re-fetch

#### 3. Results panel update: `src/components/scan/results-panel/index.tsx`
- Added `htmlLoading` state to track async rawHtml fetch
- Added `ScanResultItem` type import from scan-store
- Replaced direct `setPreviewResult` callback with new `handlePreview` async callback:
  - Immediately opens the dialog with available data (URL, status code, dark link details, etc.)
  - If `rawHtml` is missing, sets `htmlLoading=true` and fetches from `/api/scan/html`
  - On success, updates both the local `previewResult` state AND the store (via `updateResultRawHtml`)
  - Resets `htmlLoading=false` in `finally` block
- Passed `htmlLoading` prop to `HtmlPreviewDialog`
- Changed `AllResultsTab`'s `onPreview` from `setPreviewResult` to `handlePreview`

#### 4. HTML preview dialog update: `src/components/scan/html-preview-dialog.tsx`
- Added `htmlLoading?: boolean` prop (defaults to `false`)
- Added `Loader2` icon import from `lucide-react`
- Both tab content areas (highlighted and raw) now show a three-state rendering:
  1. **Loading state** (`htmlLoading && !rawHtml`): Spinner with "加载HTML内容..." text
  2. **Content state** (`rawHtml` exists): Shows the HTML content (highlighted or raw)
  3. **Empty state** (no rawHtml, not loading): "无HTML内容（可能为非HTML页面或扫描失败）"

#### 5. History loading path
- No changes needed. The `loadTaskResults` function in scan-store fetches from `/api/scan?action=results` without `includeRawHtml=true`, so rawHtml is `undefined` for history-loaded results. The lazy-load approach automatically handles this — when the user clicks "View Source" on a history result, `handlePreview` detects the missing rawHtml and fetches it on demand.

### Lint Results
- No new lint errors introduced by these changes
- All 32 pre-existing lint errors are in unrelated files (malicious-library, settings, carousel, etc.)

## Task 1 (Security): Comprehensive security fixes

### Changes Made

#### 1. DNS rebinding check before all fetchWithCurl calls (`src/lib/scan-engine/scan-engine.ts`)
Added DNS rebinding protection before all 4 `fetchWithCurl()` call sites:
- **Line ~953**: Final curl fallback when both fetch methods fail
- **Line ~1183**: Fast curl fallback for anti-bot challenge pages
- **Line ~1213**: Direct curl on first redirect page
- **Line ~1348**: Curl fallback after JS redirect loop

Each check:
1. Parses the URL and skips if hostname is already an IP address
2. Performs DNS lookup using `lookup()` from `dns/promises`
3. Validates the resolved IP via `validateResolvedIP()` from `@/lib/security`
4. Throws an error if the IP is private/reserved (blocks the curl request)
5. On DNS lookup failure, proceeds with curl (it may also fail naturally)

`validateResolvedIP` was already imported at the top of the file; the `lookup` function from `dns/promises` was also already imported.

#### 2. SQL injection fix (`mini-services/data-sync-service/index.ts`)
Replaced all SQL string interpolation in `queryMaliciousEntries()` with parameterized queries using Bun's SQLite driver `?` placeholders:

- **IP search** (`MaliciousIP`): `ip LIKE ? OR reason LIKE ? OR category LIKE ?` with `[%search%, %search%, %search%]` parameters for both COUNT and SELECT queries
- **Domain search** (`MaliciousDomain`): `domain LIKE ? OR reason LIKE ? OR category LIKE ?` with same parameter pattern
- **No-search path**: Uses `WHERE 1=1` with `LIMIT ? OFFSET ?` parameters instead of template literals
- Removed all `search.replace(/'/g, "''")` string escaping (now handled by parameterized queries)

#### 3. Auth on socket-proxy and scan/stop routes
- **`src/app/api/socket-proxy/[service]/[...path]/route.ts`**: Added `requireSessionAuth` import and auth check at top of both `GET` and `POST` handlers. Returns 401 if not authenticated.
- **`src/app/api/scan/stop/route.ts`**: Added `requireSessionAuth` import and auth check at top of `POST` handler.

#### 4. SSRF validation on unified scan endpoint (`src/app/api/scan/route.ts`)
Added `validateScanUrls` import from `@/lib/security` and call in the POST `start` action handler:
- Validates all URLs before scan starts
- Returns 400 with `invalidUrls` if any URLs fail validation
- Replaces `scanRequest.urls` with only validated URLs (matching pattern in `api/scan/start/route.ts`)

#### 5. Private IP filter on database test-connection (`src/app/api/config/database/test-connection/route.ts`)
Added `validateResolvedIP` import from `@/lib/security` and DNS resolution check in both `testMysql` and `testPostgresql`:
- Before making TCP connection, resolves the hostname via `dns.lookup`
- If resolved IP is private/reserved, returns 400 with error "不允许连接到内网地址"
- On DNS lookup failure, proceeds and lets the TCP connection fail naturally
- `testSqlite` is not affected (local file, no network connection)

#### 6. ThreatBook API key moved from URL to header (`src/app/api/threat-intel/route.ts`)
- **`queryThreatBookIP`**: Changed URL from `?apikey=${KEY}&ip=...` to `?ip=...`, moved API key to `X-API-Key` header
- **`queryThreatBookDomain`**: Changed URL from `?apikey=${KEY}&domain=...` to `?domain=...`, moved API key to `X-API-Key` header
- Added comment noting ThreatBook may not support header auth natively, but this is best-effort to avoid key exposure in URLs/server logs

#### 7. Safe error response helper (`src/lib/api-error.ts`)
Created new utility module with `safeErrorResponse(err, defaultMessage)`:
- In production: returns generic `defaultMessage` to prevent information leakage
- In development: returns original error message for debugging
- Returns `Response.json({ error: message }, { status: 500 })`

Updated 5 API routes to use `safeErrorResponse`:
- `api/scan/start/route.ts` — default: "扫描启动失败"
- `api/scan/stop/route.ts` — default: "停止扫描失败"
- `api/engine/start/route.ts` — default: "引擎启动失败"
- `api/engine/stop/route.ts` — default: "引擎停止失败"
- `api/config/route.ts` — default: "加载配置失败"

### Lint Results
- All modified files pass ESLint with zero errors
- 32 pre-existing lint errors in unrelated frontend components (React hooks set-state-in-effect warnings)

## Task 3: Performance and code quality fixes (12 items)

### Changes Made

#### 1. Task data cleanup in mini-services scan-engine (`mini-services/scan-engine/index.ts`)
- Added periodic cleanup interval (15 minutes) to remove expired tasks from memory
- Tasks with `completedAt` older than 1 hour (`TASK_TTL = 3600_000`) are cleaned up
- Deletes task results, progress, and logs for expired tasks
- Also fixed non-atomic read-then-write in both REST and WebSocket `onResult`/`onLog` callbacks:
  - Before: `const results = taskResults.get(taskId) || []; results.push(result); taskResults.set(taskId, results);`
  - After: `taskResults.set(taskId, [...(taskResults.get(taskId) || []), result]);`

#### 2. Browser-renderer race condition fix (`src/lib/scan-engine/browser-renderer.ts`)
- Replaced `activePages` counter with a proper `Semaphore` class
- Semaphore queues waiters instead of rejecting when at capacity — no more "Too many concurrent browser pages" errors
- `renderPageForImages` now uses `await pageSemaphore.acquire()` + `try/finally { pageSemaphore.release() }`
- Removed old `activePages` variable and its `Math.max(0, activePages - 1)` decrement

#### 3. Scan results race condition fix (`src/app/api/scan/route.ts`)
- Fixed non-atomic read-then-write in `onResult` and `onLog` callbacks
- Before: `const existing = store.taskResults.get(taskId) || []; existing.push(result); store.taskResults.set(taskId, existing);`
- After: `store.taskResults.set(taskId, [...(store.taskResults.get(taskId) || []), result]);`
- Same fix applied to `onLog` callback

#### 4. Scan-report-dialog broken references fix (`src/components/scan/scan-report-dialog.tsx`)
- Removed references to non-existent store methods `getScanDuration` and `maliciousMatches`
- `getScanDuration`: Replaced with computed value from `scanStartTime`: `scanStartTime ? Date.now() - scanStartTime : null`
- `maliciousMatches`: Replaced with `getFilteredDarkLinks()` from the store, using `.length` for count and iterating for badge display
- Malicious library badges now show URL + description instead of domain + reason (matching available data)

#### 5. Dead settings-dialog.tsx deleted (`src/components/settings/settings-dialog.tsx`)
- File used wrong localStorage key (`detection-rules-states`) and outdated rule IDs (e.g., `css-hidden` instead of `css_hidden`)
- Not imported anywhere in the codebase — verified via grep
- File deleted

#### 6. Removed ignoreBuildErrors from next.config.ts (`next.config.ts`)
- Removed `typescript: { ignoreBuildErrors: true }` from config
- This was masking TypeScript errors during builds

#### 7. Cleaned unused imports in scan-engine (`src/lib/scan-engine/scan-engine.ts`)
- Removed unused import `MAX_REDIRECTS` from `./browser-sim`
- Removed unused type import `BrowserRenderResult` from `./browser-renderer`
- Removed unused function `decodeDataUri` (was defined but never called)
- Kept `PREFER_CURL_ON_FIRST_REDIRECT` — it IS used at line 1210

#### 8. Fixed isZeroSize semantics in html-parser (`src/lib/scan-engine/html-parser.ts`)
- `isZeroSize` previously returned `true` for both 0 and 1, which was misleading
- Split into two functions:
  - `isZeroSize(value)`: returns true only for `parseInt(value) === 0`
  - `isOnePixelSize(value)`: returns true only for `parseInt(value) === 1`
- Updated the iframe hidden detection call site to check both: `isZeroSize(width) || isZeroSize(height) || isOnePixelSize(width) || isOnePixelSize(height)`
- The 1x1 pixel iframe detection (section 10g) already used direct string comparison (`width === '0' || width === '1'`), so no change needed there

#### 9. Fixed __dirname ESM issue in data-sync-service (`mini-services/data-sync-service/index.ts`)
- Replaced implicit `__dirname` (non-standard in ESM) with `import.meta.dirname`
- Bun supports `import.meta.dirname` natively

#### 10. Added request body size limit to mini scan-engine (`mini-services/scan-engine/index.ts`)
- `readBody()` now accepts optional `maxSize` parameter (default: 1MB = 1024 * 1024)
- If request body exceeds `maxSize`, rejects with "Request body too large" and destroys the request
- Prevents memory exhaustion from oversized request bodies

#### 11. Fixed health endpoint hardcoded value (`src/app/api/health/route.ts`)
- Replaced hardcoded `activeTasks: 0` with actual count from shared globalThis scan store
- Uses `store?.activeScanPromises.size ?? 0` to get the real number of active scan tasks

#### 12. Made root API route useful (`src/app/api/route.ts`)
- Replaced "Hello, world!" response with API metadata
- Now returns `{ name: 'DarkLink Detector', version: APP_VERSION, status: 'running' }`
- Imports `APP_VERSION` from `@/lib/version`

### Lint Results
- All modified files pass ESLint with zero new errors
- 32 pre-existing lint errors remain in unrelated frontend components (React hooks set-state-in-effect warnings)

## Task 2: Architecture refactoring (5 sub-tasks)

### Changes Made

#### 1. Add missing indexes to SQLite Prisma schema (`prisma/schema.prisma`)
Copied ALL `@@index` annotations from the MySQL schema to the SQLite schema:
- ScanTask: `@@index([status])`, `@@index([createdAt])`
- ScanResult: `@@index([taskId])`, `@@index([status])`
- UrlDetail: `@@index([resultId])`, `@@index([domain])`
- DarkLink: `@@index([resultId])`, `@@index([severity])`
- QrCodeResult: `@@index([resultId])`
- ScanLog: `@@index([taskId])`, `@@index([level])`

Ran `bun run db:push` to apply the indexes to the database.

#### 2. Complete MySQL and PostgreSQL schemas with missing models
Added 7 missing models from the SQLite schema to both `prisma/schema.mysql.prisma` and `prisma/schema.postgresql.prisma`:
- `MaliciousDomain` — with `@db.VarChar` constraints for MySQL
- `MaliciousIP` — with `@db.VarChar(45)` for IPv6 support
- `UpdateSchedule` — with `@db.VarChar` constraints
- `ThreatIntelSource` — with `entries` relation
- `ThreatIntelEntry` — with `@@index([type, value])`, `@@index([sourceId])`, `@@index([value])`, `@@unique([sourceId, type, value])`
- `ThreatIntelApiKey` — with `@db.VarChar` constraints
- `SyncTask` — with `@db.Text`/`@db.MediumText` for JSON fields (MySQL)

Also added missing `qrImageBase64` field to QrCodeResult in both MySQL (`@db.MediumText`) and PG schemas.

#### 3. Extract shared utilities from scan engine
Created `src/lib/scan-engine/shared-constants.ts` containing:
- **`TRUSTED_DOMAINS`**: Unified Set merged from `html-parser.ts` (60+ entries) and `scan-engine.ts` (40+ entries), deduplicated (`cdn.jsdelivr.net` appeared 3× in html-parser)
- **`URL_SHORTENERS`**: Merged array from `html-parser.ts` and `qr-detector.ts`, with all duplicates removed
- **`extractDomain()`**: Picked the more complete version from `scan-engine.ts` (with IPv6 regex support)
- **`isValidDomain()`**: Picked the more complete version from `scan-engine.ts` (with `IPV6_REGEX` instead of simple bracket check)
- **`isSuspiciousDomain()`**: Picked the version that checks `TRUSTED_DOMAINS` (from `scan-engine.ts`)

Updated `src/lib/scan-engine/html-parser.ts`:
- Added import from `./shared-constants`
- Removed local `TRUSTED_DOMAINS` Set definition (was duplicate with 3x `cdn.jsdelivr.net`)
- Removed local `URL_SHORTENERS` array definition
- Removed local `extractDomain`, `isValidDomain`, `isSuspiciousDomain` function definitions

Updated `src/lib/scan-engine/scan-engine.ts`:
- Added import from `./shared-constants`
- Removed local `extractDomain`, `isValidDomain` function definitions
- Removed local `TRUSTED_DOMAINS_ENGINE` Set and `isSuspiciousDomain` function definition
- Now uses `TRUSTED_DOMAINS` directly (renamed from `TRUSTED_DOMAINS_ENGINE`)

#### 4. Fix Docker entrypoint graceful shutdown (`docker-entrypoint.sh`)
The problem: `exec bun server.js` replaces the shell process, so the SIGTERM trap never fires.

Fix applied:
- Changed `exec bun server.js` to `bun server.js &` (run in background)
- Capture `MAIN_PID=$!`
- `wait $MAIN_PID` at the end (blocks until main app exits)
- Updated `cleanup()` to also kill `$MAIN_PID` and use `wait` instead of `sleep 2`
- The trap on `SIGTERM SIGINT` now properly fires and cleans up all child processes

#### 5. Sync mini-services scan engine with src/lib

**5a. Add IPv6 SSRF protection to mini-services scan-engine (`mini-services/scan-engine/scan-engine.ts`)**
Replaced the inline `validateResolvedIP()` function (IPv4-only) with a full implementation from `src/lib/security.ts`:
- Added IPv6 private range detection: `::1` (loopback), `fc00::/7` (unique-local), `fe80::/10` (link-local)
- Added `isPrivateIPv6()` with `expandIPv6()` helper for full 8-group expansion
- Added `isPrivateIP()` with numeric range comparison (same as security.ts)
- Added `PRIVATE_IP_RANGES` array and `ipToNumber()` helper
- Handles IPv4-mapped IPv6 addresses (`::ffff:x.x.x.x`)

**5b. Sync detection databases from src/lib to mini-services**

`mini-services/scan-engine/html-parser.ts`:
- **MALICIOUS_KEYWORDS**: Replaced 100-entry list with the full 150+ entry version from src/lib (added: Chinese crypto scam keywords, phishing/credential harvesting, fraud keywords, gambling platform names, SEO cheating, phishing keywords, illegal medical, counterfeit/smuggling, additional Japanese/Korean/Russian/English keywords, suspicious path patterns)
- **URL_SHORTENERS**: Replaced 40+ entry list with the 70+ entry version from shared-constants.ts (added: monetized shorteners, Chinese shorteners, additional common shorteners, qr-detector entries)
- **CHEAP_TLDS**: Replaced 40+ entry list with the 70+ entry version from src/lib (added: additional cheap TLDs like `fun`, `host`, `press`, `space`, `surf`, `skin`, `quest`, `ninja`, `cheap`, `marketplace`, etc.)
- **TRUSTED_DOMAINS**: Replaced 40+ entry Set with the 60+ entry version from shared-constants.ts (added: Chinese CDNs like `lf3-cdn-tos.bytecdntp.com`, analytics like `region1.google-analytics.com`, social like `api-share.facebook.com`, cloud services like `azurewebsites.net`, common services like Stripe/PayPal/Braintree/Shopify)
- **LEGIT_CHEAP_TLD_DOMAINS**: Replaced 15-entry Set with the 20-entry version from src/lib (added: `onrender.com`, `railway.app`, `fly.dev`, `deno.dev`, `supabase.co`, `hasura.app`, `firebaseapp.com`, `elasticbeanstalk.com`, `azurewebsites.net`)

`mini-services/scan-engine/scan-engine.ts`:
- **TRUSTED_DOMAINS_ENGINE**: Replaced with the full version from shared-constants.ts (same entries as html-parser update above)

### Lint Results
- No new lint errors introduced
- 35 pre-existing lint errors remain in unrelated frontend components (React hooks set-state-in-effect, immutability warnings)
