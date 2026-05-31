import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isValidIP } from '@/lib/security';
import { requireSessionAuth } from '@/lib/api-auth';
import { isSafeDomain, isSafeIP } from '@/lib/safe-domain-whitelist';

// Threat Intelligence API with local malicious DB priority check, then ThreatBook
// GET /api/threat-intel?type=domain&value=example.com
// GET /api/threat-intel?type=ip&value=1.2.3.4
// POST /api/threat-intel { type: 'domain'|'ip', values: string[] } — batch query

// --- ThreatBook API Integration ---

const THREATBOOK_API_KEY = process.env.THREATBOOK_API_KEY || '';
const THREATBOOK_AUTO_ADD = process.env.THREATBOOK_AUTO_ADD === 'true';
const THREATBOOK_BASE_URL = 'https://api.threatbook.cn/v3';

// --- LRU Cache with TTL ---

interface CacheEntry {
  data: any;
  timestamp: number;
  accessCount: number;
}

const MAX_CACHE_SIZE = 5000;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in ms
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes

class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private lastCleanup = Date.now();

  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key);
      return undefined;
    }

    // Update access count and move to end (LRU ordering)
    entry.accessCount++;
    this.cache.delete(key);
    this.cache.set(key, entry);

    // Periodic cleanup
    this.maybeCleanup();

    return entry;
  }

  set(key: string, data: any): void {
    // Remove if already exists (to move to end)
    this.cache.delete(key);

    // Evict oldest entries if at capacity
    if (this.cache.size >= MAX_CACHE_SIZE) {
      this.evictOldest(Math.floor(MAX_CACHE_SIZE * 0.1)); // evict 10%
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      accessCount: 0,
    });

    // Periodic cleanup
    this.maybeCleanup();
  }

  get size(): number {
    return this.cache.size;
  }

  private maybeCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup < CLEANUP_INTERVAL) return;
    this.lastCleanup = now;
    this.cleanup();
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  private evictOldest(count: number): void {
    let evicted = 0;
    for (const key of this.cache.keys()) {
      if (evicted >= count) break;
      this.cache.delete(key);
      evicted++;
    }
  }
}

const threatbookCache = new LRUCache();

// Rate limiting: max 1 request per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second

/**
 * Wait until enough time has passed since the last request (rate limiting)
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * Map ThreatBook judgment to our reputation levels
 */
function mapThreatBookJudgment(judgments: string[]): {
  reputation: string;
  isMalicious: boolean;
  isSuspicious: boolean;
} {
  if (!judgments || judgments.length === 0) {
    return { reputation: 'unknown', isMalicious: false, isSuspicious: false };
  }

  const hasMalicious = judgments.some(j =>
    j.includes('恶意') || j.toLowerCase().includes('malicious')
  );
  const hasSuspicious = judgments.some(j =>
    j.includes('可疑') || j.toLowerCase().includes('suspicious')
  );
  const hasSafe = judgments.some(j =>
    j.includes('安全') || j.toLowerCase().includes('safe') || j.toLowerCase().includes('clean')
  );

  if (hasMalicious) {
    return { reputation: 'malicious', isMalicious: true, isSuspicious: true };
  }
  if (hasSuspicious) {
    return { reputation: 'suspicious', isMalicious: false, isSuspicious: true };
  }
  if (hasSafe) {
    return { reputation: 'safe', isMalicious: false, isSuspicious: false };
  }

  return { reputation: 'unknown', isMalicious: false, isSuspicious: false };
}

/**
 * Map ThreatBook severity tags to our severity levels
 */
function mapThreatBookSeverity(tags: string[]): string {
  if (!tags || tags.length === 0) return 'medium';

  const tagStr = tags.join(' ').toLowerCase();

  if (tagStr.includes('c2') || tagStr.includes('远控') || tagStr.includes('botnet') || tagStr.includes('僵尸网络')) {
    return 'critical';
  }
  if (tagStr.includes('malware') || tagStr.includes('恶意软件') || tagStr.includes('ransomware') || tagStr.includes('勒索')) {
    return 'high';
  }
  if (tagStr.includes('phishing') || tagStr.includes('钓鱼') || tagStr.includes('spam') || tagStr.includes('垃圾')) {
    return 'medium';
  }

  return 'medium';
}

