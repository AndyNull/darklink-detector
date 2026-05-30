import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSessionAuth } from '@/lib/api-auth';
import { decrypt } from '@/lib/crypto-server';
import { isValidIP } from '@/lib/security';
import { filterSafeDomains, filterSafeIPs, filterSafeEntries } from '@/lib/safe-domain-whitelist';
import { auditLog } from '@/lib/audit-logger';
import * as fflate from 'fflate';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ─── Types ────────────────────────────────────────────────────────────────────────

interface CollectorResult {
  sourceId: string;
  domains: number;
  ips: number;
  entries: number;
  totalDomains?: number;
  totalIps?: number;
  totalEntries?: number;
  skipped?: boolean;
  error?: string;
}

interface SourceCache {
  etag?: string;
  lastModified?: string;
  lastFetchTime: number;
}

// ─── State ────────────────────────────────────────────────────────────────────────

const updateTasks = new Map<string, { status: string; startedAt: number; completedAt?: number; error?: string; results?: CollectorResult[] }>();

// Source-level HTTP cache for If-Modified-Since / ETag support
const sourceHttpCache = new Map<string, SourceCache>();

// Rate limiting between sources (default: 500ms)
const SOURCE_DELAY_MS = 500;

// ─── Concurrency Helper ────────────────────────────────────────────────────────────

/**
 * Run async tasks with a controlled concurrency limit.
 * Returns all results as PromiseSettledResult<T>[], preserving order.
 */
async function parallelWithLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number = 3
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  const executing: Promise<void>[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const taskIndex = i;
    const p = tasks[taskIndex]().then(
      (value) => { results[taskIndex] = { status: 'fulfilled', value }; },
      (reason) => { results[taskIndex] = { status: 'rejected', reason }; }
    );
    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove completed promises from the executing list
      for (let j = executing.length - 1; j >= 0; j--) {
        // Check if promise is settled by racing with an already-resolved promise
        const settled = await Promise.race([executing[j].then(() => true, () => true), Promise.resolve(false)]);
        if (settled) {
          executing.splice(j, 1);
        }
      }
    }
  }
  await Promise.all(executing);
  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

function isIP(value: string): boolean {
  return IP_REGEX.test(value);
}

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.hostname;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch a CSV export URL that may return a ZIP file.
 * Detects ZIP by magic bytes (PK header) and decompresses using fflate.
 * Returns the extracted CSV text content.
 */
async function fetchCsvPossiblyZipped(url: string, retries = 2, timeoutMs = 120000): Promise<string> {
  const resp = await fetchWithRetry(url, retries, timeoutMs);
  const arrayBuffer = await resp.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  // Check for ZIP magic bytes: PK (0x50, 0x4B)
  if (uint8.length >= 2 && uint8[0] === 0x50 && uint8[1] === 0x4B) {
    console.log(`  Response is a ZIP file (${uint8.length} bytes), decompressing...`);
    try {
      const decompressed = fflate.unzipSync(uint8);
      // Find the first .csv file in the archive
      const csvFileName = Object.keys(decompressed).find(k => k.toLowerCase().endsWith('.csv'));
      if (csvFileName) {
        const csvText = new TextDecoder().decode(decompressed[csvFileName]);
        console.log(`  Extracted ${csvFileName} from ZIP (${csvText.length} chars)`);
        return csvText;
      }
      // If no .csv file found, try the first file
      const firstFile = Object.keys(decompressed)[0];
      if (firstFile) {
        const text = new TextDecoder().decode(decompressed[firstFile]);
        console.log(`  Extracted ${firstFile} from ZIP (${text.length} chars)`);
        return text;
      }
      throw new Error('No files found in ZIP archive');
    } catch (zipErr: any) {
      console.log(`  ZIP decompression failed: ${zipErr.message}, treating as plain text`);
      // Fallback: treat as plain text
      return new TextDecoder().decode(uint8);
    }
  }

  // Not a ZIP — return as plain text
  return new TextDecoder().decode(uint8);
}

/**
 * Parse a CSV line that may use quoted fields with embedded commas.
 * Splits on commas but respects double-quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

async function fetchWithRetry(
  url: string,
  retries = 3,
  timeoutMs = 60000,
  headers?: Record<string, string>,
  followRedirects = true
): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers,
        redirect: followRedirects ? 'follow' : 'manual',
      });
      clearTimeout(timer);
      // Handle manual redirect following
      if (!followRedirects && (resp.status === 301 || resp.status === 302 || resp.status === 307 || resp.status === 308)) {
        const location = resp.headers.get('location');
        if (location) {
          return fetchWithRetry(location, retries - i, timeoutMs, headers, true);
        }
      }
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}`);
      }
      return resp;
    } catch (err: any) {
      lastError = err;
      console.log(`  Retry ${i + 1}/${retries} for ${url}: ${err.message}`);
      if (i < retries - 1) {
        await delay(2000 * (i + 1));
      }
    }
  }
  throw lastError!;
}

/**
 * Fetch with If-Modified-Since / ETag support.
 * Returns null if the data hasn't been modified (304).
 */
async function fetchWithConditional(
  sourceId: string,
  url: string,
  retries = 3,
  timeoutMs = 60000
): Promise<{ response: Response; notModified: boolean }> {
  const cache = sourceHttpCache.get(sourceId);
  const headers: Record<string, string> = {};

  if (cache?.etag) {
    headers['If-None-Match'] = cache.etag;
  }
  if (cache?.lastModified) {
    headers['If-Modified-Since'] = cache.lastModified;
  }

  try {
    const resp = await fetchWithRetry(url, retries, timeoutMs, Object.keys(headers).length > 0 ? headers : undefined);

    // Store ETag / Last-Modified from response
    const etag = resp.headers.get('etag');
    const lastModified = resp.headers.get('last-modified');
    if (etag || lastModified) {
      sourceHttpCache.set(sourceId, {
        etag: etag || undefined,
        lastModified: lastModified || undefined,
        lastFetchTime: Date.now(),
      });
    }

    return { response: resp, notModified: false };
  } catch (err: any) {
    // If we get a 304, the data hasn't changed
    if (err.message?.includes('HTTP 304')) {
      return { response: null as any, notModified: true };
    }
    throw err;
  }
}

// ─── Batch DB Import ───────────────────────────────────────────────────────────────

async function batchImportDomains(
  domains: { domain: string; reason: string | null; source: string; severity: string; category: string | null }[]
): Promise<number> {
  if (domains.length === 0) return 0;

  // Filter out safe domains (github.com, w3.org, etc.) before importing
  const filteredDomains = filterSafeDomains(domains);
  const safeFilteredCount = domains.length - filteredDomains.length;
  if (safeFilteredCount > 0) {
    console.log(`  [batchImportDomains] Filtered out ${safeFilteredCount} safe domain(s) (e.g., github.com, w3.org, google.com)`);
  }
  if (filteredDomains.length === 0) return 0;

  const BATCH_SIZE = 500;
  const startTime = Date.now();

  // Split into batches
  const batches: typeof filteredDomains[] = [];
  for (let i = 0; i < filteredDomains.length; i += BATCH_SIZE) {
    batches.push(filteredDomains.slice(i, i + BATCH_SIZE));
  }

  console.log(`  [batchImportDomains] ${filteredDomains.length} domains (after filtering ${safeFilteredCount} safe) in ${batches.length} batches (parallel, max 3 concurrent)`);

  // Process batches with concurrency limit of 3
  const settledResults = await parallelWithLimit(
    batches.map((batch) => async () => {
      // Pre-check: find existing domains
      const existing = await db.maliciousDomain.findMany({
        where: { domain: { in: batch.map(d => d.domain) } },
        select: { domain: true },
      });
      const existingSet = new Set(existing.map(d => d.domain));
      const newItems = batch.filter(d => !existingSet.has(d.domain));
      if (newItems.length === 0) return 0;
      try {
        const result = await db.maliciousDomain.createMany({ data: newItems });
        return result.count;
      } catch {
        // Fallback to individual creates (only count actual creates)
        let count = 0;
        for (const entry of newItems) {
          try {
            await db.maliciousDomain.create({ data: entry });
            count++;
          } catch {
            // skip duplicates
          }
        }
        return count;
      }
    }),
    3 // max 3 concurrent batch writes
  );

  let added = 0;
  for (const r of settledResults) {
    if (r.status === 'fulfilled') added += r.value;
  }
  const elapsed = Date.now() - startTime;
  console.log(`  [batchImportDomains] Added ${added} domains in ${elapsed}ms`);
  return added;
}

