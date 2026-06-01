// Realistic browser simulation headers and behavior
// Each fingerprint includes UA, Accept-Language, viewport, and platform info
// to make concurrent scan threads look like different real browsers.

import { lookup } from 'dns/promises';

// ─── Fingerprint Types ─────────────────────────────────────────────────────

export interface BrowserFingerprint {
  /** User-Agent string */
  userAgent: string;
  /** Accept-Language header value */
  acceptLanguage: string;
  /** Viewport size for Playwright */
  viewport: { width: number; height: number };
  /** Browser platform family (used for Sec-Ch-Ua headers if needed) */
  platform: 'windows' | 'macos' | 'linux';
  /** Browser engine type */
  engine: 'chromium' | 'gecko' | 'webkit';
}

// ─── Fingerprint Pool ──────────────────────────────────────────────────────

const FINGERPRINTS: BrowserFingerprint[] = [
  // Chrome / Windows
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7',
    viewport: { width: 1920, height: 1080 },
    platform: 'windows',
    engine: 'chromium',
  },
  // Chrome / macOS
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
    viewport: { width: 1440, height: 900 },
    platform: 'macos',
    engine: 'chromium',
  },
  // Firefox / Windows
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    acceptLanguage: 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
    viewport: { width: 1366, height: 768 },
    platform: 'windows',
    engine: 'gecko',
  },
  // Firefox / macOS
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
    acceptLanguage: 'zh-CN,zh;q=0.8,en;q=0.6',
    viewport: { width: 1680, height: 1050 },
    platform: 'macos',
    engine: 'gecko',
  },
  // Edge / Windows
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7',
    viewport: { width: 1536, height: 864 },
    platform: 'windows',
    engine: 'chromium',
  },
  // Safari / macOS
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    acceptLanguage: 'zh-cn,zh;q=0.9,en;q=0.8',
    viewport: { width: 1440, height: 900 },
    platform: 'macos',
    engine: 'webkit',
  },
  // Chrome / Linux
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    acceptLanguage: 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    viewport: { width: 1920, height: 1080 },
    platform: 'linux',
    engine: 'chromium',
  },
  // Firefox / Linux
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    acceptLanguage: 'en-US,en;q=0.9,zh-CN;q=0.7',
    viewport: { width: 1366, height: 768 },
    platform: 'linux',
    engine: 'gecko',
  },
  // Chrome / Windows (different screen)
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    viewport: { width: 2560, height: 1440 },
    platform: 'windows',
    engine: 'chromium',
  },
  // Chrome / macOS (different screen)
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
    viewport: { width: 2560, height: 1600 },
    platform: 'macos',
    engine: 'chromium',
  },
  // Edge / macOS
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.7',
    viewport: { width: 1440, height: 900 },
    platform: 'macos',
    engine: 'chromium',
  },
  // Firefox / Windows (different version)
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
    viewport: { width: 1920, height: 1080 },
    platform: 'windows',
    engine: 'gecko',
  },
];

// ─── Fingerprint Rotation ──────────────────────────────────────────────────

let fpIndex = 0;

/** Get the next fingerprint in rotation (round-robin across all concurrent threads) */
export function getNextFingerprint(): BrowserFingerprint {
  const fp = FINGERPRINTS[fpIndex % FINGERPRINTS.length];
  fpIndex++;
  return fp;
}

/** Backward-compatible: get just the next User-Agent string */
export function getNextUserAgent(): string {
  return getNextFingerprint().userAgent;
}

// ─── Header Generation ─────────────────────────────────────────────────────

/**
 * Generate realistic browser request headers for a given fingerprint.
 * All requests for the same URL scan should use the same fingerprint
 * so they look like a single browser session.
 */
export function getBrowserHeaders(
  customHeaders?: Record<string, string>,
  fingerprint?: BrowserFingerprint,
): Record<string, string> {
  const fp = fingerprint || getNextFingerprint();

  const headers: Record<string, string> = {
    'User-Agent': fp.userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': fp.acceptLanguage,
    'Accept-Encoding': 'gzip, deflate, br',
    // NOTE: Intentionally NOT including Sec-* headers and Upgrade-Insecure-Requests
    // because many anti-bot systems detect them as non-browser traffic
    // when there's no actual browser behavior behind the request.
  };

  // Custom headers override defaults
  if (customHeaders) {
    for (const [key, value] of Object.entries(customHeaders)) {
      headers[key] = value;
    }
  }

  return headers;
}

/**
 * Generate headers for external resource fetches (JS/CSS), using the same
 * fingerprint as the main page request to maintain session consistency.
 */
export function getResourceHeaders(
  fingerprint: BrowserFingerprint,
  referer?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': fingerprint.userAgent,
    'Accept': '*/*',
    'Accept-Language': fingerprint.acceptLanguage,
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'script',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'cross-site',
    ...(referer ? { 'Referer': referer } : {}),
  };

  return headers;
}

// ─── SSRF Protection (inline) ──────────────────────────────────────────────
// Inline copy of validateResolvedIP from src/lib/security.ts for the mini-service
// which cannot import from the main src/ directory.

const PRIVATE_IP_RANGES_INLINE = [
  { start: 10 * 256 ** 3, end: 10 * 256 ** 3 + 255 * 256 ** 2 + 255 * 256 + 255 },
  { start: 172 * 256 ** 3 + 16 * 256 ** 2, end: 172 * 256 ** 3 + 31 * 256 ** 2 + 255 * 256 + 255 },
  { start: 192 * 256 ** 3 + 168 * 256 ** 2, end: 192 * 256 ** 3 + 168 * 256 ** 2 + 255 * 256 + 255 },
  { start: 127 * 256 ** 3, end: 127 * 256 ** 3 + 255 * 256 ** 2 + 255 * 256 + 255 },
  { start: 169 * 256 ** 3 + 254 * 256 ** 2, end: 169 * 256 ** 3 + 254 * 256 ** 2 + 255 * 256 + 255 },
  { start: 0, end: 255 * 256 ** 2 + 255 * 256 + 255 },
];

