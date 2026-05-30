// Simple in-memory rate limiter
// Tracks requests by IP address
const requests = new Map<string, { count: number; resetTime: number }>();

interface RateLimitOptions {
  windowMs: number;   // Time window in milliseconds
  maxRequests: number; // Max requests per window
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

export function checkRateLimit(
  request: Request,
  options: RateLimitOptions = { windowMs: 60000, maxRequests: 100 }
): RateLimitResult {
  // Get client IP from headers (behind proxy) or fallback
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';

  const now = Date.now();
  const record = requests.get(ip);

  if (!record || now > record.resetTime) {
    requests.set(ip, { count: 1, resetTime: now + options.windowMs });
    return { allowed: true, remaining: options.maxRequests - 1, resetIn: options.windowMs };
  }

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
