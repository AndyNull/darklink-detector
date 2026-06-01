// Simple in-memory rate limiter
// Tracks requests by IP address with bounded memory
const MAX_ENTRIES = 10_000;

interface RateLimitEntry {
  count: number;
  resetTime: number;
  lastRequest: number; // timestamp of last request, used for eviction
}

const requests = new Map<string, RateLimitEntry>();

interface RateLimitOptions {
  windowMs: number;   // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

/**
 * Evict oldest entries when the Map exceeds MAX_ENTRIES.
 * Removes entries with the oldest lastRequest time first.
 */
function evictOldestEntries(): void {
  if (requests.size <= MAX_ENTRIES) return;

  // Collect entries sorted by lastRequest (oldest first)
  const entries = Array.from(requests.entries())
    .sort((a, b) => a[1].lastRequest - b[1].lastRequest);

  // Remove oldest entries until we're under the limit
  const excess = requests.size - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) {
    requests.delete(entries[i][0]);
  }
}

export function checkRateLimit(
  request: Request,
  options: RateLimitOptions = { windowMs: 60000, maxRequests: 100 }
): RateLimitResult {
  // Prefer x-real-ip header over x-forwarded-for to reduce IP spoofing risk.
  // x-real-ip is typically set by the reverse proxy (e.g., Nginx) and is
  // harder to spoof than x-forwarded-for which can be set by the client.
  const realIp = request.headers.get('x-real-ip');
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = realIp?.trim() || forwarded?.split(',')[0]?.trim() || 'unknown';

  const now = Date.now();
  const record = requests.get(ip);

  if (!record || now > record.resetTime) {
    // Evict oldest entries if we're at capacity before adding a new one
    if (requests.size >= MAX_ENTRIES) {
      evictOldestEntries();
    }
    requests.set(ip, { count: 1, resetTime: now + options.windowMs, lastRequest: now });
    return { allowed: true, remaining: options.maxRequests - 1, resetIn: options.windowMs };
  }

  record.lastRequest = now;

  if (record.count >= options.maxRequests) {
    return { allowed: false, remaining: 0, resetIn: record.resetTime - now };
  }

  record.count++;
  return { allowed: true, remaining: options.maxRequests - record.count, resetIn: record.resetTime - now };
}

// Periodic cleanup: remove expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of requests) {
      if (now > record.resetTime) {
        requests.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL);
}
