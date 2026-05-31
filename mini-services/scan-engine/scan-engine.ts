import { parseHtml, extractImageUrls, extractExternalResources, extractUrlsFromJs, extractUrlsFromCssContent as extractUrlsFromCss, resolveUrl } from './html-parser';
import { detectQrCodes, detectQrCodesFromUrls, detectQrCodesFromDataUri } from './qr-detector';
import { getBrowserHeaders, getNextFingerprint, getResourceHeaders, fetchWithRedirectControl, MAX_REDIRECTS, type BrowserFingerprint } from './browser-sim';
import type { ScanRequest, ScanResultData, UrlConfig, ScanProgress, LogEntry, TaskStatus, UrlDetailData, DarkLinkData, QrCodeData } from './types';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { lookup } from 'dns/promises';

// ─── Inline DNS Cache ─────────────────────────────────────────────────────────
// DNS cache is inlined for mini-services independence
const dnsCache = new Map<string, { address: string; family: number; expiresAt: number }>();
const DNS_CACHE_TTL = 60_000; // 60 seconds

function cachedLookup(hostname: string): Promise<{ address: string; family: number }> {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() < cached.expiresAt) {
    return Promise.resolve({ address: cached.address, family: cached.family });
  }
  return lookup(hostname).then(result => {
    dnsCache.set(hostname, { ...result, expiresAt: Date.now() + DNS_CACHE_TTL });
    return result;
  });
}

function invalidateDnsCache(hostname: string): void {
  dnsCache.delete(hostname);
}

const execFileAsync = promisify(execFile);

// Active scan tasks
const activeTasks = new Map<string, AbortController>();

// Maximum JS/meta redirect follow attempts
const MAX_JS_REDIRECTS = 3;

// If the first fetch returns a redirect page, skip JS redirect loop and go straight to curl
// This avoids wasting time on anti-bot challenge loops
const PREFER_CURL_ON_FIRST_REDIRECT = true;

// Maximum external resources to fetch per type (increased from 15 for better coverage)
const MAX_EXTERNAL_JS = 20;
const MAX_EXTERNAL_CSS = 20;

// Concurrency for fetching external resources (increased from 8 for better throughput)
const EXTERNAL_FETCH_CONCURRENCY = 12;

// Maximum number of URL details and dark link details per result (memory optimization)
const MAX_URL_DETAILS = 200;
const MAX_DARK_LINK_DETAILS = 200;

// Maximum HTML size to store in session cache (200KB)
const MAX_HTML_CACHE_SIZE = 200 * 1024;

// Per-domain rate limiting: max concurrent requests to the same domain
const MAX_CONCURRENT_PER_DOMAIN = 4;

// Maximum retries for failed URLs (with lower priority)
const MAX_RETRY_ATTEMPTS = 1;

// Adaptive timeout thresholds
const FAST_RESPONSE_THRESHOLD = 3000;   // If page loads < 3s, reduce external timeout
const FAST_EXTERNAL_TIMEOUT = 8000;     // 8s timeout for external resources on fast sites

// Anti-bot markers commonly found in challenge/redirect pages
const ANTI_BOT_MARKERS = ['__jsl', 'challenge', 'cf-browser', 'cf-challenge', 'jschl', 'hcaptcha', 'recaptcha'];

// ─── Same-domain visibility-only dark link types ─────────────────────────────
// These types flag links that are hidden via CSS/visibility techniques.
// If the link points to the SAME domain as the scanned site, these are typically
// legitimate patterns (mobile menus, tab content, accordions, etc.) and should
// NOT be flagged as dark links. Only external-domain hidden links are suspicious.
const VISIBILITY_ONLY_DARK_LINK_TYPES = new Set([
  'css_hidden',
  'size_hidden',
  'position_hidden',
  'overflow_hidden',
  'color_hidden',
  'hidden_text',
  'hidden_div_link',
  'svg_hidden',
  'noscript_hidden',
]);

// Filter out same-domain dark links that are ONLY flagged for visibility reasons.
// Non-visibility types (malicious_keyword, js_injected, form_hijack, etc.) are
// still flagged even for same-domain links, as they indicate actual compromise.
function filterSameDomainVisibilityDarkLinks(
  darkLinks: DarkLinkData[],
  baseDomain: string | null,
): DarkLinkData[] {
  if (!baseDomain) return darkLinks;
  return darkLinks.filter(dl => {
    const dlDomain = extractDomain(dl.url);
    // If the link domain matches the base domain AND the type is visibility-only, filter it out
    if (dlDomain === baseDomain && VISIBILITY_ONLY_DARK_LINK_TYPES.has(dl.type)) {
      return false;
    }
    return true;
  });
}

// Use curl to fetch pages - curl has a browser-like TLS fingerprint
// which bypasses anti-bot systems that use TLS fingerprinting (JA3/JA4)
async function fetchWithCurl(
  url: string,
  timeout: number,
  extraHeaders?: Record<string, string>,
  userAgent?: string,
): Promise<{ html: string; statusCode: number; finalUrl: string }> {
  const ua = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const args: string[] = [
    '-s',               // Silent mode
    '-L',               // Follow redirects
    '--compressed',     // Handle compression
    '--max-time', String(Math.ceil(timeout / 1000)),
    // NOTE: Only set User-Agent - some anti-bot systems (like chinatelecom.com.cn)
    // trigger on Accept/Accept-Language headers from non-browser TLS fingerprints.
    // curl with just a UA header has a better chance of getting the real page.
    '-H', `User-Agent: ${ua}`,
  ];

  // Add extra headers
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      if (key.toLowerCase() !== 'user-agent' && key.toLowerCase() !== 'accept' && key.toLowerCase() !== 'accept-language') {
        args.push('-H', `${key}: ${value}`);
      }
    }
  }

  args.push(url);

  try {
    // Get HTML content
    console.log(`[CURL] Fetching: ${url}`);
    // Process timeout: ceil of curl --max-time (in seconds) converted back to ms,
    // plus 3s buffer for process startup/teardown overhead.
    const processTimeout = Math.ceil(timeout / 1000) * 1000 + 3000;
    const { stdout, stderr } = await execFileAsync('curl', args, {
      timeout: processTimeout,
      maxBuffer: 50 * 1024 * 1024, // 50MB max
    });
    console.log(`[CURL] Got response, length: ${stdout.length}`);

    if (stderr && stderr.trim().length > 0) {
      console.warn(`[CURL] stderr for ${url}: ${stderr.trim().substring(0, 200)}`);
    }

    // If stdout is empty but no error was thrown, curl may have returned
    // a non-zero exit code that execFileAsync didn't surface as an exception
    // (e.g., HTTP errors with --fail). Log a specific warning.
    if (!stdout || stdout.length === 0) {
      console.warn(`[CURL] Empty response for ${url} (stderr: ${stderr ? stderr.trim().substring(0, 150) : 'none'})`);
      return { html: '', statusCode: 0, finalUrl: url };
    }

    return { html: stdout, statusCode: 200, finalUrl: url };
  } catch (err: any) {
    // Differentiate between timeout and other curl failures
    const isTimeout = err.killed === true || err.signal === 'SIGTERM' ||
      (err.message && err.message.includes('timed out'));
    if (isTimeout) {
      console.error(`[CURL] Timed out after ${timeout}ms for ${url}`);
    } else {
      const stderrInfo = err.stderr ? ` (stderr: ${String(err.stderr).trim().substring(0, 150)})` : '';
      console.error(`[CURL] Failed for ${url}: ${err.message}${stderrInfo}`);
    }
    return { html: '', statusCode: 0, finalUrl: url };
  }
}

// =====================================================
// Session HTML Cache: LRU with 100 entries, 5 min TTL
// Avoids re-fetching the same URL during JS redirect hops
// =====================================================
class SessionHtmlCache {
  private cache = new Map<string, { html: string; timestamp: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = 100, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(url: string): string | null {
    const entry = this.cache.get(url);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(url);
      return null;
    }
    // Move to end (most recently used)
    this.cache.delete(url);
    this.cache.set(url, entry);
    return entry.html;
  }

