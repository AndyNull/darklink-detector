'use client';

/**
 * Centralized API client with TTL-based caching.
 *
 * - Wraps all API calls in functions with built-in caching
 * - Uses TTL (time-to-live) — data is fresh for N seconds
 * - Provides `invalidateCache(endpoint)` for manual invalidation after mutations
 * - Supports `forceRefresh` parameter to bypass cache
 * - Returns cached data immediately if still fresh
 */

// ─── Cache Types ──────────────────────────────────────────────────────────────

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number; // ms since epoch
  ttl: number;       // ms
}

// ─── In-Memory Cache ──────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();

/** Maximum number of entries to keep in the cache (LRU eviction) */
const MAX_CACHE_SIZE = 200;

/** Default TTL values per endpoint group (in ms) */
const DEFAULT_TTL: Record<string, number> = {
  '/api/malicious':           30_000,   // 30s — entries change on add/delete
  '/api/threat-intel/sources': 60_000,  // 60s — source stats update less often
  '/api/threat-intel/schedule': 60_000, // 60s
  '/api/sync-tasks':           15_000,  // 15s — sync tasks change frequently
};

const FALLBACK_TTL = 30_000; // 30 seconds

// ─── Global Error Handler for API Calls ────────────────────────────────────────

/**
 * Common error handling wrapper for all API fetch calls.
 * If the response status is 401 (unauthorized) on a WRITE operation (non-GET),
 * dispatches a custom event that the auth context listens to, so the login
 * dialog is shown instead of failing silently when sessions expire.
 *
 * NOTE: GET requests are read-only and should be publicly accessible.
 * We do NOT dispatch auth-session-expired for GET 401s to avoid prompting
 * unauthenticated users to log in when they're just viewing data.
 */
export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 401) {
    const method = (options?.method || 'GET').toUpperCase();
    // Only dispatch auth-expired event for write operations (POST/PUT/DELETE/PATCH)
    // GET requests that return 401 are likely misconfigured endpoints or
    // optional auth checks — don't force login dialog on read-only access
    if (method !== 'GET') {
      window.dispatchEvent(new CustomEvent('auth-session-expired'));
    }
  }
  return res;
}

// ─── Core Cache Functions ─────────────────────────────────────────────────────

/**
 * Build a cache key from the URL (without leading slash and query params sorted
 * for deterministic matching).
 */
function buildCacheKey(url: string): string {
  try {
    const u = new URL(url, 'http://dummy');
    const pathname = u.pathname;
    const params = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    const qs = params.map(([k, v]) => `${k}=${v}`).join('&');
    return qs ? `${pathname}?${qs}` : pathname;
  } catch {
    return url;
  }
}

/** Get the TTL for a given URL based on its pathname */
function getTtlForUrl(url: string): number {
  try {
    const u = new URL(url, 'http://dummy');
    // Try exact match first, then prefix match
    if (DEFAULT_TTL[u.pathname]) return DEFAULT_TTL[u.pathname];
    for (const [prefix, ttl] of Object.entries(DEFAULT_TTL)) {
      if (u.pathname.startsWith(prefix)) return ttl;
    }
  } catch {
    // ignore
  }
  return FALLBACK_TTL;
}

/**
 * Check if a cache entry is still fresh.
 */
function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < entry.ttl;
}

/**
 * Get cached data if still fresh, otherwise undefined.
 */
export function getCached<T = unknown>(url: string): T | undefined {
  const key = buildCacheKey(url);
  const entry = cache.get(key);
  if (entry && isFresh(entry)) {
    return entry.data as T;
  }
  if (entry) {
    cache.delete(key); // Stale, remove
  }
  return undefined;
}

/**
 * Store data in the cache.
 */
export function setCache<T = unknown>(url: string, data: T, ttl?: number): void {
  const key = buildCacheKey(url);
  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl: ttl ?? getTtlForUrl(url),
  });
  // LRU eviction: delete oldest entries when cache exceeds the size limit
  if (cache.size > MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(cache.keys()).slice(0, cache.size - MAX_CACHE_SIZE);
    for (const k of keysToDelete) cache.delete(k);
  }
}