/**
 * Map ThreatBook tags to category
 */
function mapThreatBookCategory(tags: string[]): string | null {
  if (!tags || tags.length === 0) return null;

  const tagStr = tags.join(' ').toLowerCase();

  if (tagStr.includes('c2') || tagStr.includes('远控')) return 'c2';
  if (tagStr.includes('botnet') || tagStr.includes('僵尸网络')) return 'botnet';
  if (tagStr.includes('malware') || tagStr.includes('恶意软件')) return 'malware';
  if (tagStr.includes('phishing') || tagStr.includes('钓鱼')) return 'phishing';
  if (tagStr.includes('spam') || tagStr.includes('垃圾')) return 'spam';

  return 'other';
}

/**
 * Query ThreatBook API for IP reputation
 */
async function queryThreatBookIP(ip: string): Promise<{
  success: boolean;
  data?: {
    reputation: string;
    isMalicious: boolean;
    isSuspicious: boolean;
    confidence: number;
    tags: string[];
    judgments: string[];
    severity: string;
    category: string | null;
  };
  error?: string;
  status: 'success' | 'error' | 'rate_limited' | 'not_configured';
}> {
  if (!THREATBOOK_API_KEY) {
    return { success: false, status: 'not_configured', error: 'API key not configured' };
  }

  const cacheKey = `ip:${ip}`;

  const cached = threatbookCache.get(cacheKey);
  if (cached) {
    return { success: true, data: cached.data, status: 'success' };
  }

  try {
    await waitForRateLimit();

    const url = `${THREATBOOK_BASE_URL}/asset/ip?apikey=${encodeURIComponent(THREATBOOK_API_KEY)}&ip=${encodeURIComponent(ip)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 429) {
      return { success: false, status: 'rate_limited', error: 'ThreatBook API rate limit exceeded' };
    }

    if (!response.ok) {
      return { success: false, status: 'error', error: `ThreatBook API returned ${response.status}` };
    }

    const json = await response.json();

    if (json.response_code !== 0) {
      return {
        success: false,
        status: 'error',
        error: json.verbose_msg || `ThreatBook error code: ${json.response_code}`,
      };
    }

    const summary = json.data?.summary || {};
    const threatTags = json.data?.threat_tags || [];
    const confidence = json.data?.confidence || 0;
    const judgments: string[] = summary.judgments || [];
    const tags: string[] = [...(summary.tags || []), ...threatTags];

    const { reputation, isMalicious, isSuspicious } = mapThreatBookJudgment(judgments);
    const severity = mapThreatBookSeverity(tags);
    const category = mapThreatBookCategory(tags);

    const result = {
      reputation,
      isMalicious,
      isSuspicious,
      confidence,
      tags,
      judgments,
      severity,
      category,
    };

    threatbookCache.set(cacheKey, result);

    return { success: true, data: result, status: 'success' };
  } catch (err: any) {
    if (err.name === 'TimeoutError') {
      return { success: false, status: 'error', error: 'ThreatBook API request timed out' };
    }
    return { success: false, status: 'error', error: 'ThreatBook API request failed' };
  }
}

/**
 * Query ThreatBook API for domain reputation
 */
async function queryThreatBookDomain(domain: string): Promise<{
  success: boolean;
  data?: {
    reputation: string;
    isMalicious: boolean;
    isSuspicious: boolean;
    confidence: number;
    tags: string[];
    judgments: string[];
    severity: string;
    category: string | null;
  };
  error?: string;
  status: 'success' | 'error' | 'rate_limited' | 'not_configured';
}> {
  if (!THREATBOOK_API_KEY) {
    return { success: false, status: 'not_configured', error: 'API key not configured' };
  }

  const cacheKey = `domain:${domain}`;

  const cached = threatbookCache.get(cacheKey);
  if (cached) {
    return { success: true, data: cached.data, status: 'success' };
  }

  try {
    await waitForRateLimit();

    const url = `${THREATBOOK_BASE_URL}/asset/domain?apikey=${encodeURIComponent(THREATBOOK_API_KEY)}&domain=${encodeURIComponent(domain)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 429) {
      return { success: false, status: 'rate_limited', error: 'ThreatBook API rate limit exceeded' };
    }

    if (!response.ok) {
      return { success: false, status: 'error', error: `ThreatBook API returned ${response.status}` };
    }

    const json = await response.json();

    if (json.response_code !== 0) {
      return {
        success: false,
        status: 'error',
        error: json.verbose_msg || `ThreatBook error code: ${json.response_code}`,
      };
    }

    const summary = json.data?.summary || {};
    const threatTags = json.data?.threat_tags || [];
    const confidence = json.data?.confidence || 0;
    const judgments: string[] = summary.judgments || [];
    const tags: string[] = [...(summary.tags || []), ...threatTags];

    const { reputation, isMalicious, isSuspicious } = mapThreatBookJudgment(judgments);
    const severity = mapThreatBookSeverity(tags);
    const category = mapThreatBookCategory(tags);

    const result = {
      reputation,
      isMalicious,
      isSuspicious,
      confidence,
      tags,
      judgments,
      severity,
      category,
    };

    threatbookCache.set(cacheKey, result);

    return { success: true, data: result, status: 'success' };
  } catch (err: any) {
    if (err.name === 'TimeoutError') {
      return { success: false, status: 'error', error: 'ThreatBook API request timed out' };
    }
    return { success: false, status: 'error', error: 'ThreatBook API request failed' };
  }
}

