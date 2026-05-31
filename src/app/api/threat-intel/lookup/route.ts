import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { decrypt } from '@/lib/crypto-server';

export const dynamic = 'force-dynamic';

// ─── Lookup Endpoint for Rate-Limited Sources ────────────────────────────────────
// GET /api/threat-intel/lookup?type=domain|ip&value=example.com
//
// Query priority:
// 1. Check local DB cache (ThreatIntelEntry with sourceId 'virustotal-lookup'/'abuseipdb-lookup'/'threatbook-lookup')
// 2. If cache miss & API key configured, make a single API call
// 3. Cache result for 24h
// 4. Respect rate limits (track last query time, enforce min 15s between same-source queries)

// ─── Types ────────────────────────────────────────────────────────────────────────

interface LookupResult {
  source: string;
  status: 'cached' | 'queried' | 'rate_limited' | 'not_configured' | 'error';
  data?: {
    isMalicious: boolean;
    isSuspicious: boolean;
    confidence: number;
    severity: string;
    tags: string[];
    details?: Record<string, unknown>;
  };
  error?: string;
  cachedAt?: string;
  queriedAt?: string;
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────────

const lastQueryTime = new Map<string, number>();
const MIN_QUERY_INTERVAL_MS = 15_000; // 15 seconds between same-source queries
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function checkRateLimit(source: string): { allowed: boolean; retryAfterMs: number } {
  const lastTime = lastQueryTime.get(source) || 0;
  const elapsed = Date.now() - lastTime;
  if (elapsed < MIN_QUERY_INTERVAL_MS) {
    return { allowed: false, retryAfterMs: MIN_QUERY_INTERVAL_MS - elapsed };
  }
  return { allowed: true, retryAfterMs: 0 };
}

function markQueryTime(source: string): void {
  lastQueryTime.set(source, Date.now());
}

// ─── API Key Retrieval ────────────────────────────────────────────────────────────

async function getApiKey(source: string): Promise<string | null> {
  try {
    const record = await db.threatIntelApiKey.findUnique({ where: { source } });
    if (!record || !record.enabled) return null;
    try {
      return decrypt(record.apiKey);
    } catch {
      return record.apiKey; // legacy unencrypted
    }
  } catch {
    return null;
  }
}

// ─── Cache Helpers ────────────────────────────────────────────────────────────────

async function getCachedResult(
  sourceLookupId: string,
  type: string,
  value: string
): Promise<{ data: LookupResult['data']; cachedAt: string } | null> {
  try {
    const entry = await db.threatIntelEntry.findFirst({
      where: { sourceId: sourceLookupId, type, value },
      orderBy: { createdAt: 'desc' },
    });
    if (!entry) return null;

    // Check if cache is still valid (24h)
    const age = Date.now() - entry.createdAt.getTime();
    if (age > CACHE_TTL_MS) {
      return null; // Cache expired
    }

    // Parse cached data from tags field (JSON)
    let cachedData: LookupResult['data'] | null = null;
    try {
      if (entry.tags) {
        cachedData = JSON.parse(entry.tags);
      }
    } catch {
      // tags might not be JSON - treat as simple cache hit
      cachedData = {
        isMalicious: entry.severity === 'critical' || entry.severity === 'high',
        isSuspicious: entry.severity === 'medium' || entry.severity === 'high',
        confidence: entry.severity === 'critical' ? 90 : entry.severity === 'high' ? 70 : 50,
        severity: entry.severity,
        tags: [],
      };
    }

    if (!cachedData) {
      cachedData = {
        isMalicious: entry.severity === 'critical' || entry.severity === 'high',
        isSuspicious: true,
        confidence: 50,
        severity: entry.severity,
        tags: [],
      };
    }

    return { data: cachedData, cachedAt: entry.createdAt.toISOString() };
  } catch {
    return null;
  }
}

async function cacheResult(
  sourceLookupId: string,
  type: string,
  value: string,
  data: NonNullable<LookupResult['data']>
): Promise<void> {
  try {
    await db.threatIntelEntry.upsert({
      where: { sourceId_type_value: { sourceId: sourceLookupId, type, value } },
      update: {
        severity: data.severity,
        tags: JSON.stringify(data),
        createdAt: new Date(), // Reset timestamp for cache TTL
      },
      create: {
        sourceId: sourceLookupId,
        type,
        value,
        severity: data.severity,
        tags: JSON.stringify(data),
      },
    });

    // Ensure source record exists
    await db.threatIntelSource.upsert({
      where: { sourceId: sourceLookupId },
      update: { status: 'completed', lastUpdate: new Date() },
      create: {
        sourceId: sourceLookupId,
        name: sourceLookupId.replace('-lookup', ' Lookup'),
        nameEn: sourceLookupId.replace('-lookup', ' Lookup'),
        status: 'completed',
        enabled: true,
        requiresApiKey: true,
      },
    }).catch(() => {});
  } catch (err) {
    console.error(`Failed to cache lookup result for ${sourceLookupId}:`, err);
  }
}

// ─── VirusTotal Lookup ────────────────────────────────────────────────────────────

async function lookupVirusTotal(
  type: string,
  value: string
): Promise<LookupResult> {
  const sourceLookupId = 'virustotal-lookup';
  const source = 'virustotal';

  // Check cache first
  const cached = await getCachedResult(sourceLookupId, type, value);
  if (cached) {
    return { source, status: 'cached', data: cached.data, cachedAt: cached.cachedAt };
  }

  // Check rate limit
  const rateCheck = checkRateLimit(source);
  if (!rateCheck.allowed) {
    return {
      source,
      status: 'rate_limited',
      error: `Rate limited. Retry after ${Math.ceil(rateCheck.retryAfterMs / 1000)}s`,
    };
  }

  // Check API key
  const apiKey = await getApiKey(source);
  if (!apiKey) {
    return { source, status: 'not_configured', error: 'VirusTotal API key not configured' };
  }

  // Make API call
  try {
    markQueryTime(source);
    const endpoint = type === 'ip'
      ? `https://www.virustotal.com/api/v3/ip_addresses/${encodeURIComponent(value)}`
      : `https://www.virustotal.com/api/v3/domains/${encodeURIComponent(value)}`;

    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { 'x-apikey': apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (resp.status === 429) {
      return { source, status: 'rate_limited', error: 'VirusTotal API rate limit exceeded' };
    }

    if (!resp.ok) {
      return { source, status: 'error', error: `VirusTotal API returned ${resp.status}` };
    }

    const json = await resp.json();
    const attributes = json.data?.attributes || {};
    const lastAnalysisStats = attributes.last_analysis_stats || {};
    const totalScans = (lastAnalysisStats.malicious || 0) + (lastAnalysisStats.suspicious || 0) +
      (lastAnalysisStats.undetected || 0) + (lastAnalysisStats.harmless || 0);
    const maliciousCount = lastAnalysisStats.malicious || 0;
    const suspiciousCount = lastAnalysisStats.suspicious || 0;

    const isMalicious = maliciousCount >= 3;
    const isSuspicious = maliciousCount >= 1 || suspiciousCount >= 2;
    const confidence = totalScans > 0 ? Math.round((maliciousCount / totalScans) * 100) : 0;
    const severity = maliciousCount >= 10 ? 'critical' : maliciousCount >= 3 ? 'high' : suspiciousCount >= 2 ? 'medium' : 'low';

    const tags: string[] = [];
    if (attributes.reputation !== undefined) tags.push(`reputation:${attributes.reputation}`);
    if (type === 'domain') {
      const categories = attributes.categories || {};
      tags.push(...Object.values(categories).map(String));
    }

    const data: LookupResult['data'] = {
      isMalicious,
      isSuspicious,
      confidence,
      severity,
      tags,
      details: {
        maliciousCount,
        suspiciousCount,
        totalScans,
        reputation: attributes.reputation,
      },
    };

    // Cache the result
    await cacheResult(sourceLookupId, type, value, data);

    return { source, status: 'queried', data, queriedAt: new Date().toISOString() };
  } catch (err: any) {
    if (err.name === 'TimeoutError') {
      return { source, status: 'error', error: 'VirusTotal API request timed out' };
    }
    return { source, status: 'error', error: err.message || 'VirusTotal API request failed' };
  }
}

// ─── AbuseIPDB Lookup ─────────────────────────────────────────────────────────────

async function lookupAbuseIPDB(
  type: string,
  value: string
): Promise<LookupResult> {
  const sourceLookupId = 'abuseipdb-lookup';
  const source = 'abuseipdb';

  // AbuseIPDB only supports IP lookups
  if (type !== 'ip') {
    return { source, status: 'error', error: 'AbuseIPDB only supports IP address lookups' };
  }

  // Check cache first
  const cached = await getCachedResult(sourceLookupId, type, value);
  if (cached) {
    return { source, status: 'cached', data: cached.data, cachedAt: cached.cachedAt };
  }

  // Check rate limit
  const rateCheck = checkRateLimit(source);
  if (!rateCheck.allowed) {
    return {
      source,
      status: 'rate_limited',
      error: `Rate limited. Retry after ${Math.ceil(rateCheck.retryAfterMs / 1000)}s`,
    };
  }

  // Check API key
  const apiKey = await getApiKey(source);
  if (!apiKey) {
    return { source, status: 'not_configured', error: 'AbuseIPDB API key not configured' };
  }

  // Make API call
  try {
    markQueryTime(source);
    const resp = await fetch(
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(value)}&maxAgeInDays=90&verbose=true`,
      {
        method: 'GET',
        headers: {
          'Key': apiKey,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (resp.status === 429) {
      return { source, status: 'rate_limited', error: 'AbuseIPDB API rate limit exceeded' };
    }

    if (!resp.ok) {
      return { source, status: 'error', error: `AbuseIPDB API returned ${resp.status}` };
    }

    const json = await resp.json();
    const data = json.data || {};

    const abuseScore = data.abuseConfidenceScore || 0;
    const totalReports = data.totalReports || 0;
    const isWhitelisted = data.isWhitelisted || false;

    // Whitelisted IPs are known-good — override severity to 'low' regardless of abuse score
    const isMalicious = !isWhitelisted && abuseScore >= 50;
    const isSuspicious = !isWhitelisted && abuseScore >= 10;
    const severity = isWhitelisted
      ? 'low'
      : abuseScore >= 75
        ? 'critical'
        : abuseScore >= 50
          ? 'high'
          : abuseScore >= 10
            ? 'medium'
            : 'low';

    const tags: string[] = [];
    if (data.usageType) tags.push(`usage:${data.usageType}`);
    if (data.isp) tags.push(`isp:${data.isp}`);
    if (data.countryCode) tags.push(`cc:${data.countryCode}`);
    if (data.domain) tags.push(`domain:${data.domain}`);

    const result: LookupResult['data'] = {
      isMalicious,
      isSuspicious,
      confidence: abuseScore,
      severity,
      tags,
      details: {
        abuseConfidenceScore: abuseScore,
        totalReports,
        isWhitelisted,
        countryCode: data.countryCode,
        isp: data.isp,
        usageType: data.usageType,
        hostname: data.hostnames || [],
        domain: data.domain,
      },
    };

    // Cache the result
    await cacheResult(sourceLookupId, type, value, result);

    return { source, status: 'queried', data: result, queriedAt: new Date().toISOString() };
  } catch (err: any) {
    if (err.name === 'TimeoutError') {
      return { source, status: 'error', error: 'AbuseIPDB API request timed out' };
    }
    return { source, status: 'error', error: err.message || 'AbuseIPDB API request failed' };
  }
}

// ─── ThreatBook Lookup (Reference) ────────────────────────────────────────────────
// ThreatBook is already handled in /api/threat-intel/route.ts
// This is a thin wrapper that checks cache and delegates

async function lookupThreatBook(
  type: string,
  value: string
): Promise<LookupResult> {
  const sourceLookupId = 'threatbook-lookup';
  const source = 'threatbook';

  // Check cache first
  const cached = await getCachedResult(sourceLookupId, type, value);
  if (cached) {
    return { source, status: 'cached', data: cached.data, cachedAt: cached.cachedAt };
  }

  // ThreatBook is handled by the main /api/threat-intel endpoint
  // Return a reference indicator so the client knows to use that endpoint
  return {
    source,
    status: 'not_configured',
    error: 'ThreatBook查询请使用 /api/threat-intel 端点，该端点已集成ThreatBook API',
  };
}

// ─── Main API Handler ─────────────────────────────────────────────────────────────

// NOTE: GET is publicly accessible — threat intel lookup does not require login
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'domain';
  const value = searchParams.get('value');

  if (!value) {
    return NextResponse.json(
      { error: 'Missing required parameter: value' },
      { status: 400 }
    );
  }

  if (!['domain', 'ip'].includes(type)) {
    return NextResponse.json(
      { error: 'type must be "domain" or "ip"' },
      { status: 400 }
    );
  }

  try {
    // Run all three lookups in parallel
    const [vtResult, abuseResult, tbResult] = await Promise.all([
      lookupVirusTotal(type, value),
      lookupAbuseIPDB(type, value),
      lookupThreatBook(type, value),
    ]);

    // Build overall assessment
    const allResults = [vtResult, abuseResult, tbResult];
    const queriedResults = allResults.filter(r => r.status === 'queried' || r.status === 'cached');
    const isMalicious = queriedResults.some(r => r.data?.isMalicious);
    const isSuspicious = queriedResults.some(r => r.data?.isSuspicious);

    return NextResponse.json({
      type,
      value,
      overall: {
        isMalicious,
        isSuspicious,
        reputation: isMalicious ? 'malicious' : isSuspicious ? 'suspicious' : 'unknown',
      },
      lookups: {
        virustotal: vtResult,
        abuseipdb: abuseResult,
        threatbook: tbResult,
      },
    });
  } catch (error) {
    console.error('Threat intel lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
