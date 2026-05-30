import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { URL } from 'url';
import { lookup } from 'dns/promises';
import { validateResolvedIP, validateScanUrl } from '@/lib/security';
import { getNextUserAgent } from '@/lib/scan-engine/browser-sim';
import { extractAllUrlsFromHtml } from '@/lib/scan-engine/html-parser';

const execFileAsync = promisify(execFile);

// Concurrency for sub-page crawling at each depth level
const CRAWL_CONCURRENCY = 3;
// Reduced concurrency for deep mining (depth >= 3) to avoid overwhelming servers
const CRAWL_CONCURRENCY_DEEP = 2;
// Max sub-pages to crawl per depth level (to prevent explosion)
const MAX_PAGES_PER_DEPTH = [0, 0, 15, 10, 8, 5]; // index=depth, 0=unused
// Total timeout for the entire sublink discovery request (60s for deep mining)
const REQUEST_TIMEOUT_MS = 60000;

// Resource extensions to skip — these are static assets, not crawlable pages
const RESOURCE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|avif|woff|woff2|ttf|eot|otf|mp4|mp3|wav|ogg|pdf|zip|rar|gz|css|js|xml|json)(\?|$)/i;

/**
 * POST /api/scan/sublinks
 * Discovers same-domain sub-links from the given URL with recursive depth support.
 *
 * Depth 1: Extract links from the source page only.
 * Depth 2: Also crawl discovered sub-pages and extract their links.
 * Depth 3-5: Recursively crawl newly discovered sub-pages for deeper links.
 *
 * Uses the full HTML parser (cheerio-based, 11 extraction methods covering 25+
 * tag/attribute pairs) for deep link extraction.
 *
 * Strict same-domain matching: hostname must match exactly.
 *
 * Request body: { url: string, maxDepth?: number (1-5), maxLinks?: number }
 * Response: { url: string, sublinks: string[], count: number, depth: number }
 */