/**
 * Auto-add a malicious entry to the local database if ThreatBook returns
 * a malicious verdict with high confidence and THREATBOOK_AUTO_ADD is enabled
 */
async function autoAddToMaliciousDB(
  type: 'domain' | 'ip',
  value: string,
  tbData: {
    isMalicious: boolean;
    confidence: number;
    tags: string[];
    severity: string;
    category: string | null;
    judgments: string[];
  }
): Promise<boolean> {
  if (!THREATBOOK_AUTO_ADD) return false;
  if (!tbData.isMalicious) return false;
  if (tbData.confidence < 80) return false;

  // Filter out safe domains/IPs — never auto-add well-known safe domains
  if (type === 'domain' && isSafeDomain(value)) {
    console.log(`  [autoAddToMaliciousDB] Skipping safe domain: ${value}`);
    return false;
  }
  if (type === 'ip' && isSafeIP(value)) {
    console.log(`  [autoAddToMaliciousDB] Skipping safe IP: ${value}`);
    return false;
  }

  try {
    const reason = `ThreatBook自动标记: ${tbData.judgments.join(', ')}`;
    const source = 'threatbook';
    const severity = tbData.severity;
    const category = tbData.category;

    if (type === 'ip') {
      const existing = await db.maliciousIP.findUnique({ where: { ip: value } });
      if (existing) return false;
      await db.maliciousIP.create({
        data: {
          ip: value,
          reason,
          source,
          severity,
          category,
          country: null,
        },
      });
    } else {
      const existing = await db.maliciousDomain.findUnique({ where: { domain: value } });
      if (existing) return false;
      await db.maliciousDomain.create({
        data: {
          domain: value,
          reason,
          source,
          severity,
          category,
        },
      });
    }
    return true;
  } catch (err) {
    console.error('Failed to auto-add to malicious DB:', err);
    return false;
  }
}

// --- Single value query logic ---