async function batchImportIPs(
  ips: { ip: string; reason: string | null; source: string; severity: string; category: string | null; country?: string | null }[]
): Promise<number> {
  if (ips.length === 0) return 0;

  // Filter out safe IPs (private/reserved ranges) before importing
  const filteredIPs = filterSafeIPs(ips);
  const safeFilteredCount = ips.length - filteredIPs.length;
  if (safeFilteredCount > 0) {
    console.log(`  [batchImportIPs] Filtered out ${safeFilteredCount} safe/private IP(s)`);
  }
  if (filteredIPs.length === 0) return 0;

  const BATCH_SIZE = 500;
  const startTime = Date.now();

  // Split into batches
  const batches: typeof filteredIPs[] = [];
  for (let i = 0; i < filteredIPs.length; i += BATCH_SIZE) {
    batches.push(filteredIPs.slice(i, i + BATCH_SIZE));
  }

  console.log(`  [batchImportIPs] ${filteredIPs.length} IPs (after filtering ${safeFilteredCount} safe) in ${batches.length} batches (parallel, max 3 concurrent)`);

  // Process batches with concurrency limit of 3
  const settledResults = await parallelWithLimit(
    batches.map((batch) => async () => {
      // Pre-check: find existing IPs
      const existing = await db.maliciousIP.findMany({
        where: { ip: { in: batch.map(d => d.ip) } },
        select: { ip: true },
      });
      const existingSet = new Set(existing.map(d => d.ip));
      const newItems = batch.filter(d => !existingSet.has(d.ip));
      if (newItems.length === 0) return 0;
      try {
        const result = await db.maliciousIP.createMany({ data: newItems });
        return result.count;
      } catch {
        // Fallback to individual creates (only count actual creates)
        let count = 0;
        for (const entry of newItems) {
          try {
            await db.maliciousIP.create({ data: entry });
            count++;
          } catch {
            // skip duplicates
          }
        }
        return count;
      }
    }),
    3 // max 3 concurrent batch writes
  );

  let added = 0;
  for (const r of settledResults) {
    if (r.status === 'fulfilled') added += r.value;
  }
  const elapsed = Date.now() - startTime;
  console.log(`  [batchImportIPs] Added ${added} IPs in ${elapsed}ms`);
  return added;
}

async function batchImportThreatIntelEntries(
  entries: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[]
): Promise<number> {
  if (entries.length === 0) return 0;

  // Filter out safe domains/IPs from threat intel entries
  const filteredEntries = filterSafeEntries(entries);
  const safeFilteredCount = entries.length - filteredEntries.length;
  if (safeFilteredCount > 0) {
    console.log(`  [batchImportThreatIntelEntries] Filtered out ${safeFilteredCount} safe entry/entries`);
  }
  if (filteredEntries.length === 0) return 0;

  const BATCH_SIZE = 500;
  const startTime = Date.now();

  // Split into batches
  const batches: typeof filteredEntries[] = [];
  for (let i = 0; i < filteredEntries.length; i += BATCH_SIZE) {
    batches.push(filteredEntries.slice(i, i + BATCH_SIZE));
  }

  console.log(`  [batchImportThreatIntelEntries] ${filteredEntries.length} entries (after filtering ${safeFilteredCount} safe) in ${batches.length} batches (parallel, max 3 concurrent)`);

  // Process batches with concurrency limit of 3
  const settledResults = await parallelWithLimit(
    batches.map((batch) => async () => {
      // Pre-check: find existing entries (unique constraint: @@unique([sourceId, type, value]))
      const existing = await db.threatIntelEntry.findMany({
        where: {
          OR: batch.map(e => ({ sourceId: e.sourceId, type: e.type, value: e.value })),
        },
        select: { sourceId: true, type: true, value: true },
      });
      const existingKeys = new Set(existing.map(e => `${e.sourceId}|${e.type}|${e.value}`));
      const newItems = batch.filter(e => !existingKeys.has(`${e.sourceId}|${e.type}|${e.value}`));
      if (newItems.length === 0) return 0;
      try {
        const result = await db.threatIntelEntry.createMany({ data: newItems });
        return result.count;
      } catch {
        // Fallback to individual creates
        let count = 0;
        for (const entry of newItems) {
          try {
            await db.threatIntelEntry.create({ data: entry });
            count++;
          } catch {
            // skip duplicates
          }
        }
        return count;
      }
    }),
    3 // max 3 concurrent batch writes
  );

  let added = 0;
  for (const r of settledResults) {
    if (r.status === 'fulfilled') added += r.value;
  }
  const elapsed = Date.now() - startTime;
  console.log(`  [batchImportThreatIntelEntries] Added ${added} entries in ${elapsed}ms`);
  return added;
}

// ─── Source Health Monitoring ──────────────────────────────────────────────────────

async function updateSourceHealth(
  sourceId: string,
  status: 'completed' | 'error',
  _entryCount: number,
  errorMsg?: string
): Promise<void> {
  try {
    // Count actual entries in DB for this source
    const [domainCount, ipCount, entryCount] = await Promise.all([
      db.maliciousDomain.count({ where: { source: sourceId } }),
      db.maliciousIP.count({ where: { source: sourceId } }),
      db.threatIntelEntry.count({ where: { sourceId } }),
    ]);
    const totalCount = domainCount + ipCount + entryCount;
    await db.threatIntelSource.upsert({
      where: { sourceId },
      update: {
        status,
        lastUpdate: new Date(),
        entryCount: totalCount,
        error: errorMsg || null,
      },
      create: {
        sourceId,
        name: sourceId,
        status,
        lastUpdate: new Date(),
        entryCount: totalCount,
        error: errorMsg || null,
      },
    });
  } catch (err) {
    console.error(`Failed to update source health for ${sourceId}:`, err);
  }
}

// ─── Get API key from database ─────────────────────────────────────────────────────

async function getApiKey(source: string): Promise<string | null> {
  try {
    const record = await db.threatIntelApiKey.findUnique({ where: { source } });
    if (!record || !record.enabled) return null;
    try {
      return decrypt(record.apiKey);
    } catch {
      // If decryption fails, return the raw key (might be unencrypted legacy)
      return record.apiKey;
    }
  } catch {
    return null;
  }
}

// ─── Collector 1: AlienVault OTX ───────────────────────────────────────────────────

