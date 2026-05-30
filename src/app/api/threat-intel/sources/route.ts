import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/threat-intel/sources — 查看威胁情报数据源统计
// NOTE: GET is publicly accessible — viewing source stats does not require login
export async function GET(request: NextRequest) {

  try {
    const startTime = Date.now();

    // Run ALL 10 database queries in parallel (previously 3 sequential Promise.all groups)
    const [
      domainBySource, ipBySource, totalDomains, totalIps,
      domainByCategory, ipByCategory,
      domainBySeverity, ipBySeverity,
    ] = await Promise.all([
      // Group by source
      db.maliciousDomain.groupBy({ by: ['source'], _count: { id: true } }),
      db.maliciousIP.groupBy({ by: ['source'], _count: { id: true } }),
      db.maliciousDomain.count(),
      db.maliciousIP.count(),
      // Group by category
      db.maliciousDomain.groupBy({ by: ['category'], _count: { id: true } }),
      db.maliciousIP.groupBy({ by: ['category'], _count: { id: true } }),
      // Group by severity
      db.maliciousDomain.groupBy({ by: ['severity'], _count: { id: true } }),
      db.maliciousIP.groupBy({ by: ['severity'], _count: { id: true } }),
    ]);

    const queryElapsed = Date.now() - startTime;
    console.log(`[ThreatIntel Sources Stats] All 8 DB queries completed in ${queryElapsed}ms`);

    // Available data sources definition — aligned with settings-panel STATIC_SOURCES
    // queryOnly: true = rate-limited query-only sources (VirusTotal, ThreatBook, AbuseIPDB)
    //   These don't contribute bulk data and should be filtered in the malicious library sources tab
    const sources = [
      // Bulk sources (free/public)
      { id: 'openphish', name: 'OpenPhish', description: '钓鱼URL实时订阅，每日更新', type: 'domain', url: 'https://openphish.com/', queryOnly: false },
      { id: 'urlhaus', name: 'URLhaus', description: '恶意URL分发平台，由abuse.ch维护', type: 'both', url: 'https://urlhaus.abuse.ch/', queryOnly: false },
      { id: 'threatfox', name: 'ThreatFox', description: 'IOC威胁情报，由abuse.ch维护', type: 'both', url: 'https://threatfox.abuse.ch/', queryOnly: false },
      { id: 'blocklist-de', name: 'Blocklist.de', description: '攻击IP列表，社区驱动', type: 'ip', url: 'https://www.blocklist.de/', queryOnly: false },
      { id: 'cins-army', name: 'CINS Army', description: '恶意IP情报，被动DNS数据', type: 'ip', url: 'https://cinsscore.com/', queryOnly: false },
      { id: 'spamhaus-drop', name: 'Spamhaus DROP', description: '已知垃圾邮件/恶意IP段(含EDROP)', type: 'ip', url: 'https://www.spamhaus.org/', queryOnly: false },

      // Bulk sources (need API key for enhanced access)
      { id: 'alienvault-otx', name: 'AlienVault OTX', description: '开放威胁交换，社区驱动IOC', type: 'both', url: 'https://otx.alienvault.com/', queryOnly: false },
      { id: 'phishtank', name: 'PhishTank', description: '社区钓鱼URL数据库', type: 'domain', url: 'https://phishtank.org/', queryOnly: false },
      // Query-only sources (rate-limited, not for bulk collection)
      { id: 'virustotal', name: 'VirusTotal', description: '多引擎恶意文件/URL/IP检测(仅查询)', type: 'both', url: 'https://www.virustotal.com/', queryOnly: true },
      { id: 'threatbook', name: 'ThreatBook/微步', description: '微步在线威胁情报查询API(仅查询)', type: 'both', url: 'https://x.threatbook.com/', queryOnly: true },
      { id: 'abuseipdb', name: 'AbuseIPDB', description: 'IP滥用报告平台(仅查询)', type: 'ip', url: 'https://www.abuseipdb.com/', queryOnly: true },
      // System sources
      { id: 'manual', name: '手动添加', description: '用户手动添加', type: 'both', url: '', queryOnly: false },
      { id: 'scan', name: '扫描发现', description: '暗链扫描自动标记', type: 'both', url: '', queryOnly: false },
    ];

    // Enrich sources with current counts
    const domainSourceMap = Object.fromEntries(
      domainBySource.map(s => [s.source, s._count.id])
    );
    const ipSourceMap = Object.fromEntries(
      ipBySource.map(s => [s.source, s._count.id])
    );

    const enrichedSources = sources.map(s => ({
      ...s,
      domainCount: domainSourceMap[s.id] || 0,
      ipCount: ipSourceMap[s.id] || 0,
      totalCount: (domainSourceMap[s.id] || 0) + (ipSourceMap[s.id] || 0),
    }));

    // Find orphan sources: DB source values not in the predefined list
    const knownSourceIds = new Set(sources.map(s => s.id));
    const orphanDomainSources = domainBySource.filter(s => !knownSourceIds.has(s.source));
    const orphanIpSources = ipBySource.filter(s => !knownSourceIds.has(s.source));
    const allOrphanSourceIds = new Set([
      ...orphanDomainSources.map(s => s.source),
      ...orphanIpSources.map(s => s.source),
    ]);

    // Add orphan source entries so the breakdown adds up to the total
    for (const sourceId of allOrphanSourceIds) {
      const dc = domainSourceMap[sourceId] || 0;
      const ic = ipSourceMap[sourceId] || 0;
      enrichedSources.push({
        id: sourceId,
        name: sourceId,
        description: '未分类来源',
        type: (dc > 0 && ic > 0) ? 'both' : dc > 0 ? 'domain' : 'ip',
        url: '',
        queryOnly: false,
        domainCount: dc,
        ipCount: ic,
        totalCount: dc + ic,
      });
    }

    return NextResponse.json({
      summary: {
        totalDomains,
        totalIps,
        total: totalDomains + totalIps,
      },
      sources: enrichedSources,
      categories: {
        domains: domainByCategory.map(c => ({ category: c.category, count: c._count.id })),
        ips: ipByCategory.map(c => ({ category: c.category, count: c._count.id })),
      },
      severities: {
        domains: domainBySeverity.map(s => ({ severity: s.severity, count: s._count.id })),
        ips: ipBySeverity.map(s => ({ severity: s.severity, count: s._count.id })),
      },
    });
  } catch (error) {
    console.error('Failed to fetch threat intel stats:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