export async function POST(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const body = await request.json();
    const { url, maxDepth = 1, maxLinks = 200 } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Clamp maxDepth to 1-5
    const clampedDepth = Math.max(1, Math.min(5, maxDepth));

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: 'Only HTTP/HTTPS URLs are supported' }, { status: 400 });
    }

    // SSRF validation: check URL against private IPs
    const urlValidation = validateScanUrl(url);
    if (!urlValidation.valid) {
      return NextResponse.json({ error: `URL blocked: ${urlValidation.reason}` }, { status: 403 });
    }

    // DNS rebinding check: resolve hostname and verify IP is not private
    const targetHostname = parsedUrl.hostname.toLowerCase();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(targetHostname)) {
      try {
        const { address: resolvedIp } = await lookup(targetHostname);
        if (!validateResolvedIP(resolvedIp)) {
          return NextResponse.json(
            { error: `DNS rebinding protection: resolved IP ${resolvedIp} is private/reserved` },
            { status: 403 }
          );
        }
      } catch {
        return NextResponse.json({ error: 'DNS resolution failed' }, { status: 400 });
      }
    }

    // ─── Depth 1: Fetch the source page and extract links ───
    const html = await fetchPageHtml(url);
    if (!html) {
      return NextResponse.json({ error: 'Failed to fetch the URL' }, { status: 502 });
    }

    const depth1Links = extractSameDomainLinks(html, targetHostname, url, maxLinks);
    const allLinks = new Set<string>(depth1Links);
    // Track which links we've already crawled to avoid re-crawling
    const crawledLinks = new Set<string>();

    // ─── Depth 2+: Recursively crawl discovered sub-pages ───
    // Links discovered at the previous depth that haven't been crawled yet
    let linksToCrawl = [...allLinks];

    for (let depth = 2; depth <= clampedDepth; depth++) {
      if (linksToCrawl.length === 0) break;
      if (allLinks.size >= maxLinks) break;
      if ((Date.now() - requestStart) > REQUEST_TIMEOUT_MS - 10000) break; // leave 10s buffer

      // Mark these links as crawled
      for (const link of linksToCrawl) {
        crawledLinks.add(link);
      }

      // Select a subset of links to crawl at this depth
      const maxPages = MAX_PAGES_PER_DEPTH[depth] || 5;
      const pagesToCrawl = selectPagesForDepth(linksToCrawl, maxPages);

      if (pagesToCrawl.length === 0) break;

      const remainingTime = REQUEST_TIMEOUT_MS - (Date.now() - requestStart) - 2000;
      if (remainingTime < 3000) break; // not enough time for another depth

      // Reduce concurrency for deep mining to avoid overwhelming servers
      const effectiveConcurrency = depth >= 3 ? CRAWL_CONCURRENCY_DEEP : CRAWL_CONCURRENCY;

      const depthResults = await crawlPagesConcurrently(
        pagesToCrawl,
        targetHostname,
        maxLinks - allLinks.size,
        remainingTime,
        effectiveConcurrency,
      );

      // Collect newly discovered links (not in allLinks already)
      const newLinks: string[] = [];
      for (const sublinks of depthResults) {
        for (const link of sublinks) {
          if (allLinks.size >= maxLinks) break;
          if (!allLinks.has(link)) {
            allLinks.add(link);
            newLinks.push(link);
          }
        }
        if (allLinks.size >= maxLinks) break;
      }

      // For the next depth iteration, crawl only the newly discovered links
      linksToCrawl = newLinks.filter(l => !crawledLinks.has(l));
    }

    // Don't include the original URL itself
    const normalizedSource = normalizeUrl(new URL(url));
    allLinks.delete(normalizedSource);

    return NextResponse.json({
      url,
      hostname: targetHostname,
      sublinks: [...allLinks],
      count: allLinks.size,
      depth: clampedDepth,
    });
  } catch (error) {
    console.error('Sublinks discovery error:', error);
    return NextResponse.json(
      { error: `Sublink discovery failed: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}

// ─── Helper: Fetch page HTML via curl with fetch fallback ───

async function fetchPageHtml(url: string, timeoutMs: number = 15000): Promise<string | null> {
  const MAX_RETRIES = 3;
  const BACKOFF_MS = [1000, 2000, 4000]; // Exponential backoff: 1s, 2s, 4s

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Try curl first
    try {
      const { stdout } = await execFileAsync('curl', [
        '-s', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000)), '--max-redirs', '5',
        '-A', getNextUserAgent(),
        '-w', '\n%{http_code}',
        url,
      ], { timeout: timeoutMs + 5000, maxBuffer: 5 * 1024 * 1024 });
      if (stdout && stdout.length > 0) {
        // Extract HTTP status code from the last line appended by -w
        const lines = stdout.split('\n');
        const statusCode = parseInt(lines[lines.length - 1], 10);
        const body = lines.slice(0, -1).join('\n');

        if (statusCode === 429 || (statusCode >= 500 && statusCode < 600)) {
          // Rate limit or server error — retry with backoff
          if (attempt < MAX_RETRIES) {
            const backoff = BACKOFF_MS[attempt] ?? 4000;
            await new Promise(r => setTimeout(r, backoff));
            continue;
          }
          // Exhausted retries for curl, try fetch fallback below
        } else if (body.length > 0) {
          return body;
        }
      }
    } catch {
      // curl failed, will retry or fall through to fetch
    }

    // Fallback to fetch
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': getNextUserAgent() },
        redirect: 'follow',
      });

      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        // Rate limit or server error — retry with backoff
        if (attempt < MAX_RETRIES) {
          const backoff = BACKOFF_MS[attempt] ?? 4000;
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        return null;
      }

      return await res.text();
    } catch {
      // Connection reset, timeout, etc. — retry with backoff
      if (attempt < MAX_RETRIES) {
        const backoff = BACKOFF_MS[attempt] ?? 4000;
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      return null;
    }
  }

  return null;
}

// ─── Helper: Select representative pages for crawling at each depth ───
// Prioritizes pages with unique path segments to maximize link diversity

function selectPagesForDepth(links: string[], maxPages: number): string[] {
  if (links.length <= maxPages) return links;

  // Group by first path segment to get diverse pages
  const byPathSegment = new Map<string, string[]>();
  for (const link of links) {
    try {
      const pathname = new URL(link).pathname;
      const segments = pathname.split('/').filter(Boolean);
      const key = segments.length > 0 ? segments[0] : '/';
      const list = byPathSegment.get(key);
      if (list) list.push(link);
      else byPathSegment.set(key, [link]);
    } catch {
      // skip invalid
    }
  }

  // Pick one from each group first, then fill remaining
  const selected: string[] = [];
  const used = new Set<string>();

  // First pass: one from each group
  for (const [, group] of byPathSegment) {
    if (selected.length >= maxPages) break;
    const pick = group[0];
    if (!used.has(pick)) {
      selected.push(pick);
      used.add(pick);
    }
  }

  // Second pass: fill remaining with more from each group
  for (const [, group] of byPathSegment) {
    if (selected.length >= maxPages) break;
    for (const link of group) {
      if (selected.length >= maxPages) break;
      if (!used.has(link)) {
        selected.push(link);
        used.add(link);
      }
    }
  }

  return selected;
}

// ─── Helper: Crawl multiple pages concurrently with concurrency control ───

async function crawlPagesConcurrently(
  pages: string[],
  targetHostname: string,
  maxLinksRemaining: number,
  timeoutMs: number,
  concurrency: number = CRAWL_CONCURRENCY,
): Promise<string[][]> {
  const results: string[][] = [];
  const executing = new Set<Promise<void>>();
  const deadline = Date.now() + timeoutMs;
  // Small delay between starting crawls to avoid overwhelming servers
  const CRAWL_START_DELAY_MS = 200;

  const crawlOne = async (pageUrl: string) => {
    if (Date.now() > deadline) return;

    const html = await fetchPageHtml(pageUrl, Math.min(10000, Math.max(3000, deadline - Date.now())));
    if (!html) return;

    const sublinks = extractSameDomainLinks(html, targetHostname, pageUrl, maxLinksRemaining);
    if (sublinks.length > 0) {
      results.push(sublinks);
    }
  };

  for (const pageUrl of pages) {
    if (Date.now() > deadline) break;

    // Add a small delay between starting each crawl to avoid overwhelming servers
    if (executing.size > 0) {
      await new Promise(r => setTimeout(r, CRAWL_START_DELAY_MS));
    }

    const p = crawlOne(pageUrl);
    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.allSettled([...executing]);
  return results;
}

/**
 * Extract same-domain links from HTML content.
 * Uses the full HTML parser (extractAllUrlsFromHtml) which leverages cheerio
 * and 11 extraction methods covering 25+ tag/attribute pairs.
 */
function extractSameDomainLinks(
  html: string,
  targetHostname: string,
  baseUrl: string,
  maxLinks: number,
): string[] {
  const links = new Set<string>();

  // Use the full HTML parser for deep extraction
  const allUrls = extractAllUrlsFromHtml(html, baseUrl);

  const normalizedBaseUrl = normalizeUrl(new URL(baseUrl));

  for (const entry of allUrls) {
    if (links.size >= maxLinks) break;

    try {
      const resolvedUrl = new URL(entry.url);

      // Strict same-domain check: hostname must match exactly
      if (resolvedUrl.hostname.toLowerCase() !== targetHostname) {
        continue;
      }

      // Skip common non-page resources (images, fonts, media, archives, CSS, JS, XML, JSON)
      const pathname = resolvedUrl.pathname.toLowerCase();
      if (RESOURCE_EXTENSIONS.test(pathname)) {
        continue;
      }

      // Normalize: remove fragment, sort params
      const normalizedUrl = normalizeUrl(resolvedUrl);

      // Don't include the original URL itself
      if (normalizedUrl === normalizedBaseUrl) continue;

      links.add(normalizedUrl);
    } catch {
      // Skip invalid URLs
      continue;
    }
  }

  return [...links];
}

/**
 * Normalize a URL for deduplication: remove fragment, sort params, remove trailing slash
 */
function normalizeUrl(url: URL): string {
  // Remove fragment
  url.hash = '';
  // Sort search params for consistency
  url.searchParams.sort();
  let normalized = url.toString();
  // Remove trailing slash (but keep root /)
  if (normalized.endsWith('/') && !normalized.endsWith('://') && url.pathname !== '/') {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