async function collectAlienVaultOTX(): Promise<CollectorResult> {
  const sourceId = 'alienvault-otx';
  console.log(`\n=== [Collector] AlienVault OTX ===`);

  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const entryList: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[] = [];

  try {
    const apiKey = await getApiKey(sourceId);
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['X-OTX-API-KEY'] = apiKey;
    }

    // OTX API v1 - use pulses endpoints (public, no auth needed for /pulses/latest)
    // The /indicators/recent and /indicators/export endpoints are deprecated/404
    const endpoints: string[] = [];

    // Primary: public latest pulses (returns pulses with indicators)
    endpoints.push('https://otx.alienvault.com/api/v1/pulses/latest?limit=50');

    // With API key, also try subscribed pulses
    if (apiKey) {
      endpoints.push('https://otx.alienvault.com/api/v1/pulses/subscribed?limit=50');
    }

    let pulses: any[] = [];
    for (const endpoint of endpoints) {
      try {
        const resp = await fetchWithRetry(endpoint, 2, 30000, Object.keys(headers).length > 0 ? headers : undefined);
        const data = await resp.json();
        // Pulse format: { results: [{ id, name, indicators: [{ indicator, type }] }] }
        const results = data.results || [];
        console.log(`  Fetched ${results.length} pulses from ${endpoint.split('?')[0].split('/').pop()}`);
        if (Array.isArray(results)) {
          pulses = pulses.concat(results);
        }
      } catch (err: any) {
        console.log(`  Endpoint failed: ${err.message}`);
      }
    }

    // Deduplicate pulses
    const seenPulseIds = new Set<string>();
    pulses = pulses.filter((p: any) => {
      if (seenPulseIds.has(p.id)) return false;
      seenPulseIds.add(p.id);
      return true;
    });

    console.log(`  Total unique pulses: ${pulses.length}`);

    for (const pulse of pulses) {
      const pulseName = pulse.name || 'Unknown';
      const indicators = pulse.indicators || [];

      for (const indicator of indicators) {
        const type = indicator.type || indicator.indicator_types?.[0] || '';
        const value = indicator.indicator || '';
        const reason = `AlienVault OTX: ${pulseName}`;

        if (!value) continue;

        if (type === 'domain' || type === 'hostname') {
          if (!isIP(value)) {
            domainSet.set(value, { domain: value, reason, source: sourceId, severity: 'high', category: 'threat-intel' });
            entryList.push({ sourceId, type: 'domain', value, severity: 'high', tags: pulseName });
          } else if (isValidIP(value)) {
            ipSet.set(value, { ip: value, reason, source: sourceId, severity: 'high', category: 'threat-intel', country: null });
            entryList.push({ sourceId, type: 'ip', value, severity: 'high', tags: pulseName });
          }
        } else if (type === 'IPv4') {
          const ip = value.split('/')[0].trim();
          if (isValidIP(ip)) {
            ipSet.set(ip, { ip, reason, source: sourceId, severity: 'high', category: 'threat-intel', country: null });
            entryList.push({ sourceId, type: 'ip', value: ip, severity: 'high', tags: pulseName });
          }
        } else if (type === 'URL') {
          const hostname = extractDomain(value);
          if (hostname) {
            if (isIP(hostname) && isValidIP(hostname)) {
              ipSet.set(hostname, { ip: hostname, reason, source: sourceId, severity: 'high', category: 'threat-intel', country: null });
              entryList.push({ sourceId, type: 'ip', value: hostname, severity: 'high', tags: pulseName });
            } else if (!isIP(hostname)) {
              domainSet.set(hostname, { domain: hostname, reason, source: sourceId, severity: 'high', category: 'threat-intel' });
              entryList.push({ sourceId, type: 'domain', value: hostname, severity: 'high', tags: pulseName });
            }
          }
        } else if (type === 'email') {
          const emailDomain = value.split('@')[1];
          if (emailDomain && !isIP(emailDomain)) {
            domainSet.set(emailDomain, { domain: emailDomain, reason: `${reason} (email)`, source: sourceId, severity: 'medium', category: 'phishing' });
            entryList.push({ sourceId, type: 'domain', value: emailDomain, severity: 'medium', tags: `email:${pulseName}` });
          }
        }
      }
    }

    const dAdded = await batchImportDomains([...domainSet.values()]);
    const iAdded = await batchImportIPs([...ipSet.values()]);
    const eAdded = await batchImportThreatIntelEntries(entryList);
    const total = dAdded + iAdded + eAdded;
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs, ${eAdded} intel entries`);

    await updateSourceHealth(sourceId, 'completed', total);
    return { sourceId, domains: dAdded, ips: iAdded, entries: eAdded, totalDomains: domainSet.size, totalIps: ipSet.size, totalEntries: entryList.length };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    await updateSourceHealth(sourceId, 'error', 0, err.message);
    return { sourceId, domains: 0, ips: 0, entries: 0, error: err.message };
  }
}

// ─── Collector 2: PhishTank ────────────────────────────────────────────────────────

async function collectPhishTank(): Promise<CollectorResult> {
  const sourceId = 'phishtank';
  console.log(`\n=== [Collector] PhishTank ===`);

  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const entryList: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[] = [];

  try {
    // Try multiple PhishTank data sources
    // The data.phishtank.com endpoint redirects to CloudFront CDN which may return 404
    // Try direct feed URL and the phishtank.org website feed as fallback
    let data: any[] = [];
    let feedSource = '';

    // Strategy 1: Try the official data feed (follows redirects)
    try {
      const resp = await fetchWithRetry('https://data.phishtank.com/data/online-valid.json', 2, 30000);
      const parsed = await resp.json();
      if (Array.isArray(parsed) && parsed.length > 0) {
        data = parsed;
        feedSource = 'data.phishtank.com';
      }
    } catch (err: any) {
      console.log(`  PhishTank official feed failed: ${err.message}`);
    }

    // Strategy 2: Try the PhishTank CSV/JSON feed via alternative path
    if (data.length === 0) {
      try {
        const apiKey = await getApiKey(sourceId);
        const feedUrl = apiKey
          ? `https://data.phishtank.com/data/${apiKey}/verified-online.json`
          : 'https://data.phishtank.com/data/verified-online.json';
        const resp = await fetchWithRetry(feedUrl, 2, 30000);
        const parsed = await resp.json();
        if (Array.isArray(parsed) && parsed.length > 0) {
          data = parsed;
          feedSource = 'phishtank-key-feed';
        }
      } catch (err: any) {
        console.log(`  PhishTank alternative feed failed: ${err.message}`);
      }
    }

    if (data.length === 0) {
      console.log(`  PhishTank: Could not fetch data from any endpoint, skipping`);
      await updateSourceHealth(sourceId, 'completed', 0);
      return { sourceId, domains: 0, ips: 0, entries: 0, skipped: true };
    }

    console.log(`  Fetched ${data.length} entries from PhishTank (${feedSource})`);

    for (const entry of data) {
      const url = entry.url || '';
      const hostname = extractDomain(url);
      if (!hostname) continue;

      const target = entry.target || '';
      const reason = `PhishTank verified phishing${target ? ` (${target})` : ''}`;

      if (isIP(hostname)) {
        if (isValidIP(hostname)) {
          ipSet.set(hostname, { ip: hostname, reason, source: sourceId, severity: 'critical', category: 'phishing', country: null });
          entryList.push({ sourceId, type: 'ip', value: hostname, severity: 'critical', tags: target || 'phishing' });
        }
      } else {
        domainSet.set(hostname, { domain: hostname, reason, source: sourceId, severity: 'critical', category: 'phishing' });
        entryList.push({ sourceId, type: 'domain', value: hostname, severity: 'critical', tags: target || 'phishing' });
      }
    }

    const dAdded = await batchImportDomains([...domainSet.values()]);
    const iAdded = await batchImportIPs([...ipSet.values()]);
    const eAdded = await batchImportThreatIntelEntries(entryList);
    const total = dAdded + iAdded + eAdded;
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs, ${eAdded} intel entries`);

    await updateSourceHealth(sourceId, 'completed', total);
    return { sourceId, domains: dAdded, ips: iAdded, entries: eAdded, totalDomains: domainSet.size, totalIps: ipSet.size, totalEntries: entryList.length };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message} (PhishTank may require API key)`);
    await updateSourceHealth(sourceId, 'error', 0, err.message);
    return { sourceId, domains: 0, ips: 0, entries: 0, error: err.message };
  }
}

// ─── Collector 3: Spamhaus DROP ────────────────────────────────────────────────────