/**
 * Invalidate cache for a specific endpoint (exact URL match).
 * Returns true if an entry was found and removed.
 */
export function invalidateCache(url: string): boolean {
  const key = buildCacheKey(url);
  return cache.delete(key);
}

/**
 * Invalidate all cache entries whose key starts with the given prefix.
 * Useful for invalidating all `/api/malicious` variants after a mutation.
 */
export function invalidateCacheByPrefix(prefix: string): number {
  let count = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      count++;
    }
  }
  return count;
}

/**
 * Clear the entire cache.
 */
export function clearCache(): void {
  cache.clear();
}

// ─── Cached Fetch Wrapper ─────────────────────────────────────────────────────

interface CachedFetchOptions extends RequestInit {
  /** Force a network request, bypassing the cache */
  forceRefresh?: boolean;
  /** Custom TTL in ms for this request */
  ttl?: number;
}

/**
 * Fetch with caching. Returns cached data if still fresh, otherwise makes
 * a network request and caches the result.
 *
 * Only supports GET requests for caching. Non-GET methods always bypass cache.
 */
export async function cachedFetch<T = unknown>(
  url: string,
  options: CachedFetchOptions = {},
): Promise<T> {
  const { forceRefresh, ttl, ...fetchOptions } = options;

  // Non-GET requests always bypass cache
  const method = (fetchOptions.method || 'GET').toUpperCase();
  if (method !== 'GET' || forceRefresh) {
    const res = await apiFetch(url, fetchOptions);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  // Check cache
  const cached = getCached<T>(url);
  if (cached !== undefined) {
    return cached;
  }

  // Fetch from network
  const res = await apiFetch(url, fetchOptions);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const data = await res.json() as T;

  // Store in cache
  setCache(url, data, ttl);

  return data;
}

// ─── Domain-Specific API Functions ────────────────────────────────────────────

/** Response shape for GET /api/malicious */
export interface MaliciousEntriesResponse {
  items: unknown[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Fetch malicious entries with caching.
 */
export async function fetchMaliciousEntries(params: {
  type: 'domain' | 'ip';
  page?: number;
  pageSize?: number;
  search?: string;
  forceRefresh?: boolean;
}): Promise<MaliciousEntriesResponse> {
  const { type, page = 1, pageSize = 50, search, forceRefresh } = params;
  const qs = new URLSearchParams({
    type,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) qs.set('search', search);

  const url = `/api/malicious?${qs.toString()}`;
  return cachedFetch<MaliciousEntriesResponse>(url, { forceRefresh });
}

/**
 * Fetch threat intel sources with caching.
 */
export async function fetchThreatIntelSources(forceRefresh = false): Promise<{
  sources: unknown[];
  summary: { totalDomains: number; totalIps: number; total: number };
  categories: unknown;
  severities: unknown;
}> {
  return cachedFetch('/api/threat-intel/sources', { forceRefresh });
}

/**
 * Fetch schedule with caching.
 */
export async function fetchSchedule(forceRefresh = false): Promise<{
  schedule: {
    enabled: boolean;
    frequency: string;
    lastRunAt: string | null;
    nextRunAt: string | null;
    status: string;
  };
}> {
  return cachedFetch('/api/threat-intel/schedule', { forceRefresh });
}

/**
 * Invalidate all malicious entries cache (after add/delete/import).
 */
export function invalidateMaliciousCache(): void {
  invalidateCacheByPrefix('/api/malicious?');
  // Also invalidate the sources endpoint since counts change
  invalidateCacheByPrefix('/api/threat-intel/sources');
}

/**
 * Invalidate threat intel sources cache (after sync).
 */
export function invalidateThreatIntelCache(): void {
  invalidateCacheByPrefix('/api/threat-intel/sources');
  invalidateCacheByPrefix('/api/threat-intel/schedule');
  invalidateCacheByPrefix('/api/malicious?');
}
