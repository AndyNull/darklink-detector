import { lookup } from 'dns/promises';

interface DnsCacheEntry {
  address: string;
  family: number;
  expiresAt: number;
}

/**
 * Simple in-memory DNS cache with TTL support.
 * Reduces repeated DNS lookups for the same hostname during scans.
 *
 * Default TTL: 60 seconds (short enough to catch DNS changes,
 * long enough to benefit from caching during a scan batch)
 */
const DEFAULT_TTL_MS = 60_000;

const cache = new Map<string, DnsCacheEntry>();

// HMR-safe periodic cleanup of expired entries (every 5 minutes)
if (typeof globalThis !== 'undefined') {
  const g = globalThis as any;
  if (g.__dns_cache_cleanup__) {
    clearInterval(g.__dns_cache_cleanup__);
  }
  g.__dns_cache_cleanup__ = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now >= entry.expiresAt) {
        cache.delete(key);
      }
    }
  }, 5 * 60_000);
}

/**
 * Resolve a hostname with caching.
 * Returns the cached result if still valid, otherwise performs a DNS lookup.
 */
export async function cachedLookup(hostname: string, ttlMs: number = DEFAULT_TTL_MS): Promise<{ address: string; family: number }> {
  const cached = cache.get(hostname);
  if (cached && Date.now() < cached.expiresAt) {
    return { address: cached.address, family: cached.family };
  }

  const result = await lookup(hostname);
  cache.set(hostname, {
    address: result.address,
    family: result.family,
    expiresAt: Date.now() + ttlMs,
  });
  return result;
}

/**
 * Invalidate a specific hostname from the cache.
 * Useful when a DNS rebinding attack is detected.
 */
export function invalidateDnsCache(hostname: string): void {
  cache.delete(hostname);
}

/**
 * Clear the entire DNS cache.
 */
export function clearDnsCache(): void {
  cache.clear();
}

/**
 * Get cache statistics (for debugging/monitoring).
 */
export function getDnsCacheStats(): { size: number; entries: Array<{ hostname: string; address: string; ttlRemaining: number }> } {
  const now = Date.now();
  const entries = Array.from(cache.entries()).map(([hostname, entry]) => ({
    hostname,
    address: entry.address,
    ttlRemaining: Math.max(0, entry.expiresAt - now),
  }));
  return { size: cache.size, entries };
}