async function querySingleValue(type: string, value: string): Promise<any> {
  const isIP = type === 'ip' || isValidIP(value);

  // --- Priority 1: Check local malicious database ---
  let localMatch: any = null;

  try {
    if (isIP) {
      localMatch = await db.maliciousIP.findUnique({ where: { ip: value } });
    } else {
      localMatch = await db.maliciousDomain.findUnique({ where: { domain: value } });
    }
  } catch (err) {
    console.error('Failed to check local malicious DB:', err);
  }

  // If found in local DB, return immediately with high confidence
  if (localMatch) {
    const localResult = isIP
      ? {
          type: 'ip',
          value,
          threatIntel: {
            reputation: 'malicious',
            isMalicious: true,
            isSuspicious: true,
            abuseScore: 100,
            totalReports: 1,
            geoLocation: (localMatch as any).country || null,
            isp: null,
            associatedDomains: [],
            lastSeen: localMatch.updatedAt,
            tags: (localMatch as any).category ? [(localMatch as any).category] : [],
          },
          localDB: {
            matched: true,
            source: localMatch.source,
            severity: localMatch.severity,
            category: (localMatch as any).category,
            reason: localMatch.reason,
            addedAt: localMatch.createdAt,
          },
          sources: [
            { name: '本地恶意库', status: 'matched', result: '恶意' },
            { name: 'ThreatBook', status: 'not_integrated', result: null },
            { name: 'VirusTotal', status: 'lookup_available', result: null },
            { name: 'AbuseIPDB', status: 'lookup_available', result: null },
          ],
          disclaimer: '该IP/域名在本地恶意库中已被标记为恶意。VirusTotal/AbuseIPDB可通过查询接口获取更多信息。',
        }
      : {
          type: 'domain',
          value,
          threatIntel: {
            reputation: 'malicious',
            isMalicious: true,
            isSuspicious: true,
            categories: (localMatch as any).category ? [(localMatch as any).category] : [],
            domainAge: null,
            registrar: null,
            nameServers: [],
            associatedIPs: [],
            lastSeen: localMatch.updatedAt,
            tags: (localMatch as any).category ? [(localMatch as any).category] : [],
            vtPositives: 0,
            vtTotal: 0,
          },
          localDB: {
            matched: true,
            source: localMatch.source,
            severity: localMatch.severity,
            category: (localMatch as any).category,
            reason: localMatch.reason,
            addedAt: localMatch.createdAt,
          },
          sources: [
            { name: '本地恶意库', status: 'matched', result: '恶意' },
            { name: 'ThreatBook', status: 'not_integrated', result: null },
            { name: 'VirusTotal', status: 'lookup_available', result: null },
            { name: 'URLhaus', status: 'not_integrated', result: null },
            { name: 'PhishTank', status: 'not_integrated', result: null },
          ],
          disclaimer: '该域名在本地恶意库中已被标记为恶意。VirusTotal可通过查询接口获取更多信息。',
        };

    return localResult;
  }

  // --- Priority 2: Query ThreatBook API ---
  let threatbookResult: any = null;
  let threatbookSource: { name: string; status: string; result: string | null } = {
    name: 'ThreatBook',
    status: 'not_configured',
    result: '未配置',
  };
  let autoAdded = false;

  try {
    const tbResponse = isIP
      ? await queryThreatBookIP(value)
      : await queryThreatBookDomain(value);

    if (tbResponse.status === 'success' && tbResponse.data) {
      const tbData = tbResponse.data;
      threatbookResult = tbData;

      if (tbData.isMalicious) {
        threatbookSource = {
          name: 'ThreatBook',
          status: 'matched',
          result: `恶意 (置信度: ${tbData.confidence}%)`,
        };
      } else if (tbData.isSuspicious) {
        threatbookSource = {
          name: 'ThreatBook',
          status: 'suspicious',
          result: `可疑 (置信度: ${tbData.confidence}%)`,
        };
      } else {
        threatbookSource = {
          name: 'ThreatBook',
          status: 'clean',
          result: '安全',
        };
      }

      autoAdded = await autoAddToMaliciousDB(
        isIP ? 'ip' : 'domain',
        value,
        tbData
      );
    } else if (tbResponse.status === 'not_configured') {
      threatbookSource = {
        name: 'ThreatBook',
        status: 'not_configured',
        result: '未配置',
      };
    } else if (tbResponse.status === 'rate_limited') {
      threatbookSource = {
        name: 'ThreatBook',
        status: 'rate_limited',
        result: '限流',
      };
    } else {
      threatbookSource = {
        name: 'ThreatBook',
        status: 'error',
        result: '查询失败',
      };
    }
  } catch (err) {
    console.error('ThreatBook query error:', err);
    threatbookSource = {
      name: 'ThreatBook',
      status: 'error',
      result: '查询失败',
    };
  }

  // --- Priority 3: Check collected threat intel entries ---
  let threatIntelMatch = false;
  let threatIntelSources: string[] = [];
  if (!localMatch) {
    try {
      const entries = await db.threatIntelEntry.findMany({
        where: {
          type: isIP ? 'ip' : 'domain',
          value: value,
        },
        take: 10,
      });
      if (entries.length > 0) {
        threatIntelMatch = true;
        const sourceIds = [...new Set(entries.map(e => e.sourceId))];
        const sources = await db.threatIntelSource.findMany({
          where: { sourceId: { in: sourceIds } },
          select: { sourceId: true, name: true },
        });
        threatIntelSources = sources.map(s => s.name);
      }
    } catch {}
  }

  // --- Build response ---
  const tbIsMalicious = threatbookResult?.isMalicious || false;
  const tbIsSuspicious = threatbookResult?.isSuspicious || false;
  const tbConfidence = threatbookResult?.confidence || 0;
  const tbTags = threatbookResult?.tags || [];
  const tbJudgments = threatbookResult?.judgments || [];

  const overallIsMalicious = tbIsMalicious || threatIntelMatch;
  const overallIsSuspicious = tbIsSuspicious || threatIntelMatch;

  const threatIntelSourceEntry: { name: string; status: string; result: string | null } = threatIntelMatch
    ? { name: '威胁情报库', status: 'matched', result: `${threatIntelSources.join(', ')}命中` }
    : { name: '威胁情报库', status: 'not_found', result: null };

  const response = isIP
    ? {
        type: 'ip',
        value,
        threatIntel: {
          reputation: overallIsMalicious ? 'malicious' : overallIsSuspicious ? 'suspicious' : 'unknown',
          isMalicious: overallIsMalicious,
          isSuspicious: overallIsSuspicious,
          abuseScore: tbIsMalicious ? tbConfidence : 0,
          totalReports: tbIsMalicious ? 1 : 0,
          geoLocation: null,
          isp: null,
          associatedDomains: [],
          lastSeen: null,
          tags: tbTags,
          threatbookConfidence: tbConfidence,
          threatbookJudgments: tbJudgments,
        },
        localDB: { matched: false },
        threatIntelEntries: {
          matched: threatIntelMatch,
          sources: threatIntelSources,
        },
        threatbook: threatbookResult ? {
          queried: true,
          isMalicious: tbIsMalicious,
          isSuspicious: tbIsSuspicious,
          confidence: tbConfidence,
          tags: tbTags,
          judgments: tbJudgments,
          autoAdded,
        } : null,
        sources: [
          { name: '本地恶意库', status: 'not_found', result: null },
          threatbookSource,
          threatIntelSourceEntry,
          { name: 'VirusTotal', status: 'lookup_available', result: null },
          { name: 'AbuseIPDB', status: 'lookup_available', result: null },
        ],
        disclaimer: overallIsMalicious
          ? `ThreatBook标记为恶意（置信度${tbConfidence}%）。${autoAdded ? '已自动添加到本地恶意库。' : ''}${threatIntelMatch ? `威胁情报库命中（${threatIntelSources.join(', ')}）。` : ''}外部API数据持续集成中。`
          : '本地恶意库未命中，外部API待集成。可手动将此IP添加到恶意库。',
      }
    : {
        type: 'domain',
        value,
        threatIntel: {
          reputation: overallIsMalicious ? 'malicious' : overallIsSuspicious ? 'suspicious' : 'unknown',
          isMalicious: overallIsMalicious,
          isSuspicious: overallIsSuspicious,
          categories: threatbookResult?.category ? [threatbookResult.category] : [],
          domainAge: null,
          registrar: null,
          nameServers: [],
          associatedIPs: [],
          lastSeen: null,
          tags: tbTags,
          vtPositives: 0,
          vtTotal: 0,
          threatbookConfidence: tbConfidence,
          threatbookJudgments: tbJudgments,
        },
        localDB: { matched: false },
        threatIntelEntries: {
          matched: threatIntelMatch,
          sources: threatIntelSources,
        },
        threatbook: threatbookResult ? {
          queried: true,
          isMalicious: tbIsMalicious,
          isSuspicious: tbIsSuspicious,
          confidence: tbConfidence,
          tags: tbTags,
          judgments: tbJudgments,
          autoAdded,
        } : null,
        sources: [
          { name: '本地恶意库', status: 'not_found', result: null },
          threatbookSource,
          threatIntelSourceEntry,
          { name: 'VirusTotal', status: 'lookup_available', result: null },
          { name: 'URLhaus', status: 'not_integrated', result: null },
          { name: 'PhishTank', status: 'not_integrated', result: null },
        ],
        disclaimer: overallIsMalicious
          ? `ThreatBook标记为恶意（置信度${tbConfidence}%）。${autoAdded ? '已自动添加到本地恶意库。' : ''}${threatIntelMatch ? `威胁情报库命中（${threatIntelSources.join(', ')}）。` : ''}外部API数据持续集成中。`
          : '本地恶意库未命中，外部API待集成。可手动将此域名添加到恶意库。',
      };

  return response;
}