async function collectSpamhausDROP(): Promise<CollectorResult> {
  const sourceId = 'spamhaus-drop';
  console.log(`\n=== [Collector] Spamhaus DROP ===`);

  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const entryList: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[] = [];

  try {
    // Fetch DROP list
    const { response: dropResp, notModified: dropNotModified } = await fetchWithConditional(
      sourceId,
      'https://www.spamhaus.org/drop/drop.txt',
      3,
      60000
    );

    if (dropNotModified) {
      console.log(`  Spamhaus DROP: data not modified since last fetch, skipping`);
      await updateSourceHealth(sourceId, 'completed', 0);
      return { sourceId, domains: 0, ips: 0, entries: 0, skipped: true };
    }

    const dropText = await dropResp.text();
    const dropLines = dropText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith(';'));
    console.log(`  Fetched ${dropLines.length} lines from Spamhaus DROP`);

    for (const line of dropLines) {
      const cidr = line.split(';')[0].trim();
      const ip = cidr.split('/')[0].trim();
      if (isValidIP(ip)) {
        ipSet.set(ip, { ip, reason: 'Spamhaus DROP - known hijacked/spam IP', source: sourceId, severity: 'critical', category: 'spam', country: null });
        entryList.push({ sourceId, type: 'ip', value: ip, severity: 'critical', tags: 'DROP' });
      }
    }

    // Fetch EDROP list
    try {
      const edropResp = await fetchWithRetry('https://www.spamhaus.org/drop/edrop.txt', 3, 60000);
      const edropText = await edropResp.text();
      const edropLines = edropText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith(';'));
      console.log(`  Fetched ${edropLines.length} lines from Spamhaus EDROP`);

      for (const line of edropLines) {
        const cidr = line.split(';')[0].trim();
        const ip = cidr.split('/')[0].trim();
        if (isValidIP(ip)) {
          ipSet.set(ip, { ip, reason: 'Spamhaus EDROP - known hijacked/spam IP', source: sourceId, severity: 'critical', category: 'spam', country: null });
          entryList.push({ sourceId, type: 'ip', value: ip, severity: 'critical', tags: 'EDROP' });
        }
      }
    } catch (edropErr: any) {
      console.log(`  EDROP fetch failed: ${edropErr.message}`);
    }

    const iAdded = await batchImportIPs([...ipSet.values()]);
    const eAdded = await batchImportThreatIntelEntries(entryList);
    const total = iAdded + eAdded;
    console.log(`  Imported: ${iAdded} IPs, ${eAdded} intel entries`);

    await updateSourceHealth(sourceId, 'completed', total);
    return { sourceId, domains: 0, ips: iAdded, entries: eAdded, totalIps: ipSet.size, totalEntries: entryList.length };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    await updateSourceHealth(sourceId, 'error', 0, err.message);
    return { sourceId, domains: 0, ips: 0, entries: 0, error: err.message };
  }
}

// ─── Collector 5: Blocklist.de ─────────────────────────────────────────────────────

async function collectBlocklistDE(): Promise<CollectorResult> {
  const sourceId = 'blocklist-de';
  console.log(`\n=== [Collector] Blocklist.de ===`);

  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const entryList: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[] = [];

  try {
    const resp = await fetchWithRetry('https://lists.blocklist.de/lists/all.txt', 3, 60000);
    const text = await resp.text();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    console.log(`  Fetched ${lines.length} lines from Blocklist.de`);

    for (const line of lines) {
      const ip = line.replace(/^ip:/, '').trim();
      if (isValidIP(ip)) {
        ipSet.set(ip, { ip, reason: 'Blocklist.de aggressive IP', source: sourceId, severity: 'high', category: 'bruteforce', country: null });
        entryList.push({ sourceId, type: 'ip', value: ip, severity: 'high', tags: 'bruteforce' });
      }
    }

    const iAdded = await batchImportIPs([...ipSet.values()]);
    const eAdded = await batchImportThreatIntelEntries(entryList);
    const total = iAdded + eAdded;
    console.log(`  Imported: ${iAdded} IPs, ${eAdded} intel entries`);

    await updateSourceHealth(sourceId, 'completed', total);
    return { sourceId, domains: 0, ips: iAdded, entries: eAdded, totalIps: ipSet.size, totalEntries: entryList.length };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    await updateSourceHealth(sourceId, 'error', 0, err.message);
    return { sourceId, domains: 0, ips: 0, entries: 0, error: err.message };
  }
}

// ─── Collector 6: CINS Army ────────────────────────────────────────────────────────

async function collectCINSArmy(): Promise<CollectorResult> {
  const sourceId = 'cins-army';
  console.log(`\n=== [Collector] CINS Army ===`);

  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const entryList: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[] = [];

  try {
    const resp = await fetchWithRetry('https://cinsscore.com/list/ci-badguys.txt', 3, 60000);
    const text = await resp.text();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    console.log(`  Fetched ${lines.length} lines from CINS Army`);

    for (const line of lines) {
      const ip = line.split('/')[0].trim();
      if (isValidIP(ip)) {
        ipSet.set(ip, { ip, reason: 'CINS Army suspicious IP', source: sourceId, severity: 'medium', category: 'suspicious', country: null });
        entryList.push({ sourceId, type: 'ip', value: ip, severity: 'medium', tags: 'suspicious' });
      }
    }

    const iAdded = await batchImportIPs([...ipSet.values()]);
    const eAdded = await batchImportThreatIntelEntries(entryList);
    const total = iAdded + eAdded;
    console.log(`  Imported: ${iAdded} IPs, ${eAdded} intel entries`);

    await updateSourceHealth(sourceId, 'completed', total);
    return { sourceId, domains: 0, ips: iAdded, entries: eAdded, totalIps: ipSet.size, totalEntries: entryList.length };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    await updateSourceHealth(sourceId, 'error', 0, err.message);
    return { sourceId, domains: 0, ips: 0, entries: 0, error: err.message };
  }
}

// ─── Collector 7: OpenPhish ────────────────────────────────────────────────────────

async function collectOpenPhish(): Promise<CollectorResult> {
  const sourceId = 'openphish';
  console.log(`\n=== [Collector] OpenPhish ===`);

  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const entryList: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[] = [];

  try {
    // OpenPhish feed URL changed: openphish.com/feed.txt now redirects to GitHub raw
    // Use the direct GitHub URL to avoid redirect issues
    const resp = await fetchWithRetry('https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt', 3, 60000);
    const text = await resp.text();
    const urls = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    console.log(`  Fetched ${urls.length} URLs from OpenPhish`);

    for (const url of urls) {
      const hostname = extractDomain(url);
      if (!hostname) continue;

      if (isIP(hostname)) {
        if (isValidIP(hostname)) {
          ipSet.set(hostname, { ip: hostname, reason: 'OpenPhish phishing URL', source: sourceId, severity: 'critical', category: 'phishing', country: null });
          entryList.push({ sourceId, type: 'ip', value: hostname, severity: 'critical', tags: 'phishing' });
        }
      } else {
        domainSet.set(hostname, { domain: hostname, reason: 'OpenPhish phishing URL', source: sourceId, severity: 'critical', category: 'phishing' });
        entryList.push({ sourceId, type: 'domain', value: hostname, severity: 'critical', tags: 'phishing' });
      }
    }

    const dAdded = await batchImportDomains([...domainSet.values()]);
    const iAdded = await batchImportIPs([...ipSet.values()]);
    const eAdded = await batchImportThreatIntelEntries(entryList);
    const total = dAdded + iAdded + eAdded;
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs, ${eAdded} intel entries`);

    await updateSourceHealth(sourceId, 'completed', total);
    return { sourceId, domains: dAdded, ips: iAdded, entries: eAdded, totalDomains: domainSet.size, totalIps: ipSet.size, totalEntries: entryList.length };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    await updateSourceHealth(sourceId, 'error', 0, err.message);
    return { sourceId, domains: 0, ips: 0, entries: 0, error: err.message };
  }
}

// ─── Collector 8: URLhaus ──────────────────────────────────────────────────────────

async function collectURLhaus(): Promise<CollectorResult> {
  const sourceId = 'urlhaus';
  console.log(`\n=== [Collector] URLhaus ===`);

  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const entryList: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[] = [];

  try {
    const resp = await fetchWithRetry('https://urlhaus.abuse.ch/downloads/text/', 3, 60000);
    const text = await resp.text();
    const urls = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
    console.log(`  Fetched ${urls.length} URLs from URLhaus`);

    for (const url of urls) {
      const hostname = extractDomain(url);
      if (!hostname) continue;

      if (isIP(hostname)) {
        if (isValidIP(hostname)) {
          ipSet.set(hostname, { ip: hostname, reason: 'URLhaus malicious URL', source: sourceId, severity: 'high', category: 'malware', country: null });
          entryList.push({ sourceId, type: 'ip', value: hostname, severity: 'high', tags: 'malware' });
        }
      } else {
        domainSet.set(hostname, { domain: hostname, reason: 'URLhaus malicious URL', source: sourceId, severity: 'high', category: 'malware' });
        entryList.push({ sourceId, type: 'domain', value: hostname, severity: 'high', tags: 'malware' });
      }
    }

    const dAdded = await batchImportDomains([...domainSet.values()]);
    const iAdded = await batchImportIPs([...ipSet.values()]);
    const eAdded = await batchImportThreatIntelEntries(entryList);
    const total = dAdded + iAdded + eAdded;
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs, ${eAdded} intel entries`);

    await updateSourceHealth(sourceId, 'completed', total);
    return { sourceId, domains: dAdded, ips: iAdded, entries: eAdded, totalDomains: domainSet.size, totalIps: ipSet.size, totalEntries: entryList.length };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    await updateSourceHealth(sourceId, 'error', 0, err.message);
    return { sourceId, domains: 0, ips: 0, entries: 0, error: err.message };
  }
}