  set(url: string, html: string): void {
    // Remove if exists (to move to end)
    this.cache.delete(url);
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    // Truncate HTML to prevent memory bloat (max 200KB per entry)
    const truncatedHtml = html.length > MAX_HTML_CACHE_SIZE
      ? html.substring(0, MAX_HTML_CACHE_SIZE) + `\n<!-- [TRUNCATED: original ${html.length} bytes, kept ${MAX_HTML_CACHE_SIZE}] -->`
      : html;
    this.cache.set(url, { html: truncatedHtml, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Check if HTML looks like an anti-bot challenge page (short page with known markers)
function isAntiBotChallengePage(html: string): boolean {
  if (html.length >= 500) return false; // Only check very short pages
  const lower = html.toLowerCase();
  return ANTI_BOT_MARKERS.some(marker => lower.includes(marker));
}

// Scan task management
export function stopTask(taskId: string): boolean {
  const controller = activeTasks.get(taskId);
  if (controller) {
    controller.abort();
    activeTasks.delete(taskId);
    return true;
  }
  return false;
}

export function isTaskRunning(taskId: string): boolean {
  return activeTasks.has(taskId);
}

// Extract JS/meta redirect URL from HTML
function extractJsRedirect(html: string): string | null {
  // window.open("url", "_self")
  const windowOpenMatch = html.match(/window\.open\s*\(\s*["']([^"']+)["']\s*,\s*["']_self["']/);
  if (windowOpenMatch) return windowOpenMatch[1];

  // window.location = "url" or window.location.href = "url"
  const windowLocationMatch = html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
  if (windowLocationMatch) return windowLocationMatch[1];

  // document.location = "url" or document.location.href = "url"
  const documentLocationMatch = html.match(/document\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
  if (documentLocationMatch) return documentLocationMatch[1];

  // self.location = "url" or self.location.href = "url"
  const selfLocationMatch = html.match(/\bself\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
  if (selfLocationMatch) return selfLocationMatch[1];

  // top.location = "url" or top.location.href = "url"
  const topLocationMatch = html.match(/\btop\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
  if (topLocationMatch) return topLocationMatch[1];

  // parent.location = "url" or parent.location.href = "url"
  const parentLocationMatch = html.match(/\bparent\.location(?:\.href)?\s*=\s*["']([^"']+)["']/);
  if (parentLocationMatch) return parentLocationMatch[1];

  // location.assign("url")
  const assignMatch = html.match(/(?:window\.)?location\.assign\s*\(\s*["']([^"']+)["']\s*\)/);
  if (assignMatch) return assignMatch[1];

  // location.replace("url") (with or without window prefix)
  const replaceMatch = html.match(/(?:window\.)?location\.replace\s*\(\s*["']([^"']+)["']\s*\)/);
  if (replaceMatch) return replaceMatch[1];

  // Meta refresh redirect
  const metaMatch = html.match(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["']?\d+;\s*url=([^"'\s>]+)/i);
  if (metaMatch) return metaMatch[1];

  return null;
}

// Check if HTML is a redirect page (small HTML with only a redirect script)
function isRedirectPage(html: string): boolean {
  // Strip whitespace and check if it's a small page with only redirect
  const stripped = html.replace(/\s+/g, ' ').trim();
  // More lenient threshold: some anti-bot pages are slightly larger (e.g., 2000 bytes)
  // but still essentially just redirect pages
  if (stripped.length > 3000) return false;

  // Check for common redirect patterns
  // Must have a redirect AND not have substantial content (like <body> with real text)
  const hasRedirectPattern = 
    (/window\.open\s*\(/.test(stripped) && /_self/.test(stripped)) ||
    /window\.location(?:\.href)?\s*=/.test(stripped) ||
    /window\.location\.(?:replace|assign)/.test(stripped) ||
    /document\.location(?:\.href)?\s*=/.test(stripped) ||
    /\bself\.location(?:\.href)?\s*=/.test(stripped) ||
    /\btop\.location(?:\.href)?\s*=/.test(stripped) ||
    /\bparent\.location(?:\.href)?\s*=/.test(stripped) ||
    /(?:window\.)?location\.(?:replace|assign)/.test(stripped);
  
  // If there's a redirect pattern but also substantial HTML content (long text, multiple tags),
  // it's probably a real page with some JS, not just a redirect page
  if (hasRedirectPattern) {
    // Check if the page has substantial visible content beyond the redirect script
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      const bodyContent = bodyMatch[1].replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').trim();
      // If there's substantial non-script body content, it's not just a redirect page
      if (bodyContent.length > 500) return false;
    }
    return true;
  }
  
  return false;
}

// Helper: extract cookies from a Response's Set-Cookie headers
function extractCookiesFromResponse(response: Response): string[] {
  const cookies: string[] = [];
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  for (const sc of setCookieHeaders) {
    // Only take the name=value part, before any attributes
    const cookiePart = sc.split(';')[0].trim();
    if (cookiePart) cookies.push(cookiePart);
  }
  return cookies;
}

// Helper: build a Cookie header string from accumulated cookies
function buildCookieHeader(cookies: string[]): string {
  return cookies.join('; ');
}

// Helper: check if a URL string is a data: URI
function isDataUri(url: string): boolean {
  return url.startsWith('data:');
}

// Helper: decode a data: URI to a Buffer
function decodeDataUri(dataUri: string): Buffer | null {
  try {
    // data:[<mediatype>][;base64],<data>
    const commaIdx = dataUri.indexOf(',');
    if (commaIdx === -1) return null;

    const meta = dataUri.substring(0, commaIdx);
    const data = dataUri.substring(commaIdx + 1);
    const isBase64 = meta.includes(';base64');

    if (isBase64) {
      return Buffer.from(data, 'base64');
    } else {
      return Buffer.from(decodeURIComponent(data), 'utf-8');
    }
  } catch {
    return null;
  }
}

// Helper: detect QR codes from data: URI images directly (no HTTP fetch)
async function detectQrFromDataUris(dataUris: string[]): Promise<QrCodeData[]> {
  const results: QrCodeData[] = [];

  for (const uri of dataUris) {
    try {
      // Use the proper data URI detector which handles base64 fallback for qrImageBase64
      const res = await detectQrCodesFromDataUri(uri, uri.slice(0, 80) + '...');
      results.push(...res);
    } catch {
      // Silently skip failed data URI decodes
    }
  }

  return results;
}

// Helper: analyze a list of URLs for dark link patterns (with domain-level dedup)
function analyzeUrlsForDarkLinks(
  urls: string[],
  baseUrl: string,
  tag: string,
  baseDomain: string | null,
  sourceFileUrl?: string
): { urlDetails: UrlDetailData[]; darkLinkDetails: DarkLinkData[] } {
  const urlDetails: UrlDetailData[] = [];
  const darkLinkDetails: DarkLinkData[] = [];
  const domainSeen = new Set<string>();

  // Group URLs by domain for dedup
  const domainMap = new Map<string, { urls: string[]; hasSuspiciousDomain: boolean }>();
  for (const url of urls) {
    const domain = extractDomain(url);
    if (!domain) continue;
    const existing = domainMap.get(domain);
    if (existing) {
      existing.urls.push(url);
    } else {
      domainMap.set(domain, {
        urls: [url],
        hasSuspiciousDomain: !!domain && !!baseDomain && isSuspiciousDomain(domain, baseDomain),
      });
    }
  }

  // Build one UrlDetailData per domain
  for (const [domain, info] of domainMap) {
    const isExternal = domain !== baseDomain;
    const representativeUrl = info.urls[0];

    urlDetails.push({
      url: representativeUrl,
      tag,
      isExternal,
      domain: domain || undefined,
      isVisible: true,
      urlCount: info.urls.length,
      sources: [tag],
      tags: [tag],
    });

    // Check for suspicious domain patterns
    if (isExternal && domain && baseDomain && info.hasSuspiciousDomain) {
      const dedupKey = `${domain}|suspicious_domain`;
      if (!domainSeen.has(dedupKey)) {
        domainSeen.add(dedupKey);
        darkLinkDetails.push({
          url: representativeUrl,
          tag,
          type: 'suspicious_domain',
          severity: 'medium',
          description: `${tag}中发现可疑域名引用: ${domain}`,
          evidence: `来源: 外部${tag}资源${sourceFileUrl ? `, 文件: ${sourceFileUrl}` : ''} (共${info.urls.length}个URL)`,
        });
      }
    }
  }

  return { urlDetails, darkLinkDetails };
}

// IPv4 regex
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
// IPv6 regex (simplified — matches bracketed and bare forms)
const IPV6_REGEX = /^\[?([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\]?$/;

// Helper: extract domain from URL with validation
// Returns null if the hostname is not a valid domain or IP address
function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    if (!isValidDomain(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

// Validate that a hostname is a meaningful domain (not single chars, punycode fragments, etc.)
function isValidDomain(hostname: string): boolean {
  if (!hostname || hostname.length === 0) return false;

  // Allow IPv4 addresses
  if (IPV4_REGEX.test(hostname)) return true;

  // Allow IPv6 addresses
  if (IPV6_REGEX.test(hostname)) return true;

  // Reject single-character hostnames (a, b, x, etc.)
  if (hostname.length < 3) return false;

  // Reject hostnames without a dot (no TLD)
  if (!hostname.includes('.')) {
    return hostname === 'localhost';
  }

  // Reject punycode-only hostnames without a valid TLD structure
  const parts = hostname.split('.');
  if (parts.length < 2) return false;

  // TLD must be at least 2 characters
  const tld = parts[parts.length - 1];
  if (tld.length < 2) return false;

  for (const part of parts) {
    if (part.length === 0) return false;
  }

  return true;
}

// IP address regex for dedup key extraction
const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

// Helper: extract a dedup key from URL/domain, consistent with frontend's extractDedupKey()
// For domains (non-IP), use the domain; for IPs or when domain is missing, extract hostname from URL
function extractDedupKey(url: string, domain?: string): string {
  if (domain && !IP_REGEX.test(domain)) return domain;
  try {
    return new URL(url).hostname;
  } catch {
    return domain || url;
  }
}

// Trusted CDN/Service domains - skip suspicious_domain detection for these
// Synced from src/lib/scan-engine/shared-constants.ts
const TRUSTED_DOMAINS_ENGINE = new Set([
  // Common CDNs
  'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com',
  'ajax.googleapis.com', 'cdnjs.cloudflare.com', 'cdn.bootcdn.net',
  'cdn.staticfile.org', 'unpkg.com', 'stackpath.bootstrapcdn.com',
  'code.jquery.com', 'maxcdn.bootstrapcdn.com',
  // Chinese CDNs
  'lib.baomitu.com', 'cdn.bytedance.com',
  'lf3-cdn-tos.bytecdntp.com', 'lf6-cdn-tos.bytecdntp.com',
  'lf9-cdn-tos.bytecdntp.com',
  // Analytics & Tag Managers
  'www.googletagmanager.com', 'www.google-analytics.com',
  'connect.facebook.net', 'analytics.tiktok.com',
  'hm.baidu.com', 'zz.bdstatic.com', 's19.cnzz.com', 'cnzz.com',
  'tongji.baidu.com', 'api.mapbox.com', 'cdn.ampproject.org',
  'plausible.io', 'matomo.org',
  'analytics.google.com', 'region1.google-analytics.com',
  'tagmanager.google.com', 'static.hotjar.com',
  'cdn.mxpnl.com', 'sentry.io', 'browser.sentry-cdn.com',
  // Social / Sharing
  'platform.twitter.com', 'apis.google.com',
  'static.addtoany.com', 'assets.pinterest.com',
  'sdn.geetest.com', 'api-share.facebook.com', 'www.facebook.com',
  'graph.facebook.com', 'syndication.twitter.com',
  // Common legit services on cheap TLDs
  'github.io', 'netlify.app', 'vercel.app', 'herokuapp.com',
  'pages.dev', 'surge.sh', 'gitlab.io', 'readthedocs.io',
  'cloudfront.net', 'amazonaws.com', 'azureedge.net',
  // Cloud services
  'azurewebsites.net', 'cloudapp.net', 'compute.amazonaws.com',
  'elasticbeanstalk.com', 'firebaseapp.com', 'firebaseio.com',
  'onrender.com', 'railway.app', 'fly.dev',
  'deno.dev', 'supabase.co', 'hasura.app',
  // Common services
  'cdn.sstatic.net', 'i.stack.imgur.com',
  'payments.stripe.com', 'js.stripe.com',
  'checkout.stripe.com', 'api.stripe.com',
  'js.braintreegateway.com', 'assets.braintreegateway.com',
  'www.paypal.com', 'api.paypal.com',
  'cdn.shopify.com', 'monorail-edge.shopifysvc.com',
]);

// Helper: check if a domain is suspicious relative to the base domain.
// Improved: uses Levenshtein distance, homoglyph detection, and deceptive pattern
// checks instead of the overly broad "different TLD/SLD" approach that caused
// massive false positives.
function isSuspiciousDomain(domain: string, baseDomain: string): boolean {
  // Skip trusted domains entirely
  if (TRUSTED_DOMAINS_ENGINE.has(domain)) return false;

  // Don't flag IP addresses
  if (IPV4_REGEX.test(domain) || IPV6_REGEX.test(domain)) return false;

  const baseParts = baseDomain.split('.');
  const domainParts = domain.split('.');

  if (baseParts.length < 2 || domainParts.length < 2) return false;

  const baseSld = baseParts.slice(-2)[0].toLowerCase();
  const domainSld = domainParts.slice(-2)[0].toLowerCase();
  const baseTld = baseParts.slice(-1)[0].toLowerCase();
  const domainTld = domainParts.slice(-1)[0].toLowerCase();

  // If the SLD is identical and TLD is the same, it's not suspicious
  if (baseSld === domainSld && baseTld === domainTld) return false;

  // ─── Check 1: Typosquatting (Levenshtein distance 1-2 + different TLD) ───
  if (baseTld !== domainTld) {
    const dist = levenshteinDistance(baseSld, domainSld);
    if (dist >= 1 && dist <= 2) return true;
  }

  // ─── Check 2: Homoglyph attacks ─────────────────────────────────────────
  const normalizedBaseSld = normalizeHomoglyphs(baseSld);
  const normalizedDomainSld = normalizeHomoglyphs(domainSld);
  if (normalizedBaseSld === normalizedDomainSld && baseSld !== domainSld) {
    return true;
  }

  // ─── Check 3: Deceptive patterns ────────────────────────────────────────
  const baseSldLower = baseSld.toLowerCase();

  // Hyphen deception: baseDomain-anything.tld (e.g., google-evil.com)
  if (domainSld.startsWith(baseSldLower + '-') || domainSld.startsWith(baseSldLower + '_')) {
    return true;
  }

  // Subdomain deception: baseDomain.evil.tld (e.g., google.evil.com)
  if (domainParts.length > 2) {
    const subdomainParts = domainParts.slice(0, -2);
    for (const part of subdomainParts) {
      if (part.toLowerCase() === baseSldLower) return true;
    }
  }

  return false;
}

// Compute Levenshtein distance between two strings
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const curr = new Array(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    prev = curr;
  }
  return prev[n];
}

// Homoglyph groups for lookalike character detection
const HOMOGLYPH_GROUPS: string[][] = [
  ['0', 'o', 'ο'],
  ['1', 'l', 'i', '|'],
  ['rn', 'm'],
  ['vv', 'w'],
  ['5', 's'],
  ['9', 'g'],
  ['cl', 'd'],
  ['nn', 'm'],
];

function normalizeHomoglyphs(s: string): string {
  let result = s;
  for (const group of HOMOGLYPH_GROUPS) {
    const canonical = group[0];
    for (let i = 1; i < group.length; i++) {
      result = result.split(group[i]).join(canonical);
    }
  }
  return result;
}

// Validate that a resolved IP address is not private/reserved (DNS rebinding protection)
// Supports both IPv4 and IPv6 private ranges
function validateResolvedIP(ip: string): boolean {
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

  // ── IPv4 handling ──
  if (isPrivateIP(ip)) return false;

  // If the format is unrecognized, reject conservatively
  return true;
}

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

  // fe80::/10 — link-local (first 10 bits = 1111111010 → first byte 0xfe, second byte & 0xc0 == 0x00)
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
    const v4Part = v4MappedMatch[1];
    const octets = v4Part.split('.').map(Number);
    return [0, 0, 0, 0, 0, 0xffff, (octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
  }

  const halves = ip.split('::');
  const result: number[] = new Array(8).fill(0);

  if (halves.length === 1) {
    const parts = ip.split(':').map(p => (p ? parseInt(p, 16) : 0));
    for (let i = 0; i < Math.min(parts.length, 8); i++) {
      result[i] = parts[i];
    }
  } else {
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

// Fetch a single external resource with timeout and error handling
// NOTE: External resource URLs (JS/CSS) are extracted from scanned page HTML.
// They also pose a DNS rebinding SSRF risk. A pre-fetch DNS check is applied
// below; the same TOCTOU limitation applies as documented in processUrlInner.
async function fetchExternalResource(
  url: string,
  timeout: number,
  abortSignal: AbortSignal,
  referer?: string,
  fingerprint?: BrowserFingerprint
): Promise<{ text: string; ok: boolean; status?: number } | null> {
  if (abortSignal.aborted) return null;

  // ─── DNS rebinding check for external resource URLs ──
  try {
    const extHostname = new URL(url).hostname;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(extHostname)) {
      const { address: resolvedIp } = await cachedLookup(extHostname);
      if (!validateResolvedIP(resolvedIp)) {
        invalidateDnsCache(extHostname);
        return null; // Silently block — don't fetch private IPs
      }
    }
  } catch {
    // DNS lookup failed or invalid URL — skip and let fetch handle it
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Also abort if the parent task is aborted
    const onParentAbort = () => controller.abort();
    abortSignal.addEventListener('abort', onParentAbort, { once: true });

    const headers: Record<string, string> = fingerprint
      ? getResourceHeaders(fingerprint, referer)
      : {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Sec-Fetch-Dest': 'script',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': referer ? 'same-origin' : 'cross-site',
          ...(referer ? { 'Referer': referer } : {}),
        };

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);
    abortSignal.removeEventListener('abort', onParentAbort);

    if (!response.ok) {
      return { text: '', ok: false, status: response.status };
    }

    const text = await response.text();
    return { text, ok: true, status: response.status };
  } catch {
    return null;
  }
}

// Fetch multiple external resources with concurrency control
async function fetchExternalResources(
  urls: string[],
  timeout: number,
  abortSignal: AbortSignal,
  concurrency: number,
  referer?: string,
  fingerprint?: BrowserFingerprint
): Promise<Array<{ url: string; text: string }>> {
  const results: Array<{ url: string; text: string }> = [];
  const executing = new Set<Promise<void>>();

  for (const url of urls) {
    if (abortSignal.aborted) break;

    const p = fetchExternalResource(url, timeout, abortSignal, referer, fingerprint).then((result) => {
      if (result && result.ok && result.text) {
        results.push({ url, text: result.text });
      }
    });

    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.allSettled([...executing]);
  return results;
}

// Helper: compute adaptive parameters based on page response time
// Continuous scaling — faster sites get more thorough analysis, slower sites get leaner scans
function getAdaptiveParams(responseTime: number, defaultTimeout: number): {
  externalTimeout: number;
  maxExternalJs: number;
  maxExternalCss: number;
} {
  // Scale factor: 1.0 for fast sites (<3s), linearly down to 0.3 for very slow sites (>18s)
  const scaleFactor = Math.max(0.3, Math.min(1.0, 1.0 - (responseTime - 3000) / 15000));

  const maxExternalJs = Math.max(5, Math.round(MAX_EXTERNAL_JS * scaleFactor));
  const maxExternalCss = Math.max(5, Math.round(MAX_EXTERNAL_CSS * scaleFactor));

  // Scale external timeout: fast sites get shorter timeout, slow sites keep full timeout
  const externalTimeout = responseTime < FAST_RESPONSE_THRESHOLD
    ? FAST_EXTERNAL_TIMEOUT
    : Math.round(defaultTimeout * Math.max(0.5, scaleFactor));

  return { externalTimeout, maxExternalJs, maxExternalCss };
}

// Helper: process external resource results and add to result
function processExternalResults(
  results: Array<{ url: string; text: string }>,
  baseUrl: string,
  baseDomain: string | null,
  tag: string,
  abortSignal: AbortSignal,
  result: ScanResultData,
  extractUrls: (text: string, baseUrl: string) => string[],
  emitLog: (level: LogEntry['level'], message: string, detail?: string) => void,
): number {
  let totalExtracted = 0;
  for (const { url: resUrl, text } of results) {
    if (abortSignal.aborted) break;

    const extractedUrls = extractUrls(text, baseUrl);
    totalExtracted += extractedUrls.length;

    if (extractedUrls.length > 0) {
      emitLog('debug', `${tag}文件提取URL: ${resUrl}`, `提取 ${extractedUrls.length} 个URL`);

      const analysis = analyzeUrlsForDarkLinks(extractedUrls, baseUrl, tag, baseDomain, resUrl);
      result.urlDetails.push(...analysis.urlDetails);
      result.darkLinkDetails.push(...analysis.darkLinkDetails);
    }
  }
  return totalExtracted;
}

// ─── Result streaming helper: enforce limits and emit early ──────────────
function trimResultArrays(result: ScanResultData): void {
  if (result.urlDetails.length > MAX_URL_DETAILS) {
    const overflow = result.urlDetails.length - MAX_URL_DETAILS;
    result.urlDetails = result.urlDetails.slice(0, MAX_URL_DETAILS);
    result.urlDetails.push({
      url: `[还有 ${overflow} 个URL详情未显示]`,
      tag: 'overflow',
      isExternal: false,
      domain: undefined,
      isVisible: true,
      urlCount: overflow,
      sources: ['overflow'],
      tags: ['overflow'],
    });
  }
  if (result.darkLinkDetails.length > MAX_DARK_LINK_DETAILS) {
    const overflow = result.darkLinkDetails.length - MAX_DARK_LINK_DETAILS;
    result.darkLinkDetails = result.darkLinkDetails.slice(0, MAX_DARK_LINK_DETAILS);
    result.darkLinkDetails.push({
      url: `[还有 ${overflow} 个暗链详情未显示]`,
      tag: 'overflow',
      type: 'malicious_keyword',
      severity: 'low',
      description: `检测结果过多，已截断显示。共 ${overflow} 个暗链详情未显示`,
      evidence: `overflow_count=${overflow}`,
    });
  }
}

// ─── Shared post-fetch HTML analysis ────────────────────────────────────────
// Extracted from the duplicated code in the normal path and curl fallback path.
// Handles: HTML parsing, external resource fetching, domain dedup, image URL
// collection, QR code detection, and memory trimming.
async function analyzeHtmlResult(params: {
  html: string;
  baseUrl: string;
  baseDomain: string | null;
  result: ScanResultData;
  timeout: number;
  abortController: AbortController;
  fingerprint: BrowserFingerprint;
  disabledRules: string[];
  emitLog: (level: LogEntry['level'], message: string, detail?: string) => void;
  sourceUrl: string;
}): Promise<void> {
  const { html, baseUrl, baseDomain, result, timeout, abortController, fingerprint, disabledRules, emitLog, sourceUrl } = params;

  // Parse HTML
  const parsed = parseHtml(html, baseUrl, disabledRules);
  result.title = parsed.title;
  result.urlDetails = parsed.urlDetails;
  result.darkLinkDetails = parsed.darkLinkDetails;

  emitLog('info', `HTML解析完成: ${sourceUrl}`, `提取 ${parsed.urlDetails.length} 个URL, 发现 ${parsed.darkLinkDetails.length} 个疑似暗链`);

  // Compute adaptive parameters
  const adaptive = getAdaptiveParams(result.responseTime || 0, timeout);

  // Deep scan: External JS/CSS analysis - fetch ALL resources in parallel
  const { jsUrls, cssUrls } = extractExternalResources(html, baseUrl);
  emitLog('info', `发现外部资源: ${sourceUrl}`, `JS: ${jsUrls.length} 个, CSS: ${cssUrls.length} 个, 自适应超时: ${adaptive.externalTimeout}ms`);

  const jsToFetch = jsUrls.slice(0, adaptive.maxExternalJs);
  const cssToFetch = cssUrls.slice(0, adaptive.maxExternalCss);

  const allResourceUrls: Array<{ url: string; type: 'js' | 'css' }> = [
    ...jsToFetch.map(u => ({ url: u, type: 'js' as const })),
    ...cssToFetch.map(u => ({ url: u, type: 'css' as const })),
  ];

  const hasExternalResources = allResourceUrls.length > 0;
  const [resourceResults, imageExtractionResult] = await Promise.all([
    hasExternalResources
      ? fetchExternalResources(
          allResourceUrls.map(r => r.url),
          adaptive.externalTimeout,
          abortController.signal,
          EXTERNAL_FETCH_CONCURRENCY,
          baseUrl,
          fingerprint
        )
      : Promise.resolve([] as Array<{ url: string; text: string }>),
    Promise.resolve(extractImageUrls(html, baseUrl)),
  ]);

  const jsUrlSet = new Set(jsToFetch);
  const jsResults = resourceResults.filter(r => jsUrlSet.has(r.url));
  const cssResults = resourceResults.filter(r => !jsUrlSet.has(r.url));

  if (jsResults.length > 0) {
    emitLog('info', `成功获取 ${jsResults.length}/${jsToFetch.length} 个JS文件: ${sourceUrl}`);
    const totalJsUrls = processExternalResults(jsResults, baseUrl, baseDomain, 'external-js', abortController.signal, result, extractUrlsFromJs, emitLog);
    emitLog('info', `外部JS分析完成: ${sourceUrl}`, `共提取 ${totalJsUrls} 个URL (来自 ${jsResults.length} 个JS文件)`);
  }

  if (cssResults.length > 0) {
    emitLog('info', `成功获取 ${cssResults.length}/${cssToFetch.length} 个CSS文件: ${sourceUrl}`);
    const totalCssUrls = processExternalResults(cssResults, baseUrl, baseDomain, 'external-css', abortController.signal, result, extractUrlsFromCss, emitLog);
    emitLog('info', `外部CSS分析完成: ${sourceUrl}`, `共提取 ${totalCssUrls} 个URL (来自 ${cssResults.length} 个CSS文件)`);
  }

  // Cross-source domain dedup
  const finalDomainMap = new Map<string, UrlDetailData>();
  const finalDarkLinks: DarkLinkData[] = [];
  const darkLinkDedup = new Set<string>();

  for (const detail of result.urlDetails) {
    const domain = extractDedupKey(detail.url, detail.domain);
    const existing = finalDomainMap.get(domain);
    if (existing) {
      existing.urlCount = (existing.urlCount || 1) + (detail.urlCount || 1);
      if (detail.sources) {
        const merged = new Set([...(existing.sources || []), ...detail.sources]);
        existing.sources = [...merged];
      }
      if (detail.tags) {
        const merged = new Set([...(existing.tags || []), ...detail.tags]);
        existing.tags = [...merged];
      }
      if (detail.isVisible) existing.isVisible = true;
    } else {
      finalDomainMap.set(domain, { ...detail, domain });
    }
  }

  for (const dl of result.darkLinkDetails) {
    const dlDomain = extractDomain(dl.url);
    const dedupKey = `${dlDomain}|${dl.type}`;
    if (!darkLinkDedup.has(dedupKey)) {
      darkLinkDedup.add(dedupKey);
      finalDarkLinks.push(dl);
    }
  }

  result.urlDetails = [...finalDomainMap.values()];
  result.darkLinkDetails = filterSameDomainVisibilityDarkLinks(finalDarkLinks, baseDomain);
  result.extractedUrls = result.urlDetails.reduce((sum, d) => sum + (d.urlCount || 1), 0);
  result.darkLinks = result.darkLinkDetails.length;

  emitLog('info', `深度扫描完成: ${sourceUrl}`, `总计 ${result.extractedUrls} 个URL, ${result.darkLinks} 个疑似暗链`);

  // Image URL Collection & QR Code Detection
  const htmlImageUrls = imageExtractionResult;
  const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico|avif)(\?|$)/i;
  const QR_IMAGE_PATTERNS = /\/(qr|qrcode|weixin|weibo|wechat|code|ewm|barcode|scan)/i;
  const IMAGE_DIR_PATTERNS = /\/(image|img|photo|picture|pic|upload|static|assets|resource|media|content|data|files|cdn|qrcode|qr-code)/i;
  const externalImageUrls: string[] = [];
  for (const { url: resUrl, text: resourceText } of resourceResults) {
    const urls = extractUrlsFromJs(resourceText, baseUrl);
    for (const u of urls) {
      if (IMAGE_EXTENSIONS.test(u) || QR_IMAGE_PATTERNS.test(u) || IMAGE_DIR_PATTERNS.test(u)) {
        if (!htmlImageUrls.includes(u) && !externalImageUrls.includes(u)) {
          externalImageUrls.push(u);
        }
      }
    }
    const rawImgPatterns = [
      /["'](data:image\/[^"']+)["']/gi,
      /["']([^"']*(?:qr|qrcode|wechat|weixin|ewm|barcode|code|scan)[^']*\.(?:png|jpg|jpeg|gif|webp|svg))["']/gi,
      /["']([^"']*(?:\/api\/qr|\/api\/qrcode|\/api\/code|\/generate[_-]?qr|\/create[_-]?qr)[^"']*)["']/gi,
      /(?:src|href|url|image|img|icon|banner|poster)\s*[=:]\s*["']([^"']+\.(?:png|jpg|jpeg|gif|webp|svg))["']/gi,
    ];
    for (const pattern of rawImgPatterns) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(resourceText)) !== null) {
        const imgUrl = m[1];
        if (imgUrl && !htmlImageUrls.includes(imgUrl) && !externalImageUrls.includes(imgUrl)) {
          const resolved = imgUrl.startsWith('data:') ? imgUrl : (resolveUrl(imgUrl, baseUrl) || imgUrl);
          if (!htmlImageUrls.includes(resolved) && !externalImageUrls.includes(resolved)) {
            externalImageUrls.push(resolved);
          }
        }
      }
    }
  }

  const inlineScriptImages: string[] = [];
  const inlineScriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = inlineScriptRegex.exec(html)) !== null) {
    const scriptContent = scriptMatch[1];
    if (!scriptContent || scriptContent.length < 10) continue;
    const scriptUrls = extractUrlsFromJs(scriptContent, baseUrl);
    for (const u of scriptUrls) {
      if ((IMAGE_EXTENSIONS.test(u) || QR_IMAGE_PATTERNS.test(u) || IMAGE_DIR_PATTERNS.test(u)) && !htmlImageUrls.includes(u) && !externalImageUrls.includes(u) && !inlineScriptImages.includes(u)) {
        inlineScriptImages.push(u);
      }
    }
  }

  const allImageUrls = [...htmlImageUrls, ...externalImageUrls, ...inlineScriptImages];
  emitLog('info', `发现 ${allImageUrls.length} 个图片URL (HTML: ${htmlImageUrls.length}, 外部资源: ${externalImageUrls.length}, 内联脚本: ${inlineScriptImages.length}): ${sourceUrl}`);

  if (!disabledRules.includes('qr_code') && allImageUrls.length > 0) {
    const dataUris = allImageUrls.filter(u => isDataUri(u));
    const httpImageUrls = allImageUrls.filter(u => !isDataUri(u));

    emitLog('info', `QR码检测: ${httpImageUrls.length} 个HTTP图片, ${dataUris.length} 个data URI: ${sourceUrl}`);

    if (dataUris.length > 0) {
      try {
        const dataUriQrResults = await detectQrFromDataUris(dataUris);
        result.qrCodeDetails.push(...dataUriQrResults);
        if (dataUriQrResults.length > 0) {
          emitLog('info', `data URI中发现 ${dataUriQrResults.length} 个QR码: ${sourceUrl}`, dataUriQrResults.map(q => q.decodedText).join(', '));
        }
      } catch (err) {
        emitLog('warn', `data URI QR码检测失败: ${sourceUrl}`, String(err));
      }
    }

    if (httpImageUrls.length > 0) {
      try {
        const qrResults = await detectQrCodesFromUrls(httpImageUrls, adaptive.externalTimeout, baseUrl);
        result.qrCodeDetails.push(...qrResults);
        if (qrResults.length > 0) {
          emitLog('info', `HTTP图片中发现 ${qrResults.length} 个QR码: ${sourceUrl}`, qrResults.map(q => q.decodedText).join(', '));
        }
      } catch (err) {
        emitLog('warn', `HTTP图片QR码检测失败: ${sourceUrl}`, String(err));
      }
    }

    result.qrCodes = result.qrCodeDetails.length;
    emitLog('info', `QR码检测完成: ${sourceUrl}`, `共发现 ${result.qrCodes} 个QR码`);
  }

  // Apply memory limits before finalizing
  trimResultArrays(result);

  // Update rawHtml with the final HTML
  result.rawHtml = html.length > MAX_HTML_CACHE_SIZE
    ? html.substring(0, MAX_HTML_CACHE_SIZE) + `\n<!-- [TRUNCATED: original ${html.length} bytes] -->`
    : html;
}

// Main scan execution
export async function executeScan(
  taskId: string,
  request: ScanRequest,
  onProgress: (progress: ScanProgress) => void,
  onResult: (result: ScanResultData) => void,
  onLog: (log: LogEntry) => void
): Promise<void> {
  const { urls, concurrency = 10, timeout = 15000, disabledRules = [] } = request;
  const abortController = new AbortController();
  activeTasks.set(taskId, abortController);

  // Session HTML cache for this scan task
  const htmlCache = new SessionHtmlCache();

  let completedUrls = 0;
  const countedUrls = new Set<string>();
  const totalUrls = urls.length;
  const scanStartTime = Date.now();
  let totalDarkLinks = 0;
  let currentUrlStartTime: number | undefined;

  const emitProgress = (currentUrl?: string) => {
    // Only count each URL once, even if retried
    if (currentUrl && !countedUrls.has(currentUrl)) {
      countedUrls.add(currentUrl);
      completedUrls++;
    }
    const elapsed = Date.now() - scanStartTime;
    const avgTimePerUrl = completedUrls > 0 ? Math.round(elapsed / completedUrls) : undefined;
    const remaining = totalUrls - completedUrls;
    const estimatedTimeRemaining = (avgTimePerUrl && remaining > 0) ? avgTimePerUrl * remaining : undefined;
    const progress: ScanProgress = {
      taskId,
      totalUrls,
      completedUrls,
      progress: Math.round((completedUrls / totalUrls) * 100),
      status: abortController.signal.aborted ? 'stopped' : 'running',
      currentUrl,
      currentUrlStartTime,
      avgTimePerUrl,
      estimatedTimeRemaining,
      darkLinksFound: totalDarkLinks > 0 ? totalDarkLinks : undefined,
    };
    onProgress(progress);
  };

  const emitLog = (level: LogEntry['level'], message: string, detail?: string) => {
    onLog({ level, message, detail, timestamp: new Date() });
  };

  // ─── Smart Concurrency: Pre-sort URLs by expected response time ─────────
  // Heuristic: shorter domain names and simpler paths tend to respond faster.
  // Sort by (domain length + path depth) ascending for faster early feedback.
  const sortedUrls = [...urls].sort((a, b) => {
    const scoreA = a.url.length + (a.url.split('/').length - 3);
    const scoreB = b.url.length + (b.url.split('/').length - 3);
    return scoreA - scoreB;
  });

  // ─── Per-Domain Rate Limiter ─────────────────────────────────────────────
  class DomainRateLimiter {
    private active = new Map<string, number>();
    // Queue of waiting acquire() promises per domain, resolved when a slot opens
    private queues = new Map<string, Array<() => void>>();

    async acquire(url: string): Promise<void> {
      const domain = extractDomain(url) || url;
      const current = this.active.get(domain) || 0;
      if (current < MAX_CONCURRENT_PER_DOMAIN) {
        this.active.set(domain, current + 1);
        return;
      }
      // All slots taken — wait in the domain's queue for a slot to open
      return new Promise<void>((resolve) => {
        const queue = this.queues.get(domain);
        if (queue) {
          queue.push(resolve);
        } else {
          this.queues.set(domain, [resolve]);
        }
      });
    }

    release(url: string): void {
      const domain = extractDomain(url) || url;
      const queue = this.queues.get(domain);
      if (queue && queue.length > 0) {
        // Transfer the slot directly to the next waiter (no decrement needed)
        const next = queue.shift()!;
        if (queue.length === 0) {
          this.queues.delete(domain);
        }
        next();
      } else {
        // No waiters — free the slot
        const current = this.active.get(domain) || 0;
        if (current <= 1) {
          this.active.delete(domain);
        } else {
          this.active.set(domain, current - 1);
        }
      }
    }
  }

  const domainLimiter = new DomainRateLimiter();

  // Track failed URLs for retry with lower priority
  const failedUrls: UrlConfig[] = [];
  let isRetryPhase = false;



  emitLog('info', `开始扫描任务: ${taskId}`, `共 ${totalUrls} 个URL, 并发数: ${concurrency}, 超时: ${timeout}ms`);
  onProgress({
    taskId,
    totalUrls,
    completedUrls: 0,
    progress: 0,
    status: 'running',
    avgTimePerUrl: undefined,
    estimatedTimeRemaining: undefined,
    darkLinksFound: 0,
  });

  // Process URLs with concurrency control
  const processUrl = async (urlConfig: UrlConfig): Promise<ScanResultData> => {
    // Acquire per-domain rate limit slot
    await domainLimiter.acquire(urlConfig.url);
    try {
      return await processUrlInner(urlConfig);
    } finally {
      domainLimiter.release(urlConfig.url);
    }
  };

  const processUrlInner = async (urlConfig: UrlConfig): Promise<ScanResultData> => {
    if (abortController.signal.aborted) {
      return {
        url: urlConfig.url,
        method: urlConfig.method || 'GET',
        status: 'error',
        errorMessage: '任务已停止',
        extractedUrls: 0,
        darkLinks: 0,
        qrCodes: 0,
        urlDetails: [],
        darkLinkDetails: [],
        qrCodeDetails: [],
      };
    }

    // Assign a consistent fingerprint for this URL scan
    const fingerprint = getNextFingerprint();

    currentUrlStartTime = Date.now();
    const startTime = Date.now();
    const result: ScanResultData = {
      url: urlConfig.url,
      method: urlConfig.method || 'GET',
      status: 'running',
      extractedUrls: 0,
      darkLinks: 0,
      qrCodes: 0,
      urlDetails: [],
      darkLinkDetails: [],
      qrCodeDetails: [],
    };

    try {
      emitLog('info', `正在扫描: ${urlConfig.url}`, `方法: ${urlConfig.method || 'GET'}`);

      // ─── DNS Rebinding SSRF Mitigation ─────────────────────────────────
      // Same check as the main scan-engine: resolve the hostname and verify
      // the IP is not private/reserved before making the fetch.
      try {
        const urlHostname = new URL(urlConfig.url).hostname;
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(urlHostname)) {
          const { address: resolvedIp } = await cachedLookup(urlHostname);
          if (!validateResolvedIP(resolvedIp)) {
            invalidateDnsCache(urlHostname);
            result.status = 'error';
            result.errorMessage = `DNS rebinding protection: resolved IP ${resolvedIp} is private/reserved`;
            emitLog('warn', `DNS解析IP为私有地址，已阻止: ${urlConfig.url}`, `解析IP: ${resolvedIp}`);
            emitProgress(urlConfig.url);
            onResult(result);
            return result;
          }
          emitLog('debug', `DNS解析通过: ${urlHostname} → ${resolvedIp}`);
        }
      } catch (dnsErr) {
        emitLog('debug', `DNS预解析失败(将尝试直接请求): ${urlConfig.url}`, (dnsErr as Error).message);
      }

      // Make HTTP request with realistic browser headers
      const fetchController = new AbortController();
      const timeoutId = setTimeout(() => fetchController.abort(), timeout);

      // Also listen for task abort
      const onTaskAbort = () => fetchController.abort();
      abortController.signal.addEventListener('abort', onTaskAbort);

      // Build headers with browser simulation
      const browserHeaders = getBrowserHeaders(urlConfig.headers, fingerprint);

      const fetchOptions: RequestInit & { headers: Record<string, string> } = {
        method: urlConfig.method || 'GET',
        signal: fetchController.signal,
        headers: browserHeaders,
      };

      if (urlConfig.body && ['POST', 'PUT', 'PATCH'].includes(urlConfig.method || '')) {
        fetchOptions.body = urlConfig.body;
      }

      // Use redirect-controlled fetch to handle HTTP redirects
      let response: Response;
      let finalUrl = urlConfig.url;
      let redirectCount = 0;

      try {
        const fetchResult = await fetchWithRedirectControl(urlConfig.url, fetchOptions);
        response = fetchResult.response;
        finalUrl = fetchResult.finalUrl;
        redirectCount = fetchResult.redirectCount;

        clearTimeout(timeoutId);
        abortController.signal.removeEventListener('abort', onTaskAbort);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        abortController.signal.removeEventListener('abort', onTaskAbort);

        // Fallback: try simple fetch with redirect follow
        if ((fetchError as Error).name === 'AbortError') {
          throw fetchError;
        }

        emitLog('warn', `手动重定向失败，尝试简单请求: ${urlConfig.url}`, (fetchError as Error).message);

        const fallbackController = new AbortController();
        const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), timeout);
        const onFallbackAbort = () => fallbackController.abort();
        abortController.signal.addEventListener('abort', onFallbackAbort);

        try {
          response = await fetch(urlConfig.url, {
            ...fetchOptions,
            signal: fallbackController.signal,
            redirect: 'follow',
          });
          finalUrl = urlConfig.url;
        } catch (fallbackError) {
          clearTimeout(fallbackTimeoutId);
          abortController.signal.removeEventListener('abort', onTaskAbort);

          // FINAL FALLBACK: Use curl when both fetch methods fail
          // This handles TLS fingerprinting-based anti-bot systems (JA3/JA4)
          // that reject Node.js fetch but allow curl's browser-like TLS fingerprint
          if ((fallbackError as Error).name !== 'AbortError' && !abortController.signal.aborted) {
            emitLog('info', `简单请求也失败，尝试curl回退: ${urlConfig.url}`);
            try {
              const curlResult = await fetchWithCurl(urlConfig.url, timeout, urlConfig.headers, fingerprint.userAgent);
              const curlResult = await fetchWithCurl(urlConfig.url, timeout, urlConfig.headers, fingerprint.userAgent);
              if (curlResult.html && curlResult.html.length > 0) {
                // Create a synthetic response from curl result
                result.statusCode = curlResult.statusCode;
                result.responseTime = Date.now() - startTime;
                finalUrl = curlResult.finalUrl;

                emitLog('info', `curl回退获取成功: ${urlConfig.url}`, `HTML长度: ${curlResult.html.length}`);

                // Use shared analysis helper (includes HTML parsing, external resources,
                // domain dedup, QR detection, trimResultArrays, and rawHtml)
                const baseUrl = finalUrl !== urlConfig.url ? finalUrl : urlConfig.url;
                const baseDomain = extractDomain(baseUrl);

                await analyzeHtmlResult({
                  html: curlResult.html,
                  baseUrl,
                  baseDomain,
                  result,
                  timeout,
                  abortController,
                  fingerprint,
                  disabledRules,
                  emitLog,
                  sourceUrl: urlConfig.url,
                });

                result.status = 'completed';
                emitProgress(urlConfig.url);
                onResult(result);
                return result;
              } else {
                throw fetchError; // curl also failed, throw original error
              }
            } catch (curlErr) {
              emitLog('warn', `curl回退也失败: ${urlConfig.url}`, (curlErr as Error).message);
              throw fetchError; // throw original fetch error
            }
          }
          throw fallbackError;
        } finally {
          clearTimeout(fallbackTimeoutId);
          abortController.signal.removeEventListener('abort', onTaskAbort);
          abortController.signal.removeEventListener('abort', onFallbackAbort);
        }
      }

      result.statusCode = response.status;
      result.responseTime = Date.now() - startTime;

      if (redirectCount > 0) {
        emitLog('info', `HTTP重定向 ${redirectCount} 次: ${urlConfig.url} -> ${finalUrl}`);
      }

      if (!response.ok && response.status >= 400) {
        result.status = 'error';
        result.errorMessage = `HTTP ${response.status} ${response.statusText}`;
        emitLog('warn', `HTTP错误 ${response.status}: ${urlConfig.url}`);
        emitProgress(urlConfig.url);
        onResult(result);
        return result;
      }

      const contentType = response.headers.get('content-type') || '';

      // Accept HTML, XHTML, and also plain text (which might be a redirect page)
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml') && !contentType.includes('text/plain') && !contentType.includes('text/javascript')) {
        result.status = 'completed';
        result.title = '(非HTML页面)';
        emitLog('info', `跳过非HTML页面: ${urlConfig.url}`, `Content-Type: ${contentType}`);
        emitProgress(urlConfig.url);
        onResult(result);
        return result;
      }

      let html = await response.text();

      // Store raw HTML for source code preview (truncate to 200KB)
      result.rawHtml = html.length > MAX_HTML_CACHE_SIZE
        ? html.substring(0, MAX_HTML_CACHE_SIZE) + `\n<!-- [TRUNCATED: original ${html.length} bytes] -->`
        : html;

      // Collect cookies from the initial response for subsequent requests
      const accumulatedCookies: string[] = extractCookiesFromResponse(response);

      // =====================================================
      // FAST CURL FALLBACK: Anti-bot challenge detection
      // If the initial page is very short (<500 chars) and contains
      // known anti-bot markers, immediately try curl without wasting
      // time on JS redirect following
      // =====================================================
      if (isAntiBotChallengePage(html)) {
        emitLog('info', `检测到反爬虫挑战页面(短页面含反爬标记)，快速回退curl: ${urlConfig.url}`, `HTML长度: ${html.length}`);
        try {
          const curlResult = await fetchWithCurl(urlConfig.url, timeout, urlConfig.headers, fingerprint.userAgent);
          if (curlResult.html && curlResult.html.length > 1000 && !isRedirectPage(curlResult.html)) {
            html = curlResult.html;
            finalUrl = curlResult.finalUrl;
            result.statusCode = curlResult.statusCode;
            result.responseTime = Date.now() - startTime;
            emitLog('info', `curl快速回退成功: ${urlConfig.url}`, `HTML长度: ${html.length}`);
          } else {
            emitLog('warn', `curl快速回退未获得真实页面，继续正常流程: ${urlConfig.url}`);
          }
        } catch (curlErr) {
          emitLog('warn', `curl快速回退失败: ${urlConfig.url}`, (curlErr as Error).message);
        }
      }

      // Handle JavaScript/Meta redirects
      // Some websites (like chinatelecom.com.cn) use JS redirects as anti-bot protection
      // Key fix: carry cookies from previous responses to break redirect loops
      let jsRedirectAttempts = 0;
      let isFirstRedirect = isRedirectPage(html);

      // Cache the initial HTML
      htmlCache.set(finalUrl, html);

      // If the very first response is a redirect page, it's likely an anti-bot challenge.
      // Skip the JS redirect loop and try curl directly — curl has a browser-like TLS
      // fingerprint which bypasses most JA3/JA4-based anti-bot systems.
      if (isFirstRedirect && PREFER_CURL_ON_FIRST_REDIRECT) {
        emitLog('info', `首次响应为重定向页面(可能为反爬虫)，直接使用curl获取: ${urlConfig.url}`);
        try {
          const curlResult = await fetchWithCurl(urlConfig.url, timeout, urlConfig.headers, fingerprint.userAgent);
          if (curlResult.html && curlResult.html.length > 1000 && !isRedirectPage(curlResult.html)) {
            html = curlResult.html;
            finalUrl = curlResult.finalUrl;
            result.statusCode = curlResult.statusCode;
            emitLog('info', `curl直接获取成功: ${urlConfig.url}`, `HTML长度: ${html.length}`);
            isFirstRedirect = false; // We got the real page, skip JS redirect loop
            htmlCache.set(finalUrl, html);
          } else {
            emitLog('warn', `curl直接获取未获得真实页面，将尝试JS重定向跟随: ${urlConfig.url}`);
          }
        } catch (curlErr) {
          emitLog('warn', `curl直接获取失败，将尝试JS重定向跟随: ${urlConfig.url}`, (curlErr as Error).message);
        }
      }

      // Standard JS redirect loop (only if curl didn't already succeed)
      while (isRedirectPage(html) && jsRedirectAttempts < MAX_JS_REDIRECTS) {
        const redirectUrl = extractJsRedirect(html);
        if (!redirectUrl) break;

        jsRedirectAttempts++;
        const resolvedUrl = new URL(redirectUrl, finalUrl).href;

        // Self-redirect detection: if the redirect URL is the same as the current URL, break
        if (resolvedUrl === finalUrl || resolvedUrl === urlConfig.url) {
          emitLog('warn', `检测到自重定向循环，停止跟随: ${finalUrl}`);
          break;
        }

        emitLog('info', `发现JS/Meta重定向 (${jsRedirectAttempts}): ${finalUrl} -> ${resolvedUrl}`);

        // Check session cache first to avoid re-fetching
        const cachedHtml = htmlCache.get(resolvedUrl);
        if (cachedHtml) {
          emitLog('info', `使用缓存HTML(重定向跳): ${resolvedUrl}`);
          html = cachedHtml;
          finalUrl = resolvedUrl;
          if (html.length > 1000 && !isRedirectPage(html)) {
            emitLog('info', `缓存命中真实页面: ${resolvedUrl}`, `HTML长度: ${html.length}`);
            break;
          }
          continue;
        }

        try {
          const jsHeaders = getBrowserHeaders(urlConfig.headers, fingerprint);
          jsHeaders['Referer'] = finalUrl;

          // CRITICAL: Include accumulated cookies to break anti-bot redirect loops
          if (accumulatedCookies.length > 0) {
            jsHeaders['Cookie'] = buildCookieHeader(accumulatedCookies);
          }

          const jsResponse = await fetch(resolvedUrl, {
            method: 'GET',
            headers: jsHeaders,
            signal: AbortSignal.timeout(timeout),
            redirect: 'manual',
          });

          // Collect cookies from this response too
          const newCookies = extractCookiesFromResponse(jsResponse);
          for (const c of newCookies) {
            // Update existing cookie or add new one
            const cookieName = c.split('=')[0];
            const existingIdx = accumulatedCookies.findIndex(ec => ec.split('=')[0] === cookieName);
            if (existingIdx >= 0) {
              accumulatedCookies[existingIdx] = c;
            } else {
              accumulatedCookies.push(c);
            }
          }

          // Handle HTTP-level redirects from the JS redirect target
          if (jsResponse.status >= 300 && jsResponse.status < 400) {
            const location = jsResponse.headers.get('location');
            if (location) {
              const httpRedirectUrl = new URL(location, resolvedUrl).href;
              emitLog('info', `JS重定向目标返回HTTP重定向: ${resolvedUrl} -> ${httpRedirectUrl}`);

              const httpRedirectHeaders = getBrowserHeaders(urlConfig.headers, fingerprint);
              httpRedirectHeaders['Referer'] = resolvedUrl;
              if (accumulatedCookies.length > 0) {
                httpRedirectHeaders['Cookie'] = buildCookieHeader(accumulatedCookies);
              }

              const httpRedirectResponse = await fetch(httpRedirectUrl, {
                method: 'GET',
                headers: httpRedirectHeaders,
                signal: AbortSignal.timeout(timeout),
                redirect: 'manual',
              });

              // Collect more cookies
              const moreCookies = extractCookiesFromResponse(httpRedirectResponse);
              for (const c of moreCookies) {
                const cookieName = c.split('=')[0];
                const existingIdx = accumulatedCookies.findIndex(ec => ec.split('=')[0] === cookieName);
                if (existingIdx >= 0) {
                  accumulatedCookies[existingIdx] = c;
                } else {
                  accumulatedCookies.push(c);
                }
              }

              result.statusCode = httpRedirectResponse.status;
              finalUrl = httpRedirectUrl;
              html = await httpRedirectResponse.text();
              htmlCache.set(finalUrl, html);
            }
          } else {
            result.statusCode = jsResponse.status;
            finalUrl = resolvedUrl;
            html = await jsResponse.text();
            htmlCache.set(finalUrl, html);
          }

          // Check if we got the real page
          if (html.length > 1000 && !isRedirectPage(html)) {
            emitLog('info', `JS重定向跟随成功，获得真实页面: ${resolvedUrl}`, `HTML长度: ${html.length}`);
            break;
          }
        } catch (jsErr) {
          emitLog('warn', `JS重定向跟随失败: ${resolvedUrl}`, (jsErr as Error).message);
          break;
        }
      }

      if (jsRedirectAttempts > 0 && isRedirectPage(html)) {
        emitLog('warn', `JS重定向循环，尝试curl回退获取真实页面: ${urlConfig.url}`, `尝试 ${jsRedirectAttempts} 次`);

        // FALLBACK: Use curl to fetch the page
        // curl has a browser-like TLS fingerprint which bypasses JA3/JA4-based anti-bot
        try {
          const curlResult = await fetchWithCurl(urlConfig.url, timeout, urlConfig.headers, fingerprint.userAgent);
          if (curlResult.html && curlResult.html.length > 1000 && !isRedirectPage(curlResult.html)) {
            html = curlResult.html;
            finalUrl = curlResult.finalUrl;
            result.statusCode = curlResult.statusCode;
            emitLog('info', `curl回退成功，获得真实页面: ${urlConfig.url}`, `HTML长度: ${html.length}`);
            htmlCache.set(finalUrl, html);
          } else {
            emitLog('warn', `curl回退也未能获取真实页面: ${urlConfig.url}`, `HTML长度: ${curlResult.html?.length || 0}`);
          }
        } catch (curlErr) {
          emitLog('warn', `curl回退失败: ${urlConfig.url}`, (curlErr as Error).message);
        }
      }

      // Parse HTML & deep scan - use shared analysis helper
      // This handles: HTML parsing, external resource fetching, domain dedup,
      // image URL collection, QR code detection, memory trimming,
      // and rawHtml storage.
      const baseUrl = finalUrl !== urlConfig.url ? finalUrl : urlConfig.url;
      const baseDomain = extractDomain(baseUrl);

      await analyzeHtmlResult({
        html,
        baseUrl,
        baseDomain,
        result,
        timeout,
        abortController,
        fingerprint,
        disabledRules,
        emitLog,
        sourceUrl: urlConfig.url,
      });

      result.status = 'completed';

      // Summary log with source breakdown
      const jsUrlCount = result.urlDetails.filter(u => u.tag === 'external-js').length;
      const cssUrlCount = result.urlDetails.filter(u => u.tag === 'external-css').length;
      emitLog('info', `扫描完成: ${urlConfig.url}`, [
        `耗时: ${result.responseTime}ms`,
        `JS重定向: ${jsRedirectAttempts}次`,
        `JS URL: ${jsUrlCount}`,
        `CSS URL: ${cssUrlCount}`,
        `总计URL: ${result.extractedUrls}`,
        `暗链: ${result.darkLinks}`,
        `QR码: ${result.qrCodes}`,
      ].join(', '));
    } catch (error) {
      result.status = 'error';
      result.responseTime = Date.now() - startTime;
      if (abortController.signal.aborted) {
        result.errorMessage = '任务已停止';
      } else if ((error as Error).name === 'AbortError') {
        result.errorMessage = '请求超时';
      } else {
        result.errorMessage = (error as Error).message;
      }
      emitLog('error', `扫描失败: ${urlConfig.url}`, result.errorMessage);
      // Track failed URL for retry - only in the initial scan phase
      if (MAX_RETRY_ATTEMPTS > 0 && !abortController.signal.aborted && !isRetryPhase) {
        failedUrls.push(urlConfig);
        // Don't emit progress OR result for URLs that will be retried;
        // both will be emitted when the retry completes.
        // This prevents duplicate results (error + retry) for the same URL.
        return result;
      }
    }

    // Stream result as soon as each URL is processed
    // (emitProgress already called inside catch for non-retry failures)
    // (success paths call emitProgress inside processUrlInner before returning)
    emitProgress(urlConfig.url);
    totalDarkLinks += result.darkLinks;
    onResult(result);
    return result;
  };

  // Execute with proper concurrency control using a semaphore pattern
  const executing = new Set<Promise<void>>();

  // Process pre-sorted URLs with smart concurrency
  for (const urlConfig of sortedUrls) {
    if (abortController.signal.aborted) break;

    const p = processUrl(urlConfig).then(() => {});
    executing.add(p);

    // Remove from set when done
    p.finally(() => executing.delete(p));

    // Wait for a slot if at capacity
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  // Wait for remaining
  await Promise.allSettled([...executing]);

  // Retry failed URLs with lower priority (if any)
  isRetryPhase = true;
  if (failedUrls.length > 0 && !abortController.signal.aborted && MAX_RETRY_ATTEMPTS > 0) {
    emitLog('info', `重试 ${failedUrls.length} 个失败URL`, failedUrls.map(u => u.url).join(', '));
    const retryExecuting = new Set<Promise<void>>();
    const retryConcurrency = Math.max(1, Math.floor(concurrency / 2)); // Lower concurrency for retries
    for (const urlConfig of failedUrls) {
      if (abortController.signal.aborted) break;
      const p = processUrl(urlConfig).then(() => {});
      retryExecuting.add(p);
      p.finally(() => retryExecuting.delete(p));
      if (retryExecuting.size >= retryConcurrency) {
        await Promise.race(retryExecuting);
      }
    }
    await Promise.allSettled([...retryExecuting]);
  }

  // Cleanup: clear the session HTML cache and remove the active task entry
  // Use try/finally to ensure cleanup even if an error occurs above
  try {
    // Ensure completedUrls reflects unique URLs counted (not retries)
    completedUrls = countedUrls.size;
    const finalStatus: TaskStatus = abortController.signal.aborted ? 'stopped' : 'completed';
    const elapsed = Date.now() - scanStartTime;
    const avgTimePerUrl = completedUrls > 0 ? Math.round(elapsed / completedUrls) : undefined;
    onProgress({
      taskId,
      totalUrls,
      completedUrls,
      progress: finalStatus === 'completed' ? 100 : Math.round((completedUrls / totalUrls) * 100),
      status: finalStatus,
      currentUrlStartTime: undefined,
      avgTimePerUrl,
      estimatedTimeRemaining: 0,
      darkLinksFound: totalDarkLinks,
      completedAt: Date.now(),
    });

    emitLog('info', `扫描任务${finalStatus === 'completed' ? '完成' : '已停止'}: ${taskId}`);
  } finally {
    htmlCache.clear();
    activeTasks.delete(taskId);
  }
}