// --- Main API Handlers ---

// NOTE: GET is publicly accessible — querying threat intel does not require login
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

  try {
    const result = await querySingleValue(type, value);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Threat intel query error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/threat-intel — Batch query support
// Body: { type: 'domain'|'ip', values: string[] }
export async function POST(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  try {
    const body = await request.json();
    const { type, values } = body;

    if (!type || !['domain', 'ip'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "domain" or "ip"' },
        { status: 400 }
      );
    }

    if (!values || !Array.isArray(values) || values.length === 0) {
      return NextResponse.json(
        { error: 'values must be a non-empty array of strings' },
        { status: 400 }
      );
    }

    // Limit batch size to prevent abuse
    if (values.length > 100) {
      return NextResponse.json(
        { error: 'Batch size limited to 100 values per request' },
        { status: 400 }
      );
    }

    // Deduplicate values
    const uniqueValues = [...new Set(values.map(v => v.trim()).filter(v => v.length > 0))];

    // --- Batch local DB lookup ---
    const isIP = type === 'ip';

    let localMatches: any[] = [];
    try {
      if (isIP) {
        localMatches = await db.maliciousIP.findMany({
          where: { ip: { in: uniqueValues } },
        });
      } else {
        localMatches = await db.maliciousDomain.findMany({
          where: { domain: { in: uniqueValues } },
        });
      }
    } catch (err) {
      console.error('Failed to batch check local malicious DB:', err);
    }

    // Build lookup map from local matches
    const localMatchMap = new Map<string, any>();
    for (const match of localMatches) {
      const key = isIP ? match.ip : match.domain;
      localMatchMap.set(key, match);
    }

    // --- Batch threat intel entries lookup ---
    let intelEntries: any[] = [];
    try {
      intelEntries = await db.threatIntelEntry.findMany({
        where: {
          type,
          value: { in: uniqueValues },
        },
        take: 1000,
      });
    } catch (err) {
      console.error('Failed to batch check threat intel entries:', err);
    }

    // Build lookup map from threat intel entries
    const intelEntryMap = new Map<string, any[]>();
    for (const entry of intelEntries) {
      const existing = intelEntryMap.get(entry.value) || [];
      existing.push(entry);
      intelEntryMap.set(entry.value, existing);
    }

    // --- Build results for each value ---
    const results: Record<string, any> = {};
    const valuesNeedingThreatBook: string[] = [];

    for (const value of uniqueValues) {
      const localMatch = localMatchMap.get(value);
      const intelMatches = intelEntryMap.get(value) || [];

      if (localMatch) {
        // Local DB match — no need for ThreatBook query
        results[value] = {
          type,
          value,
          threatIntel: {
            reputation: 'malicious',
            isMalicious: true,
            isSuspicious: true,
            tags: localMatch.category ? [localMatch.category] : [],
          },
          localDB: {
            matched: true,
            source: localMatch.source,
            severity: localMatch.severity,
            category: localMatch.category,
            reason: localMatch.reason,
          },
          threatIntelEntries: {
            matched: intelMatches.length > 0,
            sources: intelMatches.length > 0 ? [...new Set(intelMatches.map(e => e.sourceId))] : [],
          },
        };
      } else {
        // No local match — check ThreatBook (but only for a limited set due to rate limiting)
        valuesNeedingThreatBook.push(value);

        // Provide preliminary result with local data
        const intelSources = intelMatches.length > 0
          ? await db.threatIntelSource.findMany({
              where: { sourceId: { in: [...new Set(intelMatches.map(e => e.sourceId))] } },
              select: { sourceId: true, name: true },
            })
          : [];

        results[value] = {
          type,
          value,
          threatIntel: {
            reputation: intelMatches.length > 0 ? 'suspicious' : 'unknown',
            isMalicious: false,
            isSuspicious: intelMatches.length > 0,
            tags: [],
          },
          localDB: { matched: false },
          threatIntelEntries: {
            matched: intelMatches.length > 0,
            sources: intelSources.map(s => s.name),
          },
          threatbook: null,
        };
      }
    }

    // --- Query ThreatBook for values not in local DB (limited to 10 per batch to respect rate limits) ---
    const threatBookValues = valuesNeedingThreatBook.slice(0, 10);

    for (const value of threatBookValues) {
      try {
        const tbResponse = isIP
          ? await queryThreatBookIP(value)
          : await queryThreatBookDomain(value);

        if (tbResponse.status === 'success' && tbResponse.data) {
          const tbData = tbResponse.data;
          const existing = results[value];

          results[value] = {
            ...existing,
            threatIntel: {
              ...existing.threatIntel,
              reputation: tbData.isMalicious ? 'malicious' : tbData.isSuspicious ? 'suspicious' : existing.threatIntel.reputation,
              isMalicious: tbData.isMalicious || existing.threatIntel.isMalicious,
              isSuspicious: tbData.isSuspicious || existing.threatIntel.isSuspicious,
              threatbookConfidence: tbData.confidence,
              threatbookJudgments: tbData.judgments,
              tags: tbData.tags,
            },
            threatbook: {
              queried: true,
              isMalicious: tbData.isMalicious,
              isSuspicious: tbData.isSuspicious,
              confidence: tbData.confidence,
              tags: tbData.tags,
              judgments: tbData.judgments,
            },
          };

          // Auto-add if configured
          if (tbData.isMalicious) {
            await autoAddToMaliciousDB(isIP ? 'ip' : 'domain', value, tbData);
          }
        }
      } catch (err) {
        console.error(`ThreatBook query failed for ${value}:`, err);
      }
    }

    // If there were more values than we could query ThreatBook for, note it
    const skippedThreatBook = valuesNeedingThreatBook.length - threatBookValues.length;

    return NextResponse.json({
      type,
      count: uniqueValues.length,
      results,
      meta: {
        localDBMatches: localMatches.length,
        intelEntryMatches: intelEntries.length,
        threatBookQueried: threatBookValues.length,
        threatBookSkipped: skippedThreatBook,
        cacheSize: threatbookCache.size,
      },
    });
  } catch (error) {
    console.error('Batch threat intel query error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