function ipToNumberInline(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPInline(ip: string): boolean {
  const num = ipToNumberInline(ip);
  return PRIVATE_IP_RANGES_INLINE.some(range => num >= range.start && num <= range.end);
}

function isValidIPInline(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (part.length > 1 && part.startsWith('0')) return false;
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return false;
    if (part !== String(num)) return false;
  }
  return true;
}

/** Validate a DNS-resolved IP — returns true if safe (public), false if private/reserved. */
function validateResolvedIPInline(ip: string): boolean {
  if (ip.includes(':')) {
    // IPv6: check loopback, unique-local, link-local
    if (ip === '::1') return false;
    if (/^f[cd]/i.test(ip)) return false;   // fc00::/7 unique-local
    if (/^fe[89ab]/i.test(ip)) return false; // fe80::/10 link-local
    // IPv4-mapped IPv6
    const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4Mapped) return !isPrivateIPInline(v4Mapped[1]);
    return true;
  }
  if (isValidIPInline(ip)) return !isPrivateIPInline(ip);
  return false;
}

// ─── Redirect Handling ─────────────────────────────────────────────────────

// Maximum number of redirects to follow
export const MAX_REDIRECTS = 10;

// Fetch with manual redirect handling to avoid infinite loops
// Now supports cookie persistence across redirects to handle anti-bot challenges
export async function fetchWithRedirectControl(
  url: string,
  options: RequestInit & { headers: Record<string, string> },
  maxRedirects: number = MAX_REDIRECTS
): Promise<{ response: Response; finalUrl: string; redirectCount: number }> {
  let currentUrl = url;
  let redirectCount = 0;
  const accumulatedCookies: string[] = [];

  // Helper to extract and merge cookies from a response
  const collectCookies = (response: Response) => {
    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    for (const sc of setCookieHeaders) {
      const cookiePart = sc.split(';')[0].trim();
      if (cookiePart) {
        const cookieName = cookiePart.split('=')[0];
        const existingIdx = accumulatedCookies.findIndex(c => c.split('=')[0] === cookieName);
        if (existingIdx >= 0) {
          accumulatedCookies[existingIdx] = cookiePart;
        } else {
          accumulatedCookies.push(cookiePart);
        }
      }
    }
  };

  // Create a new options object without the redirect property
  const fetchOpts = { ...options, redirect: 'manual' as const };

  while (redirectCount < maxRedirects) {
    // Build headers with accumulated cookies
    const requestHeaders: Record<string, string> = {
      ...fetchOpts.headers,
      // Update Referer for redirects
      ...(redirectCount > 0 ? { Referer: currentUrl } : {}),
    };

    // Include accumulated cookies
    if (accumulatedCookies.length > 0) {
      requestHeaders['Cookie'] = accumulatedCookies.join('; ');
    }

    const response = await fetch(currentUrl, {
      ...fetchOpts,
      headers: requestHeaders,
    });

    // Collect cookies from this response
    collectCookies(response);

    // Check if this is a redirect
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        // No location header, return the response as-is
        return { response, finalUrl: currentUrl, redirectCount };
      }

      // Resolve relative redirect URLs
      const redirectUrl = new URL(location, currentUrl).href;
      redirectCount++;

      // Log redirect
      console.debug(`Redirect ${redirectCount}: ${currentUrl} -> ${redirectUrl}`);

      // Check for redirect loops
      if (redirectUrl === currentUrl) {
        console.warn(`Redirect loop detected: ${currentUrl}`);
        return { response, finalUrl: currentUrl, redirectCount };
      }

      // SSRF protection: validate redirect target against private/reserved IPs
      // Prevents both DNS-rebinding attacks (hostname resolves to private IP) and
      // direct redirect to private IP URLs (e.g. http://192.168.1.1/admin)
      try {
        const redirectHost = new URL(redirectUrl).hostname;
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(redirectHost)) {
          // Redirect target hostname is already a literal IP — validate directly
          if (!validateResolvedIPInline(redirectHost)) {
            console.warn(`Redirect to private IP blocked: ${redirectHost}`);
            return { response, finalUrl: currentUrl, redirectCount };
          }
        } else {
          // Hostname — resolve via DNS and validate the resolved IP
          const { address } = await lookup(redirectHost);
          if (!validateResolvedIPInline(address)) {
            console.warn(`Redirect to private IP blocked: ${redirectHost} -> ${address}`);
            return { response, finalUrl: currentUrl, redirectCount };
          }
        }
      } catch {
        // DNS lookup failed — let it proceed, the fetch will fail on its own
      }

      // For 301/302/303, change method to GET (browser behavior)
      if ([301, 302, 303].includes(response.status)) {
        fetchOpts.method = 'GET';
        delete fetchOpts.body;
      }

      currentUrl = redirectUrl;
      continue;
    }

    // Not a redirect, return the response
    return { response, finalUrl: currentUrl, redirectCount };
  }

  // Max redirects exceeded - return last response by doing a follow
  console.warn(`Max redirects (${maxRedirects}) exceeded for ${url}`);
  const finalResponse = await fetch(currentUrl, { ...options, redirect: 'follow' });
  return { response: finalResponse, finalUrl: currentUrl, redirectCount };
}
