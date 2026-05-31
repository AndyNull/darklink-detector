import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSessionAuth } from '@/lib/api-auth';
import { rsaDecrypt, getSessionFromRequest } from '@/lib/server-config';
import { auditLog } from '@/lib/audit-logger';

// --- Constants ---

// GET /api/threat-intel-sources — Collection function for threat intel sources
// This route is also used by the update endpoint for collection functions

const USER_AGENT = 'DarkLink-Detector/1.0 (https://github.com/darklink-detector)';
const STORE_LIMIT = 50000; // Max entries per source per type - allow up to 50K for large datasets
const DEFAULT_TIMEOUT = 60000; // 60s default timeout for large datasets
const MAX_RETRIES = 3;

// --- Helper: Fetch with Retry ---

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  const mergedOptions: RequestInit = {
    ...options,
    headers: {
      'User-Agent': USER_AGENT,
      ...(options.headers || {}),
    },
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options.signal ? DEFAULT_TIMEOUT : DEFAULT_TIMEOUT
      );

      const response = await fetch(url, {
        ...mergedOptions,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        return response;
      }

      // For 429 (rate limited) or 5xx errors, retry with backoff
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.warn(
          `Fetch ${url} returned ${response.status}, retrying in ${Math.round(backoffMs)}ms (attempt ${attempt + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        lastError = new Error(`HTTP ${response.status} after ${attempt + 1} attempts`);
        continue;
      }

      // For other HTTP errors, return the response and let the caller handle it
      return response;
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.warn(
          `Fetch ${url} failed: ${err.message}, retrying in ${Math.round(backoffMs)}ms (attempt ${attempt + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError || new Error(`Fetch failed after ${maxRetries + 1} attempts: ${url}`);
}

// --- Default Sources Config ---

const DEFAULT_SOURCES = [
  {
    sourceId: 'alienvault-otx',
    name: 'AlienVault OTX',
    nameEn: 'AlienVault OTX',
    description: '开放威胁交换平台，需配置API Key才能采集数据（免费注册获取）',
    enabled: false,
    requiresApiKey: true,
  },
  {
    sourceId: 'threatfox',
    name: 'ThreatFox',
    nameEn: 'ThreatFox',
    description: 'abuse.ch提供的恶意IOC指标共享平台',
    enabled: true,
    requiresApiKey: false,
  },
  {
    sourceId: 'openphish',
    name: 'OpenPhish',
    nameEn: 'OpenPhish',
    description: '开放钓鱼网站数据源，实时更新钓鱼URL列表',
    enabled: true,
    requiresApiKey: false,
  },
  {
    sourceId: 'urlhaus',
    name: 'URLhaus',
    nameEn: 'URLhaus',
    description: 'abuse.ch提供的恶意URL分发平台数据',
    enabled: true,
    requiresApiKey: false,
  },
  {
    sourceId: 'botvrij',
    name: 'Botvrij.eu',
    nameEn: 'Botvrij.eu',
    description: '荷兰国家网络安全中心提供的IOC指标数据（服务可能不稳定）',
    enabled: false,
    requiresApiKey: false,
  },
  {
    sourceId: 'phishtank',
    name: 'PhishTank',
    nameEn: 'PhishTank',
    description: '社区驱动的钓鱼网站验证和报告平台，提供在线验证的钓鱼URL数据',
    enabled: true,
    requiresApiKey: false,
  },
  {
    sourceId: 'cins-army',
    name: 'CINS Army',
    nameEn: 'CINS Army',
    description: 'CINS Score提供的恶意IP情报，包含大量低信誉度IP地址',
    enabled: true,
    requiresApiKey: false,
  },
  {
    sourceId: 'spamhaus-drop',
    name: 'Spamhaus DROP',
    nameEn: 'Spamhaus DROP',
    description: 'Spamhaus提供的DROP/eDROP列表，已验证的垃圾邮件和恶意软件源IP段',
    enabled: true,
    requiresApiKey: false,
  },
  {
    sourceId: 'virustotal',
    name: 'VirusTotal',
    nameEn: 'VirusTotal',
    description: '多引擎恶意软件扫描和威胁情报聚合平台',
    enabled: false,
    requiresApiKey: true,
  },
  {
    sourceId: 'threatbook',
    name: '微步在线',
    nameEn: 'ThreatBook',
    description: '中国威胁情报平台，提供域名/IP威胁分析',
    enabled: false,
    requiresApiKey: true,
  },
  {
    sourceId: 'abuseipdb',
    name: 'AbuseIPDB',
    nameEn: 'AbuseIPDB',
    description: '社区驱动的恶意IP报告和查询平台',
    enabled: false,
    requiresApiKey: true,
  },
];

// --- Concurrency Helper ---

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

// --- Seed Sources ---

async function seedSources() {
  // Note: This function is also called by the update route; auth is checked at the route handler level
  // Always ensure all default sources exist and their config is up to date
  // Run all upserts in parallel for faster seeding
  await Promise.all(
    DEFAULT_SOURCES.map((source) =>
      db.threatIntelSource.upsert({
        where: { sourceId: source.sourceId },
        create: {
          sourceId: source.sourceId,
          name: source.name,
          nameEn: source.nameEn,
          description: source.description,
          enabled: source.enabled,
          requiresApiKey: source.requiresApiKey,
          status: 'idle',
          entryCount: 0,
        },
        update: {
          name: source.name,
          nameEn: source.nameEn,
          description: source.description,
          requiresApiKey: source.requiresApiKey,
        },
      })
    )
  );
}

// --- Collection Functions ---

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

// --- AlienVault OTX ---

async function collectAlienVaultOTX(apiKey?: string): Promise<{ domains: string[]; ips: string[] }> {
  const domains: string[] = [];
  const ips: string[] = [];

  if (!apiKey) {
    throw new Error('AlienVault OTX需要API密钥，请在设置中配置后重试（OTX API Key可在alienvault.com免费注册获取）');
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'X-OTX-API-KEY': apiKey,
    };

    // Helper to extract indicators from pulse data
    const extractFromPulses = (pulses: any[]) => {
      for (const pulse of pulses) {
        const indicators = pulse?.indicators || [];
        for (const ind of indicators) {
          if (!ind?.indicator) continue;

          if (ind.type === 'domain' || ind.type === 'hostname') {
            domains.push(ind.indicator);
          } else if (ind.type === 'IPv4') {
            if (IP_REGEX.test(ind.indicator)) {
              ips.push(ind.indicator);
            }
          } else if (ind.type === 'URL') {
            try {
              const hostname = new URL(ind.indicator).hostname;
              if (IP_REGEX.test(hostname)) {
                ips.push(hostname);
              } else {
                domains.push(hostname);
              }
            } catch {
              /* skip malformed URLs */
            }
          } else if (ind.type === 'email') {
            // Skip email indicators
          }
        }
      }
    };

    // 1. Paginated subscribed pulses (up to 5 pages of 50 each)
    for (let page = 1; page <= 5; page++) {
      try {
        const res = await fetchWithRetry(
          `https://otx.alienvault.com/api/v1/pulses/subscribed?limit=50&page=${page}`,
          { headers, signal: AbortSignal.timeout(25000) }
        );
        if (!res.ok) break;
        const data = await res.json();
        const pulses = data?.results || [];
        if (pulses.length === 0) break;
        extractFromPulses(pulses);
        if (domains.length >= STORE_LIMIT && ips.length >= STORE_LIMIT) break;
      } catch {
        break;
      }
    }
    console.log(`AlienVault OTX: after subscribed pulses - ${domains.length} domains, ${ips.length} IPs`);

    // 2. Search pulses with various keywords (increased limit to 50, more keywords)
    const searchKeywords = ['malware', 'phishing', 'botnet', 'c2', 'ransomware', 'apt', 'trojan', 'spam', 'exploit'];
    for (const keyword of searchKeywords) {
      if (domains.length >= STORE_LIMIT && ips.length >= STORE_LIMIT) break;
      try {
        const res = await fetchWithRetry(
          `https://otx.alienvault.com/api/v1/search/pulses?q=${encodeURIComponent(keyword)}&limit=50`,
          { headers, signal: AbortSignal.timeout(20000) }
        );
        if (!res.ok) continue;
        const data = await res.json();
        const pulses = data?.results || [];
        extractFromPulses(pulses);
      } catch {
        // Continue with next keyword
      }
    }
    console.log(`AlienVault OTX: after search pulses - ${domains.length} domains, ${ips.length} IPs`);

    // 3. Try the bulk indicators export endpoint
    try {
      const exportTypes = ['domain', 'IPv4', 'hostname', 'URL'];
      for (const exportType of exportTypes) {
        if (domains.length >= STORE_LIMIT && ips.length >= STORE_LIMIT) break;
        const res = await fetchWithRetry(
          `https://otx.alienvault.com/api/v1/indicators/export?type=${encodeURIComponent(exportType)}&limit=500`,
          { headers, signal: AbortSignal.timeout(30000) }
        );
        if (!res.ok) continue;
        const text = await res.text();
        // Export endpoint returns plain text, one indicator per line
        const lines = text.split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          const val = line.trim();
          if (!val) continue;
          if (exportType === 'domain' || exportType === 'hostname') {
            if (val.includes('.') && !IP_REGEX.test(val)) {
              domains.push(val);
            }
          } else if (exportType === 'IPv4') {
            if (IP_REGEX.test(val)) {
              ips.push(val);
            }
          } else if (exportType === 'URL') {
            try {
              const hostname = new URL(val).hostname;
              if (IP_REGEX.test(hostname)) {
                ips.push(hostname);
              } else {
                domains.push(hostname);
              }
            } catch {
              /* skip malformed URLs */
            }
          }
        }
      }
      console.log(`AlienVault OTX: after bulk export - ${domains.length} domains, ${ips.length} IPs`);
    } catch (err) {
      console.warn('AlienVault OTX bulk export endpoint failed:', err);
    }

    if (domains.length === 0 && ips.length === 0) {
      throw new Error(
        'AlienVault OTX公开API未能返回数据，可能是网络超时或API限制。如已配置API Key，请确认密钥有效'
      );
    }

    console.log(`AlienVault OTX: collected ${domains.length} domains, ${ips.length} IPs total`);
  } catch (err) {
    console.error('AlienVault OTX collection error:', err);
    throw err;
  }

  return { domains, ips };
}

// --- ThreatFox ---

async function collectThreatFox(): Promise<{ domains: string[]; ips: string[] }> {
  const domains: string[] = [];
  const ips: string[] = [];

  // Primary: POST API with search query
  try {
    const res = await fetchWithRetry('https://threatfox.abuse.ch/api/v1/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      body: JSON.stringify({ query: 'search', search_term: 'botnet' }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (res.ok) {
      const data = await res.json();

      // ThreatFox API response: { query_status: "ok", data: [...] }
      const entries = data?.data || [];

      for (const entry of entries) {
        const ioc = entry?.ioc_value || '';
        const iocType = entry?.ioc_type || '';
        if (!ioc) continue;

        if (iocType === 'domain' || iocType === 'hostname') {
          domains.push(ioc);
        } else if (iocType === 'ip:port') {
          const ip = ioc.split(':')[0];
          if (IP_REGEX.test(ip)) ips.push(ip);
        } else if (IP_REGEX.test(ioc)) {
          ips.push(ioc);
        } else if (ioc.includes('.') && !ioc.includes('/')) {
          domains.push(ioc);
        }
      }
    }
  } catch (err) {
    console.warn('ThreatFox POST API failed, trying recent export fallback:', err);
  }

  // Fallback: Recent export endpoint
  if (domains.length === 0 && ips.length === 0) {
    try {
      const res = await fetchWithRetry('https://threatfox.abuse.ch/export/json/recent/', {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = await res.text();
      const jsonStart = text.indexOf('{');
      if (jsonStart < 0) throw new Error('Invalid ThreatFox format');

      const jsonText = text.substring(jsonStart);
      const data = JSON.parse(jsonText);

      for (const entries of Object.values(data) as any[][]) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          const ioc = entry?.ioc_value || '';
          const iocType = entry?.ioc_type || '';
          if (!ioc) continue;

          if (iocType === 'domain' || iocType === 'hostname') {
            domains.push(ioc);
          } else if (iocType === 'ip:port') {
            const ip = ioc.split(':')[0];
            if (IP_REGEX.test(ip)) ips.push(ip);
          } else if (IP_REGEX.test(ioc)) {
            ips.push(ioc);
          } else if (ioc.includes('.') && !ioc.includes('/')) {
            domains.push(ioc);
          }
        }
      }
    } catch (err) {
      console.error('ThreatFox recent export fallback also failed:', err);
    }
  }

  if (domains.length === 0 && ips.length === 0) {
    throw new Error('ThreatFox采集失败：POST API和最近导出均不可用，请稍后重试');
  }

  return { domains, ips };
}

// --- OpenPhish ---

async function collectOpenPhish(): Promise<{ domains: string[]; ips: string[] }> {
  const domains: string[] = [];
  const ips: string[] = [];

  try {
    const res = await fetchWithRetry('https://openphish.com/feed.txt', {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/plain',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      throw new Error(`OpenPhish返回HTTP ${res.status}，无法获取钓鱼URL列表`);
    }

    const text = await res.text();

    if (!text.trim()) {
      throw new Error('OpenPhish返回空数据，数据源可能暂时不可用');
    }

    const urls = text.split('\n').filter((l: string) => l.trim().startsWith('http'));

    for (const url of urls) {
      try {
        const hostname = new URL(url.trim()).hostname;
        if (IP_REGEX.test(hostname)) {
          ips.push(hostname);
        } else {
          domains.push(hostname);
        }
      } catch {
        // skip malformed URLs
      }
    }

    if (domains.length === 0 && ips.length === 0) {
      throw new Error('OpenPhish数据解析结果为空，可能数据格式已变更');
    }
  } catch (err) {
    console.error('OpenPhish collection error:', err);
    throw err;
  }

  return { domains, ips };
}

// --- URLhaus ---

async function collectURLhaus(): Promise<{ domains: string[]; ips: string[] }> {
  const domains: string[] = [];
  const ips: string[] = [];

  // Primary: Plain text URL list (most reliable, ~76K URLs)
  try {
    const res = await fetchWithRetry('https://urlhaus.abuse.ch/downloads/text/', {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/plain',
      },
      signal: AbortSignal.timeout(120000), // Large file (~76K URLs), need more time
    });

    if (res.ok) {
      const text = await res.text();
      const urls = text.split('\n').filter((l: string) => l.trim().startsWith('http'));

      // Process up to 2000 URLs to keep it manageable
      for (const url of urls.slice(0, 20000)) {
        try {
          const hostname = new URL(url.trim()).hostname;
          if (IP_REGEX.test(hostname)) {
            ips.push(hostname);
          } else {
            domains.push(hostname);
          }
        } catch {
          // skip malformed URLs
        }
      }
    }
  } catch (err) {
    console.warn('URLhaus text download failed, trying POST API fallback:', err);
  }

  // Fallback: POST API
  if (domains.length === 0 && ips.length === 0) {
    try {
      const res = await fetchWithRetry('https://urlhaus.abuse.ch/api/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        body: 'query=get_urls&limit=100',
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      });

      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith('{')) {
          const data = JSON.parse(text);
          const urls = data?.urls || [];

          for (const entry of urls) {
            const url = entry?.url || '';
            try {
              const hostname = new URL(url).hostname;
              if (IP_REGEX.test(hostname)) {
                ips.push(hostname);
              } else {
                domains.push(hostname);
              }
            } catch {
              // skip malformed URLs
            }
          }
        }
      }
    } catch (err) {
      console.error('URLhaus POST API fallback also failed:', err);
    }
  }

  if (domains.length === 0 && ips.length === 0) {
    throw new Error('URLhaus采集失败：文本列表和API端点均不可用，请稍后重试');
  }

  return { domains, ips };
}

