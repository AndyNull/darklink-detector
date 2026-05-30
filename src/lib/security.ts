/**
 * Security utilities for DarkLink Detector
 * - SSRF protection: validate scan URLs, block private IPs
 * - DNS rebinding protection: validate resolved IPs post-DNS-lookup (validateResolvedIP)
 * - IP validation: strict octet checking (0-255, no leading zeros)
 * - Header sanitization: prevent CRLF injection
 */

// Private IP ranges to block for SSRF protection
const PRIVATE_IP_RANGES = [
  { start: 10 * 256 ** 3, end: 10 * 256 ** 3 + 255 * 256 ** 2 + 255 * 256 + 255 },  // 10.0.0.0/8
  { start: 172 * 256 ** 3 + 16 * 256 ** 2, end: 172 * 256 ** 3 + 31 * 256 ** 2 + 255 * 256 + 255 }, // 172.16.0.0/12
  { start: 192 * 256 ** 3 + 168 * 256 ** 2, end: 192 * 256 ** 3 + 168 * 256 ** 2 + 255 * 256 + 255 }, // 192.168.0.0/16
  { start: 127 * 256 ** 3, end: 127 * 256 ** 3 + 255 * 256 ** 2 + 255 * 256 + 255 }, // 127.0.0.0/8
  { start: 169 * 256 ** 3 + 254 * 256 ** 2, end: 169 * 256 ** 3 + 254 * 256 ** 2 + 255 * 256 + 255 }, // 169.254.0.0/16
  { start: 0, end: 255 * 256 ** 2 + 255 * 256 + 255 }, // 0.0.0.0/8
];

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIP(ip: string): boolean {
  const num = ipToNumber(ip);
  return PRIVATE_IP_RANGES.some(range => num >= range.start && num <= range.end);
}

// ─── DNS Rebinding Protection ─────────────────────────────────────────────
// validateScanUrl() only checks the hostname at URL-parse time. An attacker
// can register a domain that initially resolves to a public IP, then changes
// to 127.0.0.1 after validation passes (DNS rebinding). This function is
// intended to be called AFTER DNS resolution to verify the actual IP is not
// private/reserved.
//
// IPv6 private ranges:
//   ::1/128        — loopback
//   fc00::/7       — unique-local (RFC 4193)
//   fe80::/10      — link-local (RFC 4291)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate a DNS-resolved IP address against private/reserved ranges.
 * Returns `true` if the IP is safe (public), `false` if it is private/reserved.
 *
 * Supports both IPv4 (e.g. "192.168.1.1") and IPv6 (e.g. "::1", "fc00::1").
 *
 * Usage: call this after DNS resolution and before making the HTTP request,
 *        or immediately after the connection is established if the resolved
 *        IP can be inspected (e.g. via a custom HTTP agent).
 */
export function validateResolvedIP(ip: string): boolean {
  // ── IPv6 handling ──
  if (ip.includes(':')) {
    // Check IPv6 private ranges first
    if (isPrivateIPv6(ip)) return false;

    // Handle IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1)
    const v4MappedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4MappedMatch) {
      return !isPrivateIP(v4MappedMatch[1]);
    }

    return true;
  }

  // ── IPv4 handling (reuse existing range check) ──
  if (isValidIP(ip)) {
    return !isPrivateIP(ip);
  }

  // If the format is unrecognized, reject conservatively
  return false;
}

/**
 * Check whether an IPv6 address falls into a private/reserved range.
 * Handles shortened forms like "::1" by expanding to full 8-group notation.
 */
function isPrivateIPv6(ip: string): boolean {
  const groups = expandIPv6(ip);

  // ::1 — loopback
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
      groups[4] === 0 && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) {
    return true;
  }

  // fc00::/7 — unique-local (first 7 bits = 1111110 → first byte 0xfc or 0xfd)
  if ((groups[0] & 0xfe00) === 0xfc00) {
    return true;
  }

  // fe80::/10 — link-local (first 10 bits = 1111111010 → first byte 0xfe, second byte & 0xc0 == 0x80)
  if (groups[0] === 0xfe80 && (groups[1] & 0xc000) === 0x0000) {
    return true;
  }

  return false;
}

