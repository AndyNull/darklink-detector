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