// --- Botvrij.eu ---

async function collectBotvrij(): Promise<{ domains: string[]; ips: string[] }> {
  const domains: string[] = [];
  const ips: string[] = [];

  // Botvrij.eu data URLs - try multiple formats
  const ipUrls = [
    'https://botvrij.eu/data/ioclist.ip',
    'https://data.botvrij.eu/ioclist.ip',
  ];
  const domainUrls = [
    'https://botvrij.eu/data/ioclist.domain',
    'https://data.botvrij.eu/ioclist.domain',
  ];

  // Collect IP IOC list - try each URL
  for (const url of ipUrls) {
    try {
      const res = await fetchWithRetry(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/plain',
        },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      });

      if (!res.ok) continue;

      const text = await res.text();
      const lines = text.split('\n').filter((l: string) => l.trim());

      for (const line of lines) {
        if (line.startsWith('#') || line.startsWith('//')) continue;
        const ip = line.split(',')[0].trim().split(';')[0].trim();
        if (IP_REGEX.test(ip)) {
          ips.push(ip);
        }
      }

      // If we got results, no need to try the next URL
      if (ips.length > 0) break;
    } catch (err) {
      console.warn(`Botvrij IP list fetch from ${url} failed:`, err);
    }
  }

  // Collect Domain IOC list - try each URL
  for (const url of domainUrls) {
    try {
      const res = await fetchWithRetry(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/plain',
        },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      });

      if (!res.ok) continue;

      const text = await res.text();
      const lines = text.split('\n').filter((l: string) => l.trim());

      for (const line of lines) {
        if (line.startsWith('#') || line.startsWith('//')) continue;
        const domain = line.split(',')[0].trim().split(';')[0].trim();
        if (domain && domain.includes('.') && !IP_REGEX.test(domain) && !domain.startsWith('http')) {
          domains.push(domain);
        }
      }

      if (domains.length > 0) break;
    } catch (err) {
      console.warn(`Botvrij domain list fetch from ${url} failed:`, err);
    }
  }

  if (domains.length === 0 && ips.length === 0) {
    throw new Error('Botvrij.eu采集失败：IP和域名IOC列表均不可用，服务可能暂时不可达');
  }

  return { domains, ips };
}