// ─── Collector 9: ThreatFox ────────────────────────────────────────────────────────

async function collectThreatFox(): Promise<CollectorResult> {
  const sourceId = 'threatfox';
  console.log(`\n=== [Collector] ThreatFox ===`);

  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const entryList: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[] = [];

  try {
    // Primary strategy: CSV bulk export (most reliable, public access)
    // The ThreatFox API (taginfo/search) now requires authentication (401 Unauthorized)
    // The CSV export is publicly accessible and contains 150K+ IOCs
    console.log(`  ThreatFox: Using CSV bulk export (API requires authentication)`);
    try {
      const csvText = await fetchCsvPossiblyZipped('https://threatfox.abuse.ch/export/csv/full/', 2, 180000);
      const csvLines = csvText.split('\n').filter(l => l.length > 0 && !l.startsWith('#'));
      console.log(`  ThreatFox CSV: ${csvLines.length} lines`);
      // CSV header (0-indexed columns):
      // 0: first_seen_utc, 1: ioc_id, 2: ioc_value, 3: ioc_type,
      // 4: threat_type, 5: fk_malware, 6: malware_alias, 7: malware_printable,
      // 8: last_seen_utc, 9: confidence_level, 10: is_compromised,
      // 11: reference, 12: tags, 13: anonymous, 14: reporter
      let headerSkipped = false;
      for (const line of csvLines) {
        if (!headerSkipped) {
          const firstField = line.split(',')[0]?.trim().replace(/"/g, '');
          if (firstField === 'first_seen_utc') { headerSkipped = true; continue; }
          headerSkipped = true;
        }
        const fields = parseCsvLine(line);
        if (fields.length < 8) continue;
        const iocValue = fields[2] || '';       // ioc_value (column 2)
        const iocType = fields[3] || '';        // ioc_type (column 3)
        const threatType = fields[4] || '';     // threat_type (column 4)
        const malware = fields[7] || 'unknown'; // malware_printable (column 7)
        const confidence = fields[9] || '';     // confidence_level (column 9)
        const tagsField = fields[12] || '';     // tags (column 12)
        if (!iocValue) continue;

        // Determine severity based on confidence level
        const confNum = parseInt(confidence, 10);
        const severity = confNum >= 75 ? 'critical' : confNum >= 50 ? 'high' : 'medium';
        const reason = `ThreatFox: ${malware} (${threatType})`;

        if (iocType === 'ip:port' || iocType === 'ip') {
          const ip = iocValue.split(':')[0];
          if (isValidIP(ip)) {
            ipSet.set(ip, { ip, reason, source: sourceId, severity, category: threatType || 'c2', country: null });
            entryList.push({ sourceId, type: 'ip', value: ip, severity, tags: `${malware}${tagsField ? ',' + tagsField : ''}` });
          }
        } else if (iocType === 'domain' || iocType === 'url') {
          let hostname = iocValue;
          if (iocType === 'url') {
            hostname = extractDomain(iocValue) || iocValue;
          }
          if (isIP(hostname)) {
            if (isValidIP(hostname)) {
              ipSet.set(hostname, { ip: hostname, reason, source: sourceId, severity, category: threatType || 'c2', country: null });
              entryList.push({ sourceId, type: 'ip', value: hostname, severity, tags: `${malware}${tagsField ? ',' + tagsField : ''}` });
            }
          } else {
            domainSet.set(hostname, { domain: hostname, reason, source: sourceId, severity, category: threatType || 'malware' });
            entryList.push({ sourceId, type: 'domain', value: hostname, severity, tags: `${malware}${tagsField ? ',' + tagsField : ''}` });
          }
        }
      }
      console.log(`  ThreatFox CSV parsed: ${domainSet.size} domains, ${ipSet.size} IPs`);
    } catch (csvErr: any) {
      console.log(`  ThreatFox CSV export failed: ${csvErr.message}`);
    }

    // Fallback: try API queries if CSV export failed (may work with API key)
    if (domainSet.size === 0 && ipSet.size === 0) {
      console.log(`  ThreatFox: CSV export returned no data, trying API queries`);
      const queries = [
        { query: 'taginfo', tag: 'botnet' },
        { query: 'taginfo', tag: 'c2' },
        { query: 'taginfo', tag: 'malware' },
      ];

      for (const queryBody of queries) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30000);
          const qResp = await fetch('https://threatfox-api.abuse.ch/api/v1/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(queryBody),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!qResp.ok) {
            console.log(`  ThreatFox API query returned HTTP ${qResp.status}`);
            continue;
          }

          const qData = await qResp.json();

          if (qData.query_status === 'no_result') {
            console.log(`  ThreatFox query "${queryBody.tag}" returned no results`);
            continue;
          }

          if (qData.query_status === 'ok' && qData.data && Array.isArray(qData.data)) {
            console.log(`  ThreatFox query "${queryBody.tag}" returned ${qData.data.length} IOCs`);

            for (const ioc of qData.data) {
              const iocValue = ioc.ioc || ioc.indicator;
              const iocType = ioc.ioc_type || ioc.type;
              const malware = ioc.malware_printable || ioc.malware || 'unknown';
              const threatType = ioc.threat_type || ioc.confidence_level || '';
              const reason = `ThreatFox: ${malware} (${threatType})`;

              if (!iocValue) continue;

              if (iocType === 'ip:port' || iocType === 'ip') {
                const ip = iocValue.split(':')[0];
                if (isValidIP(ip)) {
                  ipSet.set(ip, { ip, reason, source: sourceId, severity: 'high', category: threatType || 'c2', country: null });
                  entryList.push({ sourceId, type: 'ip', value: ip, severity: 'high', tags: malware });
                }
              } else if (iocType === 'domain' || iocType === 'url') {
                let hostname = iocValue;
                if (iocType === 'url') {
                  hostname = extractDomain(iocValue) || iocValue;
                }
                if (isIP(hostname)) {
                  if (isValidIP(hostname)) {
                    ipSet.set(hostname, { ip: hostname, reason, source: sourceId, severity: 'high', category: threatType || 'c2', country: null });
                    entryList.push({ sourceId, type: 'ip', value: hostname, severity: 'high', tags: malware });
                  }
                } else {
                  domainSet.set(hostname, { domain: hostname, reason, source: sourceId, severity: 'high', category: threatType || 'malware' });
                  entryList.push({ sourceId, type: 'domain', value: hostname, severity: 'high', tags: malware });
                }
              }
            }
          }
        } catch (qErr: any) {
          console.log(`  ThreatFox query "${queryBody.tag}" failed: ${qErr.message}`);
        }

        await delay(1000);
      }
    }

    const dAdded = await batchImportDomains([...domainSet.values()]);
    const iAdded = await batchImportIPs([...ipSet.values()]);
    const eAdded = await batchImportThreatIntelEntries(entryList);
    const total = dAdded + iAdded + eAdded;
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs, ${eAdded} intel entries`);

    await updateSourceHealth(sourceId, 'completed', total);
    return { sourceId, domains: dAdded, ips: iAdded, entries: eAdded, totalDomains: domainSet.size, totalIps: ipSet.size, totalEntries: entryList.length };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    await updateSourceHealth(sourceId, 'error', 0, err.message);
    return { sourceId, domains: 0, ips: 0, entries: 0, error: err.message };
  }
}

// ─── Collector 10: Botvrij ──────────────────────────────────────────────────────────

async function collectBotvrij(): Promise<CollectorResult> {
  const sourceId = 'botvrij';
  console.log(`\n=== [Collector] Botvrij ===`);

  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const entryList: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[] = [];

  try {
    // Fetch domain IOC list
    try {
      const domResp = await fetchWithRetry('https://www.botvrij.eu/data/ioclist.domain', 2, 30000);
      const domText = await domResp.text();
      const domLines = domText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
      console.log(`  Fetched ${domLines.length} domain entries from Botvrij`);

      for (const line of domLines) {
        // Format: domain [source] [description]
        const parts = line.split(/\s+/);
        const domain = parts[0].toLowerCase().trim();
        if (domain && !isIP(domain) && domain.includes('.')) {
          const source = parts.length > 1 ? parts[1] : 'botvrij';
          domainSet.set(domain, { domain, reason: `Botvrij IOC: ${source}`, source: sourceId, severity: 'medium', category: 'botnet' });
          entryList.push({ sourceId, type: 'domain', value: domain, severity: 'medium', tags: source });
        }
      }
    } catch (domErr: any) {
      console.log(`  Domain list fetch failed: ${domErr.message}`);
    }

    // Fetch IP IOC list
    try {
      const ipResp = await fetchWithRetry('https://www.botvrij.eu/data/ioclist.ip', 2, 30000);
      const ipText = await ipResp.text();
      const ipLines = ipText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
      console.log(`  Fetched ${ipLines.length} IP entries from Botvrij`);

      for (const line of ipLines) {
        // Format: ip [source] [description]
        const parts = line.split(/\s+/);
        const ip = parts[0].trim();
        if (isValidIP(ip)) {
          const source = parts.length > 1 ? parts[1] : 'botvrij';
          ipSet.set(ip, { ip, reason: `Botvrij IOC: ${source}`, source: sourceId, severity: 'medium', category: 'botnet', country: null });
          entryList.push({ sourceId, type: 'ip', value: ip, severity: 'medium', tags: source });
        }
      }
    } catch (ipErr: any) {
      console.log(`  IP list fetch failed: ${ipErr.message}`);
    }

    const dAdded = await batchImportDomains([...domainSet.values()]);
    const iAdded = await batchImportIPs([...ipSet.values()]);
    const eAdded = await batchImportThreatIntelEntries(entryList);
    const total = dAdded + iAdded + eAdded;
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs, ${eAdded} intel entries`);

    await updateSourceHealth(sourceId, 'completed', total);
    return { sourceId, domains: dAdded, ips: iAdded, entries: eAdded, totalDomains: domainSet.size, totalIps: ipSet.size, totalEntries: entryList.length };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    await updateSourceHealth(sourceId, 'error', 0, err.message);
    return { sourceId, domains: 0, ips: 0, entries: 0, error: err.message };
  }
}

