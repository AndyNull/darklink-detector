import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireSessionAuth } from '@/lib/api-auth';
import { isSafeDomain, isSafeIP } from '@/lib/safe-domain-whitelist';

/**
 * POST /api/threat-intel/cleanup-safe-domains
 *
 * One-time cleanup: removes well-known safe domains (github.com, w3.org, etc.)
 * and safe IPs (private/reserved ranges) from the malicious library.
 *
 * This endpoint is idempotent — running it multiple times has no additional effect.
 * Requires session authentication.
 */
export async function POST(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  try {
    const results = {
      domainsChecked: 0,
      domainsRemoved: 0,
      domainsRemovedList: [] as string[],
      ipsChecked: 0,
      ipsRemoved: 0,
      ipsRemovedList: [] as string[],
      entriesChecked: 0,
      entriesRemoved: 0,
    };

    // ─── Step 1: Clean up MaliciousDomain table ─────────────────────────
    const allDomains = await db.maliciousDomain.findMany({
      select: { id: true, domain: true },
    });
    results.domainsChecked = allDomains.length;

    const safeDomainIds: string[] = [];
    const safeDomainNames: string[] = [];

    for (const entry of allDomains) {
      if (isSafeDomain(entry.domain)) {
        safeDomainIds.push(entry.id);
        safeDomainNames.push(entry.domain);
      }
    }

    if (safeDomainIds.length > 0) {
      // Delete in batches to avoid SQLite limits
      const BATCH_SIZE = 500;
      for (let i = 0; i < safeDomainIds.length; i += BATCH_SIZE) {
        const batch = safeDomainIds.slice(i, i + BATCH_SIZE);
        await db.maliciousDomain.deleteMany({
          where: { id: { in: batch } },
        });
      }
      results.domainsRemoved = safeDomainIds.length;
      results.domainsRemovedList = safeDomainNames.slice(0, 100); // Limit list size
    }

    // ─── Step 2: Clean up MaliciousIP table ─────────────────────────────
    const allIPs = await db.maliciousIP.findMany({
      select: { id: true, ip: true },
    });
    results.ipsChecked = allIPs.length;

    const safeIPIds: string[] = [];
    const safeIPValues: string[] = [];

    for (const entry of allIPs) {
      if (isSafeIP(entry.ip)) {
        safeIPIds.push(entry.id);
        safeIPValues.push(entry.ip);
      }
    }

    if (safeIPIds.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < safeIPIds.length; i += BATCH_SIZE) {
        const batch = safeIPIds.slice(i, i + BATCH_SIZE);
        await db.maliciousIP.deleteMany({
          where: { id: { in: batch } },
        });
      }
      results.ipsRemoved = safeIPIds.length;
      results.ipsRemovedList = safeIPValues.slice(0, 100); // Limit list size
    }

    // ─── Step 3: Clean up ThreatIntelEntry table ────────────────────────
    // Only clean domain-type entries that are safe
    const allDomainEntries = await db.threatIntelEntry.findMany({
      where: { type: 'domain' },
      select: { id: true, value: true },
    });

    const allIPEntries = await db.threatIntelEntry.findMany({
      where: { type: 'ip' },
      select: { id: true, value: true },
    });

    results.entriesChecked = allDomainEntries.length + allIPEntries.length;

    const safeEntryIds: string[] = [];

    for (const entry of allDomainEntries) {
      if (isSafeDomain(entry.value)) {
        safeEntryIds.push(entry.id);
      }
    }

    for (const entry of allIPEntries) {
      if (isSafeIP(entry.value)) {
        safeEntryIds.push(entry.id);
      }
    }

    if (safeEntryIds.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < safeEntryIds.length; i += BATCH_SIZE) {
        const batch = safeEntryIds.slice(i, i + BATCH_SIZE);
        await db.threatIntelEntry.deleteMany({
          where: { id: { in: batch } },
        });
      }
      results.entriesRemoved = safeEntryIds.length;
    }

    // ─── Step 4: Recalculate source health counts ───────────────────────
    const allSources = await db.threatIntelSource.findMany({
      select: { sourceId: true },
    });

    for (const source of allSources) {
      try {
        const [domainCount, ipCount, entryCount] = await Promise.all([
          db.maliciousDomain.count({ where: { source: source.sourceId } }),
          db.maliciousIP.count({ where: { source: source.sourceId } }),
          db.threatIntelEntry.count({ where: { sourceId: source.sourceId } }),
        ]);
        const totalCount = domainCount + ipCount + entryCount;
        await db.threatIntelSource.update({
          where: { sourceId: source.sourceId },
          data: { entryCount: totalCount },
        });
      } catch {
        // Skip sources that fail to update
      }
    }

    console.log(`[Cleanup] Removed ${results.domainsRemoved} safe domains, ${results.ipsRemoved} safe IPs, ${results.entriesRemoved} safe entries`);

    return NextResponse.json({
      success: true,
      message: `清理完成：删除 ${results.domainsRemoved} 个安全域名, ${results.ipsRemoved} 个安全IP, ${results.entriesRemoved} 条安全威胁情报`,
      details: results,
    });
  } catch (error) {
    console.error('Failed to cleanup safe domains:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