/**
 * Expand an IPv6 address string into 8 numeric 16-bit groups.
 * Handles shorthand like "::1" → [0,0,0,0,0,0,0,1].
 */
function expandIPv6(ip: string): number[] {
  // Handle IPv4-mapped IPv6 like ::ffff:192.168.1.1
  const v4MappedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedMatch) {
    // Treat as the embedded IPv4 — those ranges are already covered by isPrivateIP
    // Return a sentinel that won't match IPv6 private ranges; the caller should
    // also run the IPv4 check separately.
    const v4Part = v4MappedMatch[1];
    const octets = v4Part.split('.').map(Number);
    // Encode as ::ffff:x.x.x.x per RFC 5155 → groups 5=0xffff, 6|7 = IPv4
    return [0, 0, 0, 0, 0, 0xffff, (octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
  }

  const halves = ip.split('::');
  const result: number[] = new Array(8).fill(0);

  if (halves.length === 1) {
    // No :: shorthand
    const parts = ip.split(':').map(p => (p ? parseInt(p, 16) : 0));
    for (let i = 0; i < Math.min(parts.length, 8); i++) {
      result[i] = parts[i];
    }
  } else {
    // :: shorthand
    const left = halves[0] ? halves[0].split(':').map(p => parseInt(p, 16)) : [];
    const right = halves[1] ? halves[1].split(':').map(p => parseInt(p, 16)) : [];
    for (let i = 0; i < left.length; i++) {
      result[i] = left[i];
    }
    const rightStart = 8 - right.length;
    for (let i = 0; i < right.length; i++) {
      result[rightStart + i] = right[i];
    }
  }

  return result;
}

/**
 * Validate a URL for scanning - blocks SSRF attacks
 */
export function validateScanUrl(url: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(url);

    // Only allow HTTP/HTTPS
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, reason: `Non-HTTP protocol: ${parsed.protocol}` };
    }

    // Block URLs with userinfo (SSRF via http://evil@target.com)
    if (parsed.username || parsed.password) {
      return { valid: false, reason: 'URL contains userinfo credentials' };
    }

    const hostname = parsed.hostname;

    // Block localhost
    if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
      return { valid: false, reason: 'Localhost blocked' };
    }

    // Check if hostname is an IP
    if (isValidIP(hostname)) {
      if (isPrivateIP(hostname)) {
        return { valid: false, reason: `Private IP blocked: ${hostname}` };
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: 'Invalid URL format' };
  }
}

/**
 * Strict IPv4 validation - each octet 0-255, no leading zeros
 */
export function isValidIP(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  for (const part of parts) {
    // No leading zeros (except "0" itself)
    if (part.length > 1 && part.startsWith('0')) return false;

    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return false;

    // Ensure no non-numeric characters
    if (part !== String(num)) return false;
  }

  return true;
}

/**
 * Sanitize HTTP headers to prevent CRLF injection
 */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    // Strip CRLF and null bytes from keys and values
    const cleanKey = key.replace(/[\r\n\x00]/g, '');
    const cleanValue = value.replace(/[\r\n\x00]/g, '');

    // Skip empty keys
    if (!cleanKey) continue;

    // Enforce length limits
    if (cleanKey.length > 256 || cleanValue.length > 4096) continue;

    sanitized[cleanKey] = cleanValue;
  }

  return sanitized;
}

/**
 * Batch validate scan URLs
 */
export function validateScanUrls(urls: string[]): { valid: string[]; invalid: { url: string; reason: string }[] } {
  const valid: string[] = [];
  const invalid: { url: string; reason: string }[] = [];

  for (const url of urls) {
    const result = validateScanUrl(url);
    if (result.valid) {
      valid.push(url);
    } else {
      invalid.push({ url, reason: result.reason || 'Unknown error' });
    }
  }

  return { valid, invalid };
}
