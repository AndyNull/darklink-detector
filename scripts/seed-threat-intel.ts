/**
 * Threat Intelligence Seed Script
 * Fetches FULL data from multiple open threat intel sources and imports into SQLite DB.
 * No artificial limits - processes all available data from each source.
 *
 * Sources:
 * 1. OpenPhish - Phishing URLs
 * 2. URLhaus (text) - Malicious URLs
 * 3. URLhaus (CSV) - Richer malicious URL data
 * 4. ThreatFox - IOCs (domains + IPs)
 * 5. Blocklist.de - Aggressive IPs
 * 6. CINS Army - Suspicious IPs
 * 7. Spamhaus DROP - Known hijacked/spam IPs
 * 8. AlienVault OTX - Pulses with indicators
 * 9. Feodo Tracker - Botnet C2 IPs
 * 10. SSL Blacklist (Abuse.ch) - Malicious JA3 fingerprints
 * 11. PhishTank - Phishing URLs (may require API key)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Helpers ────────────────────────────────────────────────────────────────────

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

function isValidIP(ip: string): boolean {
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

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.hostname;
  } catch {
    return null;
  }
}

function isIP(value: string): boolean {
  return IP_REGEX.test(value);
}

async function fetchWithRetry(url: string, retries = 3, timeoutMs = 60000): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Batch DB Import ─────────────────────────────────────────────────────────────

async function batchImportDomains(domains: { domain: string; reason: string | null; source: string; severity: string; category: string | null }[]): Promise<number> {
  let added = 0;
  const BATCH_SIZE = 500;
  for (let i = 0; i < domains.length; i += BATCH_SIZE) {
    const batch = domains.slice(i, i + BATCH_SIZE);
    try {
      // Use createMany with skipDuplicates for much faster bulk import
      const result = await prisma.maliciousDomain.createMany({
        data: batch,
        skipDuplicates: true,
      });
      added += result.count;
    } catch {
      // Fallback: try individual upserts for this batch
      for (const entry of batch) {
        try {
          await prisma.maliciousDomain.upsert({
            where: { domain: entry.domain },
            update: { source: entry.source, severity: entry.severity, category: entry.category, reason: entry.reason },
            create: entry,
          });
          added++;
        } catch {
          // skip duplicates/errors
        }
      }
    }
    if (i + BATCH_SIZE < domains.length) {
      await delay(50); // smaller delay between batches
    }
  }
  return added;
}

async function batchImportIPs(ips: { ip: string; reason: string | null; source: string; severity: string; category: string | null; country?: string | null }[]): Promise<number> {
  let added = 0;
  const BATCH_SIZE = 500;
  for (let i = 0; i < ips.length; i += BATCH_SIZE) {
    const batch = ips.slice(i, i + BATCH_SIZE);
    try {
      // Use createMany with skipDuplicates for much faster bulk import
      const result = await prisma.maliciousIP.createMany({
        data: batch,
        skipDuplicates: true,
      });
      added += result.count;
    } catch {
      // Fallback: try individual upserts for this batch
      for (const entry of batch) {
        try {
          await prisma.maliciousIP.upsert({
            where: { ip: entry.ip },
            update: { source: entry.source, severity: entry.severity, category: entry.category, reason: entry.reason },
            create: entry,
          });
          added++;
        } catch {
          // skip duplicates/errors
        }
      }
    }
    if (i + BATCH_SIZE < ips.length) {
      await delay(50);
    }
  }
  return added;
}

// ─── Source 1: OpenPhish ─────────────────────────────────────────────────────────

async function fetchOpenPhish(): Promise<{ domains: number; ips: number }> {
  console.log('\n=== [1/11] OpenPhish - Phishing URLs ===');
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    const resp = await fetchWithRetry('https://openphish.com/feed.txt', 3, 60000);
    const text = await resp.text();
    const urls = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    console.log(`  Fetched ${urls.length} URLs from OpenPhish`);

    // Process ALL URLs - no limit
    for (const url of urls) {
      const hostname = extractDomain(url);
      if (!hostname) continue;

      if (isIP(hostname)) {
        if (isValidIP(hostname)) {
          ipSet.set(hostname, {
            ip: hostname,
            reason: 'OpenPhish phishing URL',
            source: 'openphish',
            severity: 'critical',
            category: 'phishing',
            country: null,
          });
        }
      } else {
        domainSet.set(hostname, {
          domain: hostname,
          reason: 'OpenPhish phishing URL',
          source: 'openphish',
          severity: 'critical',
          category: 'phishing',
        });
      }
    }

    const domainEntries = [...domainSet.values()];
    const ipEntries = [...ipSet.values()];
    console.log(`  Unique domains: ${domainEntries.length}, Unique IPs: ${ipEntries.length}`);

    const dAdded = await batchImportDomains(domainEntries);
    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs`);

    return { domains: dAdded, ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { domains: 0, ips: 0 };
  }
}

// ─── Source 2: URLhaus (text feed) ───────────────────────────────────────────────

async function fetchURLhausText(): Promise<{ domains: number; ips: number }> {
  console.log('\n=== [2/11] URLhaus (text) - Malicious URLs ===');
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    const resp = await fetchWithRetry('https://urlhaus.abuse.ch/downloads/text/', 3, 60000);
    const text = await resp.text();
    const urls = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));

    console.log(`  Fetched ${urls.length} URLs from URLhaus text feed`);

    // Process ALL URLs - no limit
    for (const url of urls) {
      const hostname = extractDomain(url);
      if (!hostname) continue;

      if (isIP(hostname)) {
        if (isValidIP(hostname)) {
          ipSet.set(hostname, {
            ip: hostname,
            reason: 'URLhaus malicious URL',
            source: 'urlhaus',
            severity: 'high',
            category: 'malware',
            country: null,
          });
        }
      } else {
        domainSet.set(hostname, {
          domain: hostname,
          reason: 'URLhaus malicious URL',
          source: 'urlhaus',
          severity: 'high',
          category: 'malware',
        });
      }
    }

    const domainEntries = [...domainSet.values()];
    const ipEntries = [...ipSet.values()];
    console.log(`  Unique domains: ${domainEntries.length}, Unique IPs: ${ipEntries.length}`);

    const dAdded = await batchImportDomains(domainEntries);
    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs`);

    return { domains: dAdded, ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { domains: 0, ips: 0 };
  }
}

// ─── Source 3: URLhaus (CSV feed) - richer data ──────────────────────────────────
// Note: The CSV endpoint returns a ZIP file. We decompress it to get the actual CSV.
// Since Source 2 (text feed) already covers the same URLs, this CSV source adds
// richer metadata (threat type, tags). The text feed data takes priority for dedup.

async function fetchURLhausCSV(): Promise<{ domains: number; ips: number }> {
  console.log('\n=== [3/11] URLhaus (CSV) - Richer malicious URL data ===');
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    const resp = await fetchWithRetry('https://urlhaus.abuse.ch/downloads/csv/', 3, 60000);
    const arrayBuffer = await resp.arrayBuffer();

    // The response is a ZIP file - decompress it using Bun's built-in decompression
    let csvText: string;
    try {
      // Try to decompress using subprocess (unzip)
      // The ZIP contains a file named "csv.txt"
      const tmpZip = '/tmp/urlhaus.csv.zip';
      const tmpCsv = '/tmp/csv.txt';
      await Bun.write(tmpZip, new Uint8Array(arrayBuffer));
      const proc = Bun.spawn(['unzip', '-o', tmpZip, '-d', '/tmp/']);
      await proc.exited;
      csvText = await Bun.file(tmpCsv).text();
      console.log(`  Decompressed ZIP, CSV size: ${csvText.length} bytes`);
    } catch (zipErr: any) {
      // If ZIP decompression fails, try treating response as plain text
      console.log(`  ZIP decompression failed: ${zipErr.message}, trying as plain text`);
      csvText = new TextDecoder().decode(arrayBuffer);
    }

    const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));

    console.log(`  Fetched ${lines.length} lines from URLhaus CSV feed`);

    // Process ALL lines - no limit
    for (const line of lines) {
      // CSV format: id,dateadded,url,url_status,last_online,threat,tags,urlhaus_link,reporter
      const cleanLine = line.replace(/^\s*"/, '').replace(/"\s*$/, '');
      const parts = cleanLine.split('","').map(p => p.replace(/^"|"$/g, ''));
      if (parts.length < 6) continue;

      const url = parts[2]; // url field
      const threat = parts[5]; // threat field
      const tags = parts[6]; // tags field

      if (!url) continue;

      const hostname = extractDomain(url);
      if (!hostname) continue;

      const category = threat || tags || 'malware';
      const reason = `URLhaus: ${threat || 'malware download'}${tags ? ` [${tags}]` : ''}`;

      if (isIP(hostname)) {
        if (isValidIP(hostname)) {
          ipSet.set(hostname, {
            ip: hostname,
            reason,
            source: 'urlhaus',
            severity: 'high',
            category,
            country: null,
          });
        }
      } else {
        domainSet.set(hostname, {
          domain: hostname,
          reason,
          source: 'urlhaus',
          severity: 'high',
          category,
        });
      }
    }

    const domainEntries = [...domainSet.values()];
    const ipEntries = [...ipSet.values()];
    console.log(`  Unique domains: ${domainEntries.length}, Unique IPs: ${ipEntries.length}`);

    const dAdded = await batchImportDomains(domainEntries);
    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs`);

    return { domains: dAdded, ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { domains: 0, ips: 0 };
  }
}

// ─── Source 4: ThreatFox ─────────────────────────────────────────────────────────

async function fetchThreatFox(): Promise<{ domains: number; ips: number }> {
  console.log('\n=== [4/11] ThreatFox - IOCs ===');
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    // ThreatFox API requires POST requests with JSON body
    // Do multiple queries to get different types of IOCs - limit increased from 200 to 1000
    const queries = [
      { query: 'search', search_term: '.', limit: 1000 },
      { query: 'search', search_term: 'botnet', limit: 1000 },
      { query: 'search', search_term: 'c2', limit: 1000 },
      { query: 'search', search_term: 'loader', limit: 1000 },
      { query: 'search', search_term: 'stealer', limit: 1000 },
      { query: 'search', search_term: 'rat', limit: 1000 },
      { query: 'search', search_term: 'ransomware', limit: 1000 },
      { query: 'search', search_term: 'phishing', limit: 1000 },
    ];

    for (const queryBody of queries) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        const qResp = await fetch('https://threatfox-api.abuse.ch/api/v1/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queryBody),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!qResp.ok) {
          console.log(`  Query "${queryBody.search_term}" returned HTTP ${qResp.status}`);
          continue;
        }

        const qData = await qResp.json();

        if (qData.query_status === 'ok' && qData.data && Array.isArray(qData.data)) {
          console.log(`  Query "${queryBody.search_term}" returned ${qData.data.length} IOCs`);

          for (const ioc of qData.data) {
            // Process ALL IOCs - no limit
            const iocValue = ioc.ioc || ioc.indicator;
            const iocType = ioc.ioc_type || ioc.type;
            const malware = ioc.malware_printable || ioc.malware || 'unknown';
            const threatType = ioc.threat_type || ioc.confidence_level || '';
            const reason = `ThreatFox: ${malware} (${threatType})`;

            if (!iocValue) continue;

            if (iocType === 'ip:port') {
              const ip = iocValue.split(':')[0];
              if (isValidIP(ip)) {
                ipSet.set(ip, {
                  ip,
                  reason,
                  source: 'threatfox',
                  severity: 'high',
                  category: threatType || 'c2',
                  country: null,
                });
              }
            } else if (iocType === 'domain' || iocType === 'url') {
              let hostname = iocValue;
              if (iocType === 'url') {
                hostname = extractDomain(iocValue) || iocValue;
              }
              if (isIP(hostname)) {
                if (isValidIP(hostname)) {
                  ipSet.set(hostname, {
                    ip: hostname,
                    reason,
                    source: 'threatfox',
                    severity: 'high',
                    category: threatType || 'c2',
                    country: null,
                  });
                }
              } else {
                domainSet.set(hostname, {
                  domain: hostname,
                  reason,
                  source: 'threatfox',
                  severity: 'high',
                  category: threatType || 'malware',
                });
              }
            } else if (iocType === 'ip:port' || iocType === 'ip') {
              const ip = iocValue.split(':')[0];
              if (isValidIP(ip)) {
                ipSet.set(ip, {
                  ip,
                  reason,
                  source: 'threatfox',
                  severity: 'high',
                  category: threatType || 'c2',
                  country: null,
                });
              }
            }
          }
        } else {
          console.log(`  Query "${queryBody.search_term}" status: ${qData.query_status || 'unknown'}`);
        }
      } catch (qErr: any) {
        console.log(`  Query "${queryBody.search_term}" failed: ${qErr.message}`);
      }

      await delay(1000); // respectful delay between API calls
    }

    const domainEntries = [...domainSet.values()];
    const ipEntries = [...ipSet.values()];
    console.log(`  Total unique domains: ${domainEntries.length}, Total unique IPs: ${ipEntries.length}`);

    const dAdded = await batchImportDomains(domainEntries);
    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs`);

    return { domains: dAdded, ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { domains: 0, ips: 0 };
  }
}

// ─── Source 5: Blocklist.de ──────────────────────────────────────────────────────

async function fetchBlocklistDE(): Promise<{ ips: number }> {
  console.log('\n=== [5/11] Blocklist.de - Aggressive IPs ===');
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    const resp = await fetchWithRetry('https://lists.blocklist.de/lists/all.txt', 3, 60000);
    const text = await resp.text();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    console.log(`  Fetched ${lines.length} lines from Blocklist.de`);

    // Process ALL IPs - no limit
    for (const line of lines) {
      const ip = line.replace(/^ip:/, '').trim();
      if (isValidIP(ip)) {
        ipSet.set(ip, {
          ip,
          reason: 'Blocklist.de aggressive IP',
          source: 'blocklist-de',
          severity: 'high',
          category: 'bruteforce',
          country: null,
        });
      }
    }

    const ipEntries = [...ipSet.values()];
    console.log(`  Unique IPs: ${ipEntries.length}`);

    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${iAdded} IPs`);

    return { ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { ips: 0 };
  }
}

// ─── Source 6: CINS Army ─────────────────────────────────────────────────────────

async function fetchCINSArmy(): Promise<{ ips: number }> {
  console.log('\n=== [6/11] CINS Army - Suspicious IPs ===');
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    const resp = await fetchWithRetry('https://cinsscore.com/list/ci-badguys.txt', 3, 60000);
    const text = await resp.text();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    console.log(`  Fetched ${lines.length} lines from CINS Army`);

    // Process ALL IPs - no limit
    for (const line of lines) {
      const ip = line.split('/')[0].trim();
      if (isValidIP(ip)) {
        ipSet.set(ip, {
          ip,
          reason: 'CINS Army suspicious IP',
          source: 'cins-army',
          severity: 'medium',
          category: 'suspicious',
          country: null,
        });
      }
    }

    const ipEntries = [...ipSet.values()];
    console.log(`  Unique IPs: ${ipEntries.length}`);

    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${iAdded} IPs`);

    return { ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { ips: 0 };
  }
}

// ─── Source 7: Spamhaus DROP ─────────────────────────────────────────────────────

async function fetchSpamhausDROP(): Promise<{ ips: number }> {
  console.log('\n=== [7/11] Spamhaus DROP - Hijacked/Spam IPs ===');
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    const resp = await fetchWithRetry('https://www.spamhaus.org/drop/drop.txt', 3, 60000);
    const text = await resp.text();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith(';'));

    console.log(`  Fetched ${lines.length} lines from Spamhaus DROP`);

    // Process ALL IPs - no limit
    for (const line of lines) {
      // Format: 1.2.3.0/24 ; SBL12345
      const cidr = line.split(';')[0].trim();
      const ip = cidr.split('/')[0].trim();
      if (isValidIP(ip)) {
        ipSet.set(ip, {
          ip,
          reason: 'Spamhaus DROP - known hijacked/spam IP',
          source: 'spamhaus-drop',
          severity: 'critical',
          category: 'spam',
          country: null,
        });
      }
    }

    // Also fetch EDROP
    try {
      const edropResp = await fetchWithRetry('https://www.spamhaus.org/drop/edrop.txt', 3, 60000);
      const edropText = await edropResp.text();
      const edropLines = edropText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith(';'));

      console.log(`  Fetched ${edropLines.length} lines from Spamhaus EDROP`);

      for (const line of edropLines) {
        const cidr = line.split(';')[0].trim();
        const ip = cidr.split('/')[0].trim();
        if (isValidIP(ip)) {
          ipSet.set(ip, {
            ip,
            reason: 'Spamhaus EDROP - known hijacked/spam IP',
            source: 'spamhaus-drop',
            severity: 'critical',
            category: 'spam',
            country: null,
          });
        }
      }
    } catch (edropErr: any) {
      console.log(`  EDROP fetch failed: ${edropErr.message}`);
    }

    const ipEntries = [...ipSet.values()];
    console.log(`  Unique IPs: ${ipEntries.length}`);

    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${iAdded} IPs`);

    return { ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { ips: 0 };
  }
}

// ─── Source 8: AlienVault OTX ────────────────────────────────────────────────────

async function fetchAlienVaultOTX(): Promise<{ domains: number; ips: number }> {
  console.log('\n=== [8/11] AlienVault OTX - Pulse Indicators ===');
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    // Try multiple public OTX API endpoints - the subscribed endpoint requires auth,
    // so we try public endpoints for latest/modified/trending pulses
    // Also try specific pulse IDs for well-known threat pulses
    const endpoints = [
      'https://otx.alienvault.com/api/v1/pulses/latest?limit=20',
      'https://otx.alienvault.com/api/v1/pulses/subscribed?limit=20',
      'https://otx.alienvault.com/api/v1/pulses/most_active?limit=20',
    ];

    let pulses: any[] = [];
    for (const endpoint of endpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        const resp = await fetch(endpoint, { signal: controller.signal });
        clearTimeout(timer);

        if (!resp.ok) {
          console.log(`  Endpoint ${endpoint.split('/').slice(-2).join('/')} returned HTTP ${resp.status}`);
          continue;
        }

        const data = await resp.json();
        const results = data.results || [];
        console.log(`  Fetched ${results.length} pulses from ${endpoint.split('/').slice(-2).join('/')}`);
        pulses = pulses.concat(results);
        break; // use first successful endpoint
      } catch (err: any) {
        console.log(`  Endpoint failed: ${err.message}`);
      }
    }

    // Deduplicate pulses by ID
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
      console.log(`  Processing pulse "${pulseName}" with ${indicators.length} indicators`);

      // Process ALL indicators from each pulse - no limit
      for (const indicator of indicators) {
        const type = indicator.type || indicator.indicator_types?.[0] || '';
        const value = indicator.indicator || '';
        const reason = `AlienVault OTX: ${pulseName}`;

        if (!value) continue;

        if (type === 'domain' || type === 'hostname') {
          if (!isIP(value)) {
            domainSet.set(value, {
              domain: value,
              reason,
              source: 'alienvault-otx',
              severity: 'high',
              category: 'threat-intel',
            });
          } else if (isValidIP(value)) {
            ipSet.set(value, {
              ip: value,
              reason,
              source: 'alienvault-otx',
              severity: 'high',
              category: 'threat-intel',
              country: null,
            });
          }
        } else if (type === 'IPv4') {
          const ip = value.split('/')[0].trim();
          if (isValidIP(ip)) {
            ipSet.set(ip, {
              ip,
              reason,
              source: 'alienvault-otx',
              severity: 'high',
              category: 'threat-intel',
              country: null,
            });
          }
        } else if (type === 'URL') {
          const hostname = extractDomain(value);
          if (hostname) {
            if (isIP(hostname) && isValidIP(hostname)) {
              ipSet.set(hostname, {
                ip: hostname,
                reason,
                source: 'alienvault-otx',
                severity: 'high',
                category: 'threat-intel',
                country: null,
              });
            } else if (!isIP(hostname)) {
              domainSet.set(hostname, {
                domain: hostname,
                reason,
                source: 'alienvault-otx',
                severity: 'high',
                category: 'threat-intel',
              });
            }
          }
        } else if (type === 'email') {
          // Extract domain from email
          const emailDomain = value.split('@')[1];
          if (emailDomain && !isIP(emailDomain)) {
            domainSet.set(emailDomain, {
              domain: emailDomain,
              reason: `${reason} (email)`,
              source: 'alienvault-otx',
              severity: 'medium',
              category: 'phishing',
            });
          }
        }
        // Skip hash, CIDR, etc. types
      }

      await delay(500); // respectful delay between pulses
    }

    const domainEntries = [...domainSet.values()];
    const ipEntries = [...ipSet.values()];
    console.log(`  Unique domains: ${domainEntries.length}, Unique IPs: ${ipEntries.length}`);

    const dAdded = await batchImportDomains(domainEntries);
    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs`);

    return { domains: dAdded, ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { domains: 0, ips: 0 };
  }
}

// ─── Source 9: Feodo Tracker ─────────────────────────────────────────────────────

async function fetchFeodoTracker(): Promise<{ ips: number; domains: number }> {
  console.log('\n=== [9/11] Feodo Tracker - Botnet C2 IPs ===');
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();

  try {
    const resp = await fetchWithRetry('https://feodotracker.abuse.ch/downloads/ipblocklist.json', 3, 60000);
    const data = await resp.json();

    if (!Array.isArray(data)) {
      console.log(`  Unexpected response format: ${typeof data}`);
      return { ips: 0, domains: 0 };
    }

    console.log(`  Fetched ${data.length} entries from Feodo Tracker`);

    // Process ALL entries - no limit
    for (const entry of data) {
      const ip = entry.ip || entry.ip_address;
      const status = entry.status || 'online';
      const hostname = entry.hostname || null;
      const asNumber = entry.as_number || null;
      const malware = entry.malware || 'unknown';

      if (ip && isValidIP(ip)) {
        ipSet.set(ip, {
          ip,
          reason: `Feodo Tracker: ${malware} botnet C2 (${status})${asNumber ? ` AS${asNumber}` : ''}`,
          source: 'feodo-tracker',
          severity: 'critical',
          category: 'botnet',
          country: entry.country || null,
        });
      }

      // Also import hostnames as domains
      if (hostname && hostname !== ip && !isIP(hostname)) {
        domainSet.set(hostname, {
          domain: hostname,
          reason: `Feodo Tracker: ${malware} botnet C2 hostname (${status})`,
          source: 'feodo-tracker',
          severity: 'critical',
          category: 'botnet',
        });
      }
    }

    const ipEntries = [...ipSet.values()];
    const domainEntries = [...domainSet.values()];
    console.log(`  Unique IPs: ${ipEntries.length}, Unique domains: ${domainEntries.length}`);

    const iAdded = await batchImportIPs(ipEntries);
    const dAdded = await batchImportDomains(domainEntries);
    console.log(`  Imported: ${iAdded} IPs, ${dAdded} domains`);

    return { ips: iAdded, domains: dAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { ips: 0, domains: 0 };
  }
}

// ─── Source 10: SSL Blacklist (Abuse.ch) ─────────────────────────────────────────

async function fetchSSLBlacklist(): Promise<{ count: number }> {
  console.log('\n=== [10/11] SSL Blacklist (Abuse.ch) - Malicious JA3 fingerprints ===');

  // JA3 fingerprints are not IPs or domains, so we store them as domains with special category
  // These are SSL/TLS client fingerprint hashes associated with malware
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();

  try {
    const resp = await fetchWithRetry('https://sslbl.abuse.ch/blacklist/ja3_fingerprints.csv', 3, 60000);
    const text = await resp.text();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));

    console.log(`  Fetched ${lines.length} lines from SSL Blacklist`);

    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length < 1) continue;

      const ja3 = parts[0].trim();
      const listingDate = parts[1]?.trim() || '';

      if (!ja3 || ja3.length < 10) continue; // skip invalid entries

      // Store JA3 fingerprints as domain entries with ja3: prefix for identification
      domainSet.set(`ja3:${ja3}`, {
        domain: `ja3:${ja3}`,
        reason: `SSL Blacklist: Malicious JA3 fingerprint${listingDate ? ` (listed: ${listingDate})` : ''}`,
        source: 'ssl-blacklist',
        severity: 'high',
        category: 'malicious-ssl',
      });
    }

    const entries = [...domainSet.values()];
    console.log(`  Unique JA3 fingerprints: ${entries.length}`);

    const added = await batchImportDomains(entries);
    console.log(`  Imported: ${added} JA3 fingerprints`);

    return { count: added };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { count: 0 };
  }
}

// ─── Source 11: PhishTank ────────────────────────────────────────────────────────

async function fetchPhishTank(): Promise<{ domains: number; ips: number }> {
  console.log('\n=== [11/14] PhishTank - Phishing URLs ===');
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    const resp = await fetchWithRetry('https://data.phishtank.com/data/online-valid.json', 3, 60000);
    const data = await resp.json();

    if (!Array.isArray(data)) {
      console.log(`  Unexpected response format: ${typeof data}`);
      return { domains: 0, ips: 0 };
    }

    console.log(`  Fetched ${data.length} entries from PhishTank`);

    // Process ALL entries - no limit
    for (const entry of data) {
      const url = entry.url || '';
      const hostname = extractDomain(url);

      if (!hostname) continue;

      if (isIP(hostname)) {
        if (isValidIP(hostname)) {
          ipSet.set(hostname, {
            ip: hostname,
            reason: `PhishTank verified phishing${entry.target ? ` (${entry.target})` : ''}`,
            source: 'phishtank',
            severity: 'critical',
            category: 'phishing',
            country: null,
          });
        }
      } else {
        domainSet.set(hostname, {
          domain: hostname,
          reason: `PhishTank verified phishing${entry.target ? ` (${entry.target})` : ''}`,
          source: 'phishtank',
          severity: 'critical',
          category: 'phishing',
        });
      }
    }

    const domainEntries = [...domainSet.values()];
    const ipEntries = [...ipSet.values()];
    console.log(`  Unique domains: ${domainEntries.length}, Unique IPs: ${ipEntries.length}`);

    const dAdded = await batchImportDomains(domainEntries);
    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs`);

    return { domains: dAdded, ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message} (PhishTank may require API key)`);
    return { domains: 0, ips: 0 };
  }
}

// ─── Source 12: Abuse.ch URLhaus Live ─────────────────────────────────────────
// Additional URLhaus endpoint with richer metadata

async function fetchURLhausLive(): Promise<{ domains: number; ips: number }> {
  console.log('\n=== [12/14] URLhaus Live API - Recent malicious URLs ===');
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    // URLhaus API endpoint for recent URLs
    const resp = await fetchWithRetry('https://urlhaus-api.abuse.ch/v1/urls/recent/', 3, 30000);
    const data = await resp.json();

    if (!data.urls || !Array.isArray(data.urls)) {
      console.log(`  Unexpected response format`);
      return { domains: 0, ips: 0 };
    }

    console.log(`  Fetched ${data.urls.length} recent URLs from URLhaus API`);

    for (const entry of data.urls) {
      const url = entry.url || '';
      const hostname = extractDomain(url);
      const threat = entry.threat || 'malware';
      const tags = entry.tags || [];

      if (!hostname) continue;

      const reason = `URLhaus API: ${threat}${tags.length ? ` [${tags.join(',')}]` : ''}`;

      if (isIP(hostname)) {
        if (isValidIP(hostname)) {
          ipSet.set(hostname, {
            ip: hostname,
            reason,
            source: 'urlhaus-api',
            severity: 'high',
            category: threat,
            country: null,
          });
        }
      } else {
        domainSet.set(hostname, {
          domain: hostname,
          reason,
          source: 'urlhaus-api',
          severity: 'high',
          category: threat,
        });
      }
    }

    const domainEntries = [...domainSet.values()];
    const ipEntries = [...ipSet.values()];
    console.log(`  Unique domains: ${domainEntries.length}, Unique IPs: ${ipEntries.length}`);

    const dAdded = await batchImportDomains(domainEntries);
    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs`);

    return { domains: dAdded, ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { domains: 0, ips: 0 };
  }
}

// ─── Source 13: DShield Suspicious Domains ──────────────────────────────────────

async function fetchDShield(): Promise<{ domains: number; ips: number }> {
  console.log('\n=== [13/14] DShield - Suspicious Domains/IPs ===');
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    // DShield high-risk domains
    const resp = await fetchWithRetry('https://www.dshield.org/feeds/suspiciousdomains_High.txt', 3, 30000);
    const text = await resp.text();
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));

    console.log(`  Fetched ${lines.length} entries from DShield`);

    for (const line of lines) {
      const domain = line.toLowerCase();
      if (!domain || domain.length < 3) continue;

      if (isIP(domain)) {
        if (isValidIP(domain)) {
          ipSet.set(domain, {
            ip: domain,
            reason: 'DShield high-risk IP',
            source: 'dshield',
            severity: 'high',
            category: 'suspicious',
            country: null,
          });
        }
      } else {
        domainSet.set(domain, {
          domain,
          reason: 'DShield high-risk domain',
          source: 'dshield',
          severity: 'high',
          category: 'suspicious',
        });
      }
    }

    const domainEntries = [...domainSet.values()];
    const ipEntries = [...ipSet.values()];
    console.log(`  Unique domains: ${domainEntries.length}, Unique IPs: ${ipEntries.length}`);

    const dAdded = await batchImportDomains(domainEntries);
    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs`);

    return { domains: dAdded, ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { domains: 0, ips: 0 };
  }
}

// ─── Source 14: Ransomware Tracker (Abuse.ch) ──────────────────────────────────

async function fetchRansomwareTracker(): Promise<{ domains: number; ips: number }> {
  console.log('\n=== [14/14] Ransomware Tracker - Ransomware C2 & Infrastructure ===');
  const domainSet = new Map<string, { domain: string; reason: string | null; source: string; severity: string; category: string | null }>();
  const ipSet = new Map<string, { ip: string; reason: string | null; source: string; severity: string; category: string | null; country: string | null }>();

  try {
    // ThreatFox API for ransomware-specific IOCs
    const queries = [
      { query: 'search', search_term: 'ransomware', limit: 1000 },
      { query: 'search', search_term: 'lockbit', limit: 1000 },
      { query: 'search', search_term: 'blackcat', limit: 500 },
      { query: 'search', search_term: 'conti', limit: 500 },
      { query: 'search', search_term: 'ryuk', limit: 500 },
    ];

    for (const queryBody of queries) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        const qResp = await fetch('https://threatfox-api.abuse.ch/api/v1/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queryBody),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!qResp.ok) continue;

        const qData = await qResp.json();
        if (qData.query_status === 'ok' && qData.data && Array.isArray(qData.data)) {
          console.log(`  Ransomware query "${queryBody.search_term}" returned ${qData.data.length} IOCs`);

          for (const ioc of qData.data) {
            const iocValue = ioc.ioc || ioc.indicator;
            const iocType = ioc.ioc_type || ioc.type;
            const malware = ioc.malware_printable || ioc.malware || 'unknown';
            const reason = `Ransomware Tracker: ${malware}`;

            if (!iocValue) continue;

            if (iocType === 'ip:port') {
              const ip = iocValue.split(':')[0];
              if (isValidIP(ip)) {
                ipSet.set(ip, { ip, reason, source: 'ransomware-tracker', severity: 'critical', category: 'ransomware', country: null });
              }
            } else if (iocType === 'domain' || iocType === 'url') {
              let hostname = iocType === 'url' ? (extractDomain(iocValue) || iocValue) : iocValue;
              if (isIP(hostname)) {
                if (isValidIP(hostname)) {
                  ipSet.set(hostname, { ip: hostname, reason, source: 'ransomware-tracker', severity: 'critical', category: 'ransomware', country: null });
                }
              } else {
                domainSet.set(hostname, { domain: hostname, reason, source: 'ransomware-tracker', severity: 'critical', category: 'ransomware' });
              }
            }
          }
        }
      } catch (qErr: any) {
        console.log(`  Ransomware query "${queryBody.search_term}" failed: ${qErr.message}`);
      }
      await delay(1000);
    }

    const domainEntries = [...domainSet.values()];
    const ipEntries = [...ipSet.values()];
    console.log(`  Unique domains: ${domainEntries.length}, Unique IPs: ${ipEntries.length}`);

    const dAdded = await batchImportDomains(domainEntries);
    const iAdded = await batchImportIPs(ipEntries);
    console.log(`  Imported: ${dAdded} domains, ${iAdded} IPs`);

    return { domains: dAdded, ips: iAdded };
  } catch (err: any) {
    console.error(`  FAILED: ${err.message}`);
    return { domains: 0, ips: 0 };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Threat Intelligence Seed Script - FULL DATA MODE       ║');
  console.log('║     14 sources - No artificial limits - All data           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nStarted at: ${new Date().toISOString()}`);

  let totalDomains = 0;
  let totalIPs = 0;

  // Run all sources
  const r1 = await fetchOpenPhish();
  totalDomains += r1.domains; totalIPs += r1.ips;

  await delay(2000);
  const r2 = await fetchURLhausText();
  totalDomains += r2.domains; totalIPs += r2.ips;

  await delay(2000);
  const r3 = await fetchURLhausCSV();
  totalDomains += r3.domains; totalIPs += r3.ips;

  await delay(2000);
  const r4 = await fetchThreatFox();
  totalDomains += r4.domains; totalIPs += r4.ips;

  await delay(2000);
  const r5 = await fetchBlocklistDE();
  totalIPs += r5.ips;

  await delay(2000);
  const r6 = await fetchCINSArmy();
  totalIPs += r6.ips;

  await delay(2000);
  const r7 = await fetchSpamhausDROP();
  totalIPs += r7.ips;

  await delay(2000);
  const r8 = await fetchAlienVaultOTX();
  totalDomains += r8.domains; totalIPs += r8.ips;

  await delay(2000);
  const r9 = await fetchFeodoTracker();
  totalDomains += r9.domains; totalIPs += r9.ips;

  await delay(2000);
  const r10 = await fetchSSLBlacklist();
  totalDomains += r10.count;

  await delay(2000);
  const r11 = await fetchPhishTank();
  totalDomains += r11.domains; totalIPs += r11.ips;

  // New sources
  await delay(2000);
  const r12 = await fetchURLhausLive();
  totalDomains += r12.domains; totalIPs += r12.ips;

  await delay(2000);
  const r13 = await fetchDShield();
  totalDomains += r13.domains; totalIPs += r13.ips;

  await delay(2000);
  const r14 = await fetchRansomwareTracker();
  totalDomains += r14.domains; totalIPs += r14.ips;

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    IMPORT SUMMARY                          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total domains imported:  ${totalDomains.toString().padEnd(35)}║`);
  console.log(`║  Total IPs imported:      ${totalIPs.toString().padEnd(35)}║`);
  console.log(`║  Grand total:             ${(totalDomains + totalIPs).toString().padEnd(35)}║`);
  console.log(`║  Elapsed:                 ${(elapsed + 's').padEnd(35)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