// --- PhishTank (replaces SSL Blacklist) ---

async function collectPhishTank(): Promise<{ domains: string[]; ips: string[] }> {
  const domains: string[] = [];
  const ips: string[] = [];

  // PhishTank free online search - extract from their public data
  try {
    // Use the free PhishTank validation feed (no API key needed)
    const res = await fetchWithRetry('https://data.phishtank.com/data/online-valid.csv', {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/csv, text/plain, */*',
      },
      signal: AbortSignal.timeout(45000), // Larger file
    });

    if (res.ok) {
      const text = await res.text();
      const lines = text.split('\n').filter((l: string) => l.trim());

      // Skip header line, parse CSV
      // Format: phish_id,url,phish_detail_url,submission_time,verified,verification_time,online,target
      for (const line of lines.slice(1)) {
        try {
          // Simple CSV parse - find the URL field (2nd column)
          const firstComma = line.indexOf(',');
          const secondComma = line.indexOf(',', firstComma + 1);
          if (firstComma < 0 || secondComma < 0) continue;

          const urlStr = line.substring(firstComma + 1, secondComma).replace(/"/g, '').trim();
          if (!urlStr.startsWith('http')) continue;

          const hostname = new URL(urlStr).hostname;
          if (IP_REGEX.test(hostname)) {
            ips.push(hostname);
          } else if (hostname.includes('.')) {
            domains.push(hostname);
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  } catch (err) {
    console.warn('PhishTank CSV feed failed:', err);
  }

  // Fallback: Use OpenPhish API as secondary source for phishing data
  if (domains.length === 0 && ips.length === 0) {
    // Already covered by OpenPhish, but add some well-known phishing domains
    throw new Error('PhishTank采集失败：在线验证数据不可用，请稍后重试');
  }

  return { domains, ips };
}

// --- CINS Army (Cheap/Free IP threat intelligence) ---

async function collectCINSArmy(): Promise<{ domains: string[]; ips: string[] }> {
  const ips: string[] = [];
  const domains: string[] = [];

  // CINS Army list - list of IPs with poor reputation
  try {
    const res = await fetchWithRetry('https://cinsscore.com/list/ci-badguys.txt', {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/plain',
      },
      signal: AbortSignal.timeout(60000),
    });

    if (res.ok) {
      const text = await res.text();
      const lines = text.split('\n').filter((l: string) => l.trim());

      for (const line of lines) {
        const ip = line.trim().split('/')[0].split(' ')[0];
        if (IP_REGEX.test(ip)) {
          ips.push(ip);
        }
      }
    }
  } catch (err) {
    console.warn('CINS Army list fetch failed:', err);
  }

  if (ips.length === 0 && domains.length === 0) {
    throw new Error('CINS Army采集失败：IP列表不可用，请稍后重试');
  }

  return { domains, ips };
}

// --- Spamhaus DROP (Don't Route Or Peer) ---

async function collectSpamhausDROP(): Promise<{ domains: string[]; ips: string[] }> {
  const ips: string[] = [];
  const domains: string[] = [];

  // Spamhaus DROP list - verified spam/malware source networks
  const endpoints = [
    { url: 'https://www.spamhaus.org/drop/drop.txt', name: 'DROP' },
    { url: 'https://www.spamhaus.org/drop/edrop.txt', name: 'eDROP' },
  ];

  for (const { url, name } of endpoints) {
    try {
      const res = await fetchWithRetry(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/plain',
        },
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) continue;

      const text = await res.text();
      const lines = text.split('\n').filter((l: string) => l.trim() && !l.startsWith(';'));

      for (const line of lines) {
        // Format: 1.2.3.0/24 ; SBL12345 ; 2020-01-01 ; ...
        const parts = line.split(';');
        if (parts.length > 0) {
          const cidr = parts[0].trim();
          // Extract the base IP from CIDR notation
          const ip = cidr.split('/')[0];
          if (IP_REGEX.test(ip)) {
            ips.push(ip);
          }
        }
      }

      if (ips.length > 0) {
        console.log(`Spamhaus ${name}: found ${ips.length} IPs`);
      }
    } catch (err) {
      console.warn(`Spamhaus ${name} fetch failed:`, err);
    }
  }

  if (ips.length === 0 && domains.length === 0) {
    throw new Error('Spamhaus DROP采集失败：IP列表不可用，请稍后重试');
  }

  return { domains, ips };
}

// --- VirusTotal ---

async function collectVirusTotal(apiKey?: string): Promise<{ domains: string[]; ips: string[] }> {
  const domains: string[] = [];
  const ips: string[] = [];

  if (!apiKey) {
    throw new Error('VirusTotal需要API密钥，请在设置中配置后重试（可在virustotal.com免费注册获取）');
  }

  try {
    // Get recent malicious domains from VT
    const headers: Record<string, string> = {
      'x-apikey': apiKey,
      'Accept': 'application/json',
    };

    // Search for recently detected malicious domains
    const endpoints = [
      'https://www.virustotal.com/api/v3/intelligence/search?query=tag:phishing+fs:1d+&limit=40',
      'https://www.virustotal.com/api/v3/intelligence/search?query=tag:malware+fs:1d+&limit=40',
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await fetchWithRetry(endpoint, {
          headers,
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) continue;

        const data = await res.json();
        const entries = data?.data || [];

        for (const entry of entries) {
          const id = entry?.id || '';
          const typeTag = entry?.type || '';
          if (!id) continue;

          if (typeTag === 'ip_address') {
            if (IP_REGEX.test(id)) ips.push(id);
          } else {
            // domain or URL
            if (IP_REGEX.test(id)) {
              ips.push(id);
            } else if (id.includes('.') && !id.startsWith('http')) {
              domains.push(id);
            } else if (id.startsWith('http')) {
              try {
                const hostname = new URL(id).hostname;
                if (IP_REGEX.test(hostname)) ips.push(hostname);
                else domains.push(hostname);
              } catch {}
            }
          }
        }

        if (domains.length > 30 || ips.length > 30) break;
      } catch {
        continue;
      }
    }

    if (domains.length === 0 && ips.length === 0) {
      throw new Error('VirusTotal采集失败：API未返回数据，请确认API Key有效且有查询配额');
    }
  } catch (err) {
    console.error('VirusTotal collection error:', err);
    throw err;
  }

  return { domains, ips };
}

// --- AbuseIPDB ---

async function collectAbuseIPDB(apiKey?: string): Promise<{ domains: string[]; ips: string[] }> {
  const ips: string[] = [];
  const domains: string[] = [];

  if (!apiKey) {
    throw new Error('AbuseIPDB需要API密钥，请在设置中配置后重试（可在abuseipdb.com免费注册获取）');
  }

  try {
    const res = await fetchWithRetry('https://api.abuseipdb.com/api/v2/blacklist', {
      headers: {
        'Key': apiKey,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      throw new Error(`AbuseIPDB返回HTTP ${res.status}，请确认API Key有效`);
    }

    const data = await res.json();
    const entries = data?.data || [];

    for (const entry of entries) {
      const ip = entry?.ipAddress || '';
      if (IP_REGEX.test(ip)) {
        ips.push(ip);
      }
    }

    if (ips.length === 0) {
      throw new Error('AbuseIPDB采集失败：未获取到恶意IP数据，请确认API Key有效且有查询配额');
    }
  } catch (err) {
    console.error('AbuseIPDB collection error:', err);
    throw err;
  }

  return { domains, ips };
}

// --- Collection Router ---

const COLLECTION_MAP: Record<string, (apiKey?: string) => Promise<{ domains: string[]; ips: string[] }>> = {
  'alienvault-otx': collectAlienVaultOTX,
  'threatfox': collectThreatFox,
  'openphish': collectOpenPhish,
  'phishtank': collectPhishTank,
  'urlhaus': collectURLhaus,
  'botvrij': collectBotvrij,
  'cins-army': collectCINSArmy,
  'spamhaus-drop': collectSpamhausDROP,
  'virustotal': collectVirusTotal,
  'abuseipdb': collectAbuseIPDB,
};

// --- Store Entries ---

async function storeEntries(sourceId: string, domains: string[], ips: string[]) {
  const storeStartTime = Date.now();
  let entryCount = 0;
  const BATCH_SIZE = 500;

  // Delete existing entries for this source (incremental update: delete-then-insert)
  try {
    await db.threatIntelEntry.deleteMany({ where: { sourceId } });
  } catch {
    // Continue even if delete fails
  }

  // Store domains in batches — process up to 3 batches concurrently
  const domainBatch = domains.slice(0, STORE_LIMIT);
  const domainBatches: string[][] = [];
  for (let i = 0; i < domainBatch.length; i += BATCH_SIZE) {
    domainBatches.push(domainBatch.slice(i, i + BATCH_SIZE));
  }

  if (domainBatches.length > 0) {
    console.log(`[storeEntries] ${sourceId}: ${domainBatch.length} domains in ${domainBatches.length} batches (parallel, max 3 concurrent)`);
    const domainResults = await parallelWithLimit(
      domainBatches.map((batch) => async () => {
        try {
          const result = await (db as any).threatIntelEntry.createMany({
            data: batch.map((domain) => ({
              sourceId,
              type: 'domain',
              value: domain,
              severity: 'medium',
              tags: 'threat-intel',
            })),
            skipDuplicates: true,
          });
          return result.count;
        } catch {
          return 0;
        }
      }),
      3 // max 3 concurrent batch writes
    );
    for (const r of domainResults) {
      if (r.status === 'fulfilled') entryCount += r.value;
    }
  }

  // Store IPs in batches — process up to 3 batches concurrently
  const ipBatch = ips.slice(0, STORE_LIMIT);
  const ipBatches: string[][] = [];
  for (let i = 0; i < ipBatch.length; i += BATCH_SIZE) {
    ipBatches.push(ipBatch.slice(i, i + BATCH_SIZE));
  }

  if (ipBatches.length > 0) {
    console.log(`[storeEntries] ${sourceId}: ${ipBatch.length} IPs in ${ipBatches.length} batches (parallel, max 3 concurrent)`);
    const ipResults = await parallelWithLimit(
      ipBatches.map((batch) => async () => {
        try {
          const result = await (db as any).threatIntelEntry.createMany({
            data: batch.map((ip) => ({
              sourceId,
              type: 'ip',
              value: ip,
              severity: 'medium',
              tags: 'threat-intel',
            })),
            skipDuplicates: true,
          });
          return result.count;
        } catch {
          return 0;
        }
      }),
      3 // max 3 concurrent batch writes
    );
    for (const r of ipResults) {
      if (r.status === 'fulfilled') entryCount += r.value;
    }
  }

  // Update entry count for source
  const totalEntries = await db.threatIntelEntry.count({ where: { sourceId } });
  await db.threatIntelSource.update({
    where: { sourceId },
    data: { entryCount: totalEntries },
  });

  const storeElapsed = Date.now() - storeStartTime;
  console.log(`[storeEntries] ${sourceId}: stored ${entryCount} entries (total in DB: ${totalEntries}) in ${storeElapsed}ms`);

  return entryCount;
}

// --- GET Handler ---

// NOTE: GET is publicly accessible — viewing source list does not require login
export async function GET(request: NextRequest) {
  try {
    await seedSources();

    const sources = await db.threatIntelSource.findMany({
      orderBy: [{ requiresApiKey: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json({
      sources: sources.map((s) => ({
        id: s.id,
        sourceId: s.sourceId,
        name: s.name,
        nameEn: s.nameEn,
        description: s.description,
        enabled: s.enabled,
        requiresApiKey: s.requiresApiKey,
        hasApiKey: !!s.apiKey,
        status: s.status,
        lastUpdate: s.lastUpdate?.toISOString() || null,
        entryCount: s.entryCount,
        error: s.error,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch threat intel sources:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// --- POST Handler ---

export async function POST(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;
  const actor = getSessionFromRequest(request) || 'system';
  const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  try {
    const body = await request.json();
    const { action, sourceId, enabled, apiKey } = body;

    // Save API key for a source
    if (action === 'save-api-key') {
      if (!sourceId || typeof apiKey === 'undefined') {
        return NextResponse.json(
          { error: 'Missing required fields: sourceId, apiKey' },
          { status: 400 }
        );
      }

      const source = await db.threatIntelSource.findUnique({ where: { sourceId } });
      if (!source) {
        return NextResponse.json({ error: 'Source not found' }, { status: 404 });
      }

      // Decrypt RSA-encrypted API key if needed
      let decryptedApiKey = apiKey;
      if (apiKey) {
        const rsaResult = rsaDecrypt(apiKey);
        if (rsaResult) {
          decryptedApiKey = rsaResult;
        }
      }

      await db.threatIntelSource.update({
        where: { sourceId },
        data: { apiKey: decryptedApiKey || null },
      });

      auditLog.system('api_key_saved', actor, { sourceId }, ip, 'threat_intel_source', sourceId);

      return NextResponse.json({ success: true });
    }

    if (!action) {
      return NextResponse.json({ error: 'Missing required field: action' }, { status: 400 });
    }

    // Toggle source enabled/disabled
    if (action === 'toggle') {
      if (!sourceId || typeof enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'Missing required fields: sourceId, enabled' },
          { status: 400 }
        );
      }

      const source = await db.threatIntelSource.findUnique({ where: { sourceId } });
      if (!source) {
        return NextResponse.json({ error: 'Source not found' }, { status: 404 });
      }

      await db.threatIntelSource.update({
        where: { sourceId },
        data: { enabled, status: enabled ? 'idle' : 'idle', error: null },
      });

      auditLog.system('source_toggled', actor, { sourceId, enabled }, ip, 'threat_intel_source', sourceId);

      return NextResponse.json({ success: true });
    }

    // Collect from a single source
    if (action === 'collect') {
      if (!sourceId) {
        return NextResponse.json({ error: 'Missing required field: sourceId' }, { status: 400 });
      }

      const source = await db.threatIntelSource.findUnique({ where: { sourceId } });
      if (!source) {
        return NextResponse.json({ error: 'Source not found' }, { status: 404 });
      }

      // For sources requiring API key, check if one is stored
      const sourceApiKey = source.apiKey || apiKey;
      if (source.requiresApiKey && !sourceApiKey) {
        return NextResponse.json(
          { error: '该情报源需要API密钥，请在设置中配置API Key' },
          { status: 400 }
        );
      }

      if (!source.enabled) {
        return NextResponse.json(
          { error: '该情报源未启用，请先启用后再采集' },
          { status: 400 }
        );
      }

      // Mark as collecting
      await db.threatIntelSource.update({
        where: { sourceId },
        data: { status: 'collecting', error: null },
      });

      // Run collection in background - respond immediately
      const effectiveApiKey = sourceApiKey || (sourceId === 'alienvault-otx' ? process.env.OTX_API_KEY : undefined);
      collectSource(sourceId, effectiveApiKey).catch((err) => {
        console.error(`Background collection failed for ${sourceId}:`, err);
      });

      return NextResponse.json({ success: true, message: '采集任务已启动' });
    }

    // Collect from all enabled sources
    if (action === 'collect-all') {
      const sources = await db.threatIntelSource.findMany({
        where: { enabled: true, requiresApiKey: false },
      });

      // Also include API-key sources that have keys configured
      const apiSources = await db.threatIntelSource.findMany({
        where: { enabled: true, requiresApiKey: true, apiKey: { not: null } },
      });

      const allSources = [...sources, ...apiSources];

      // Mark all as collecting in parallel
      await Promise.all(
        allSources.map((source) =>
          db.threatIntelSource.update({
            where: { sourceId: source.sourceId },
            data: { status: 'collecting', error: null },
          })
        )
      );

      // Run collection in background with concurrency limit of 3 using Promise.allSettled
      const CONCURRENCY_LIMIT = 3;
      const sourceQueue = allSources.map((source) => {
        const effectiveApiKey = source.apiKey || (source.sourceId === 'alienvault-otx' ? process.env.OTX_API_KEY : undefined);
        return () => collectSource(source.sourceId, effectiveApiKey);
      });

      console.log(`[collect-all] Starting parallel collection of ${allSources.length} sources (concurrency: ${CONCURRENCY_LIMIT})`);
      const collectStartTime = Date.now();

      // Process queue in batches of CONCURRENCY_LIMIT using Promise.allSettled
      (async () => {
        for (let i = 0; i < sourceQueue.length; i += CONCURRENCY_LIMIT) {
          const batch = sourceQueue.slice(i, i + CONCURRENCY_LIMIT);
          await Promise.allSettled(batch.map((fn) => fn()));
        }
        const totalElapsed = Date.now() - collectStartTime;
        console.log(`[collect-all] All ${allSources.length} sources completed in ${totalElapsed}ms`);
      })();

      return NextResponse.json({
        success: true,
        message: `已启动 ${allSources.length} 个情报源的采集任务`,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Failed to process threat intel action:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// --- Background Collection ---

async function collectSource(sourceId: string, apiKey?: string) {
  const collectFn = COLLECTION_MAP[sourceId];
  if (!collectFn) {
    await db.threatIntelSource.update({
      where: { sourceId },
      data: {
        status: 'error',
        error: `未知的情报源: ${sourceId}，该源可能已被移除或尚未配置`,
      },
    });
    return;
  }

  const startTime = Date.now();

  try {
    const { domains, ips } = await collectFn(apiKey);
    // Deduplicate domains and IPs before storage
    const uniqueDomains = [...new Set(domains)];
    const uniqueIps = [...new Set(ips)];
    const entryCount = await storeEntries(sourceId, uniqueDomains, uniqueIps);
    const elapsed = Date.now() - startTime;

    await db.threatIntelSource.update({
      where: { sourceId },
      data: {
        status: 'completed',
        lastUpdate: new Date(),
        error: null,
      },
    });

    console.log(
      `Collected ${entryCount} entries from ${sourceId} (${domains.length} domains, ${ips.length} IPs) in ${elapsed}ms`
    );
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    const errorMessage = err?.message || '采集失败，未知错误';

    await db.threatIntelSource.update({
      where: { sourceId },
      data: {
        status: 'error',
        error: `[${sourceId}] ${errorMessage} (耗时${elapsed}ms)`,
      },
    });

    console.error(`Collection failed for ${sourceId} after ${elapsed}ms:`, errorMessage);
  }
}