// ─── Main Collection Runner ────────────────────────────────────────────────────────
//
// NOTE: VirusTotal and AbuseIPDB are NOT included in bulk collection because they
// are rate-limited and should only be used for query-time lookups via
// /api/threat-intel/lookup endpoint. VirusTotal free tier: 500 req/day (4 req/min).
// AbuseIPDB free tier: 1000 checks/day. Both are accessed on-demand per query.
// ThreatBook is handled separately in /api/threat-intel/route.ts for real-time queries.
// But we also add a bulk collector that queries the ThreatBook community feed for known malicious indicators.

// ─── Collector 12: ThreatBook Community Feed ────────────────────────────────────────

async function collectThreatBook(): Promise<CollectorResult> {
  const sourceId = 'threatbook';
  console.log(`\n=== [Collector] ThreatBook/微步 ===`);

  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const entryList: { sourceId: string; type: string; value: string; severity: string; tags?: string | null }[] = [];

  try {
    const apiKey = await getApiKey(sourceId);
    if (!apiKey) {
      console.log(`  ThreatBook: No API key configured, skipping bulk collection`);
      await updateSourceHealth(sourceId, 'completed', 0);
      return { sourceId, domains: 0, ips: 0, entries: 0, skipped: true };
    }

    const THREATBOOK_BASE_URL = 'https://api.threatbook.cn/v3';

    // Query ThreatBook for well-known malicious indicator lists
    // We query for recent threat intelligence using the community feed endpoint
    const queries = [
      // Query known botnet C2 IPs
      { url: `${THREATBOOK_BASE_URL}/asset/ip?apikey=${apiKey}&ip=`, type: 'ip' as const, tags: ['botnet'] },
    ];

    // Strategy: Query a list of known high-confidence malicious IPs/domains
    // from other sources that we've already collected, then enrich with ThreatBook data
    // First, get the most recent IPs from our DB that don't have ThreatBook source yet
    const recentIPs = await db.maliciousIP.findMany({
      where: { source: { not: sourceId } },
      select: { ip: true, source: true, category: true },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });

    const recentDomains = await db.maliciousDomain.findMany({
      where: { source: { not: sourceId } },
      select: { domain: true, source: true, category: true },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });

    console.log(`  Checking ${recentIPs.length} recent IPs and ${recentDomains.length} recent domains against ThreatBook`);

    // Query ThreatBook for each IP (rate-limited: ~4 requests per minute for free key)
    let queryCount = 0;
    const MAX_QUERIES = 20; // Limit to avoid exhausting API quota

    for (const ipRecord of recentIPs) {
      if (queryCount >= MAX_QUERIES) break;
      try {
        await delay(1500); // Rate limit: ~1 request per 1.5 seconds
        const url = `${THREATBOOK_BASE_URL}/asset/ip?apikey=${apiKey}&ip=${encodeURIComponent(ipRecord.ip)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        queryCount++;

        if (resp.status === 429) {
          console.log(`  ThreatBook rate limited after ${queryCount} queries, stopping`);
          break;
        }

        if (!resp.ok) {
          console.log(`  ThreatBook API returned ${resp.status} for IP ${ipRecord.ip}`);
          continue;
        }

        const json = await resp.json();
        if (json.response_code !== 0) continue;

        const summary = json.data?.summary || {};
        const judgments: string[] = summary.judgments || [];
        const threatTags = json.data?.threat_tags || [];
        const tags: string[] = [...(summary.tags || []), ...threatTags];
        const confidence = json.data?.confidence || 0;

        // Only add if ThreatBook confirms malicious/suspicious
        const isMalicious = judgments.some(j => j.includes('恶意') || j.toLowerCase().includes('malicious'));
        const isSuspicious = judgments.some(j => j.includes('可疑') || j.toLowerCase().includes('suspicious'));

        if (isMalicious || isSuspicious) {
          const tagStr = tags.length > 0 ? tags.join(',') : (ipRecord.category || 'unknown');
          const reason = `ThreatBook验证: ${judgments.join(', ')} (置信度${confidence}%)`;
          const severity = isMalicious ? 'critical' : 'high';
          const category = tags.some(t => t.includes('botnet') || t.includes('僵尸网络')) ? 'botnet'
            : tags.some(t => t.includes('c2') || t.includes('远控')) ? 'c2'
            : tags.some(t => t.includes('malware') || t.includes('恶意软件')) ? 'malware'
            : ipRecord.category || 'other';

          ipSet.set(ipRecord.ip, { ip: ipRecord.ip, reason, source: sourceId, severity, category, country: null });
          entryList.push({ sourceId, type: 'ip', value: ipRecord.ip, severity, tags: tagStr });
        }
      } catch (err: any) {
        console.log(`  ThreatBook query failed for IP ${ipRecord.ip}: ${err.message}`);
      }
    }

    // Query ThreatBook for domains
    for (const domainRecord of recentDomains) {
      if (queryCount >= MAX_QUERIES) break;
      try {
        await delay(1500);
        const url = `${THREATBOOK_BASE_URL}/asset/domain?apikey=${apiKey}&domain=${encodeURIComponent(domainRecord.domain)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        queryCount++;

        if (resp.status === 429) {
          console.log(`  ThreatBook rate limited after ${queryCount} queries, stopping`);
          break;
        }

        if (!resp.ok) {
          console.log(`  ThreatBook API returned ${resp.status} for domain ${domainRecord.domain}`);
          continue;
        }

        const json = await resp.json();
        if (json.response_code !== 0) continue;

        const summary = json.data?.summary || {};
        const judgments: string[] = summary.judgments || [];
        const threatTags = json.data?.threat_tags || [];
        const tags: string[] = [...(summary.tags || []), ...threatTags];
        const confidence = json.data?.confidence || 0;

        const isMalicious = judgments.some(j => j.includes('恶意') || j.toLowerCase().includes('malicious'));
        const isSuspicious = judgments.some(j => j.includes('可疑') || j.toLowerCase().includes('suspicious'));

        if (isMalicious || isSuspicious) {
          const tagStr = tags.length > 0 ? tags.join(',') : (domainRecord.category || 'unknown');
          const reason = `ThreatBook验证: ${judgments.join(', ')} (置信度${confidence}%)`;
          const severity = isMalicious ? 'critical' : 'high';
          const category = tags.some(t => t.includes('botnet') || t.includes('僵尸网络')) ? 'botnet'
            : tags.some(t => t.includes('c2') || t.includes('远控')) ? 'c2'
            : tags.some(t => t.includes('phishing') || t.includes('钓鱼')) ? 'phishing'
            : domainRecord.category || 'other';

          domainSet.set(domainRecord.domain, { domain: domainRecord.domain, reason, source: sourceId, severity, category });
          entryList.push({ sourceId, type: 'domain', value: domainRecord.domain, severity, tags: tagStr });
        }
      } catch (err: any) {
        console.log(`  ThreatBook query failed for domain ${domainRecord.domain}: ${err.message}`);
      }
    }

    console.log(`  ThreatBook: Made ${queryCount} API queries, found ${domainSet.size} domains, ${ipSet.size} IPs`);

    const dAdded = await batchImportDomains([...domainSet.values()]);
    const iAdded = await batchImportIPs([...ipSet.values()]);
    const eAdded = await batchImportThreatIntelEntries(entryList);
    const total = dAdded + iAdded + eAdded;
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs, ${eAdded} intel entries`);

    await updateSourceHealth(sourceId, 'completed', total);
    return { sourceId, domains: dAdded, ips: iAdded, entries: eAdded, totalDomains: domainSet.size, totalIps: ipSet.size, totalEntries: entryList.length };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    await updateSourceHealth(sourceId, 'error', 0, err.message);
    return { sourceId, domains: 0, ips: 0, entries: 0, error: err.message };
  }
}

type CollectorFn = () => Promise<CollectorResult>;

interface CollectorDef {
  id: string;
  name: string;
  nameEn: string;
  fn: CollectorFn;
}

// ─── COLLECTOR_MAP: source ID → collector function ────────────────────────────────
// Used for targeted sync (individual source or subset).
// - 'botvrij' is excluded (low-quality source, per design decision)
// - 'ssl-blacklist' is removed (deprecated)
// - 'virustotal', 'abuseipdb' are query-only, no bulk sync
// - 'threatbook' now has a bulk collector that verifies existing indicators against ThreatBook API
// Exported for use by sync-task-manager
export const COLLECTOR_MAP: Record<string, () => Promise<CollectorResult>> = {
  'alienvault-otx': collectAlienVaultOTX,
  'phishtank': collectPhishTank,
  'spamhaus-drop': collectSpamhausDROP,
  'blocklist-de': collectBlocklistDE,
  'cins-army': collectCINSArmy,
  'openphish': collectOpenPhish,
  'urlhaus': collectURLhaus,
  'threatfox': collectThreatFox,
  'threatbook': collectThreatBook,
};

const ALL_COLLECTORS: CollectorDef[] = [
  { id: 'alienvault-otx', name: 'AlienVault OTX', nameEn: 'AlienVault OTX', fn: collectAlienVaultOTX },
  { id: 'phishtank', name: 'PhishTank', nameEn: 'PhishTank', fn: collectPhishTank },
  { id: 'spamhaus-drop', name: 'Spamhaus DROP', nameEn: 'Spamhaus DROP', fn: collectSpamhausDROP },
  { id: 'blocklist-de', name: 'Blocklist.de', nameEn: 'Blocklist.de', fn: collectBlocklistDE },
  { id: 'cins-army', name: 'CINS Army', nameEn: 'CINS Army', fn: collectCINSArmy },
  { id: 'openphish', name: 'OpenPhish', nameEn: 'OpenPhish', fn: collectOpenPhish },
  { id: 'urlhaus', name: 'URLhaus', nameEn: 'URLhaus', fn: collectURLhaus },
  { id: 'threatfox', name: 'ThreatFox', nameEn: 'ThreatFox', fn: collectThreatFox },
  { id: 'threatbook', name: 'ThreatBook/微步', nameEn: 'ThreatBook', fn: collectThreatBook },
  // 'botvrij' excluded from default collectors (low-quality source)
];

/**
 * Run collectors in parallel using Promise.allSettled.
 * Groups collectors into batches for concurrent execution.
 * @param sourceIds - Optional array of specific source IDs to run. If not provided, runs all.
 * @param concurrencyLimit - Max number of parallel collectors (default: 4)
 * @param onProgress - Optional callback invoked after each collector completes
 */
async function runCollection(
  sourceIds?: string[],
  concurrencyLimit = 4,
  onProgress?: (completed: number, total: number, result: CollectorResult) => void,
): Promise<CollectorResult[]> {
  // Determine which collectors to run
  const collectorsToRun = sourceIds
    ? sourceIds.filter(id => COLLECTOR_MAP[id]).map(id => ({ id, fn: COLLECTOR_MAP[id] }))
    : Object.entries(COLLECTOR_MAP).map(([id, fn]) => ({ id, fn }));

  if (collectorsToRun.length === 0) {
    console.log('No matching collectors found');
    return [];
  }

  console.log(`\n=== Running ${collectorsToRun.length} collectors (concurrency: ${concurrencyLimit}) ===`);
  const collectionStartTime = Date.now();

  // Ensure source records exist in the database
  for (const { id } of collectorsToRun) {
    try {
      const collectorDef = ALL_COLLECTORS.find(c => c.id === id);
      await db.threatIntelSource.upsert({
        where: { sourceId: id },
        update: { name: collectorDef?.name || id, nameEn: collectorDef?.nameEn || id, status: 'collecting' },
        create: {
          sourceId: id,
          name: collectorDef?.name || id,
          nameEn: collectorDef?.nameEn || id,
          status: 'collecting',
          enabled: true,
        },
      });
    } catch (err) {
      console.error(`Failed to upsert source record for ${id}:`, err);
    }
  }

  const results: CollectorResult[] = [];
  let completedCount = 0;
  const total = collectorsToRun.length;

  // Run collectors in batches for concurrent execution
  for (let i = 0; i < collectorsToRun.length; i += concurrencyLimit) {
    const batch = collectorsToRun.slice(i, i + concurrencyLimit);
    console.log(`\n--- Batch ${Math.floor(i / concurrencyLimit) + 1}: ${batch.map(c => c.id).join(', ')} ---`);

    const batchResults = await Promise.allSettled(
      batch.map(async ({ id, fn }) => {
        try {
          const result = await fn();
          return result;
        } catch (err: any) {
          console.error(`Collector ${id} threw unhandled error: ${err.message}`);
          await updateSourceHealth(id, 'error', 0, err.message);
          return { sourceId: id, domains: 0, ips: 0, error: err.message };
        }
      }),
    );

    for (const settled of batchResults) {
      completedCount++;
      if (settled.status === 'fulfilled') {
        const result = settled.value;
        results.push(result);
        if (onProgress) onProgress(completedCount, total, result);
      } else {
        // This shouldn't happen since we catch errors above, but handle it anyway
        const errorResult: CollectorResult = {
          sourceId: `unknown-${completedCount}`,
          domains: 0,
          ips: 0,
          error: settled.reason?.message || 'Unknown error',
        };
        results.push(errorResult);
        if (onProgress) onProgress(completedCount, total, errorResult);
      }
    }

    // Small delay between batches to avoid overwhelming external services
    if (i + concurrencyLimit < collectorsToRun.length) {
      await delay(SOURCE_DELAY_MS);
    }
  }

  const totalElapsed = Date.now() - collectionStartTime;
  const totalDomains = results.reduce((sum, r) => sum + (r.domains || 0), 0);
  const totalIps = results.reduce((sum, r) => sum + (r.ips || 0), 0);
  const totalEntries = results.reduce((sum, r) => sum + (r.entries || 0), 0);
  const errors = results.filter(r => r.error).length;
  console.log(`\n=== Collection complete: ${results.length} collectors, ${totalDomains} domains, ${totalIps} IPs, ${totalEntries} entries, ${errors} errors in ${totalElapsed}ms ===`);

  return results;
}

// ─── API Handlers ──────────────────────────────────────────────────────────────────

// POST /api/threat-intel/update — Trigger threat intel data update
// Now creates a SyncTask record for persistent tracking
export async function POST(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  // Check if an update is already running
  const runningTask = Array.from(updateTasks.values()).find(t => t.status === 'running');
  if (runningTask) {
    const runningId = Array.from(updateTasks.entries()).find(([, v]) => v.status === 'running')?.[0];
    return NextResponse.json({
      error: 'An update is already running',
      taskId: runningId,
    }, { status: 409 });
  }

  const taskId = `update-${Date.now()}`;
  updateTasks.set(taskId, { status: 'running', startedAt: Date.now() });

  // Clean up old tasks (keep last 10)
  if (updateTasks.size > 10) {
    const entries = Array.from(updateTasks.entries()).sort((a, b) => b[1].startedAt - a[1].startedAt);
    updateTasks.clear();
    for (const [key, value] of entries.slice(0, 10)) {
      updateTasks.set(key, value);
    }
  }

  // Parse request body for optional source filter
  let sourceIds: string[] | undefined;
  try {
    const body = await request.json();
    if (body?.sources && Array.isArray(body.sources)) {
      sourceIds = body.sources;
    }
  } catch {
    // No body or invalid JSON — run all collectors
  }

  // Filter out query-only sources (virustotal, threatbook, abuseipdb)
  const QUERY_ONLY_SOURCES = new Set(['virustotal', 'threatbook', 'abuseipdb']);
  if (sourceIds) {
    sourceIds = sourceIds.filter(id => !QUERY_ONLY_SOURCES.has(id));
  }

  // Filter to only valid sources
  const validSourceIds = sourceIds
    ? sourceIds.filter(id => COLLECTOR_MAP[id])
    : undefined;
  const effectiveSources = validSourceIds || Object.keys(COLLECTOR_MAP);

  // Create a SyncTask record for persistent tracking
  try {
    const { createTask, startTask } = await import('@/lib/sync-task-manager');

    // Check if a sync task is already running
    const runningTasks = await db.syncTask.findMany({ where: { status: 'running' } });
    if (runningTasks.length > 0) {
      return NextResponse.json({ error: 'A sync task is already running', syncTaskId: runningTasks[0].id }, { status: 409 });
    }

    const syncTask = await createTask(
      `威胁情报同步 ${new Date().toLocaleString('zh-CN')}`,
      effectiveSources,
    );

    // Log sync operation
    const syncIp = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    auditLog.data('sync_started', 'system', `Threat intel sync started with ${effectiveSources.length} source(s): ${effectiveSources.join(', ')}`, syncIp).catch(() => {});

    // Start the sync task in the background via task manager
    startTask(syncTask.id).catch(err => {
      console.error(`[ThreatIntel Update] Failed to start sync task ${syncTask.id}:`, err);
    });

    // Track in the in-memory map for legacy polling support (but do NOT call runCollection again)
    const task = updateTasks.get(taskId);
    if (task) {
      task.status = 'started';
    }

    // Return immediately with both task IDs
    return NextResponse.json({
      taskId,
      syncTaskId: syncTask.id,
      status: 'started',
      message: 'Threat intel update started in the background',
      sources: effectiveSources,
    }, { status: 202 });
  } catch (dbErr: any) {
    // Fallback: if DB task creation fails, still run the sync using in-memory tracking only
    console.error(`[ThreatIntel Update] SyncTask creation failed, falling back to in-memory tracking:`, dbErr);

    // Run collection in the background (non-blocking response)
    runCollection(validSourceIds)
      .then((results) => {
        const task = updateTasks.get(taskId);
        if (task) {
          task.status = 'completed';
          task.completedAt = Date.now();
          task.results = results;
        }
      })
      .catch((err) => {
        const task = updateTasks.get(taskId);
        if (task) {
          task.status = 'failed';
          task.completedAt = Date.now();
          task.error = err.message;
        }
      });

    // Return immediately with the task ID
    return NextResponse.json({
      taskId,
      status: 'started',
      message: 'Threat intel update started in the background',
      sources: effectiveSources,
    }, { status: 202 });
  }
}

// GET /api/threat-intel/update?taskId=xxx&syncTaskId=xxx — Check update task status
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  const syncTaskId = searchParams.get('syncTaskId');

  // If syncTaskId is provided, look up from database
  if (syncTaskId) {
    try {
      const syncTask = await db.syncTask.findUnique({ where: { id: syncTaskId } });
      if (!syncTask) {
        return NextResponse.json({ error: 'Sync task not found' }, { status: 404 });
      }
      let results: CollectorResult[] | null = null;
      if (syncTask.results) {
        try {
          results = JSON.parse(syncTask.results);
        } catch {
          results = null;
        }
      }
      return NextResponse.json({
        syncTaskId: syncTask.id,
        status: syncTask.status,
        progress: syncTask.progress,
        totalSources: syncTask.totalSources,
        completedSources: syncTask.completedSources,
        failedSources: syncTask.failedSources,
        results,
        error: syncTask.error,
        createdAt: syncTask.createdAt,
        startedAt: syncTask.startedAt,
        completedAt: syncTask.completedAt,
      });
    } catch (dbErr: any) {
      return NextResponse.json({ error: 'Failed to query sync task', details: dbErr.message }, { status: 500 });
    }
  }

  if (taskId) {
    const task = updateTasks.get(taskId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    return NextResponse.json({ taskId, ...task });
  }

  // Return all recent tasks
  const tasks = Array.from(updateTasks.entries()).map(([id, info]) => ({
    taskId: id,
    ...info,
  })).sort((a, b) => b.startedAt - a.startedAt);

  // Also return available collectors
  const collectors = Object.entries(COLLECTOR_MAP).map(([id]) => {
    const def = ALL_COLLECTORS.find(c => c.id === id);
    return { id, name: def?.name || id, nameEn: def?.nameEn || id };
  });

  return NextResponse.json({ tasks, collectors });
}
