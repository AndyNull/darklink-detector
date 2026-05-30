import { PrismaClient } from '../node_modules/@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const entries = await prisma.threatIntelEntry.groupBy({
    by: ['sourceId'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });
  console.log('=== ThreatIntelEntry by source ===');
  for (const e of entries) {
    console.log(`  ${e.sourceId}: ${e._count.id}`);
  }

  const domains = await prisma.maliciousDomain.groupBy({
    by: ['source'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });
  console.log('\n=== MaliciousDomain by source ===');
  for (const d of domains) {
    console.log(`  ${d.source}: ${d._count.id}`);
  }

  const ips = await prisma.maliciousIP.groupBy({
    by: ['source'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });
  console.log('\n=== MaliciousIP by source ===');
  for (const i of ips) {
    console.log(`  ${i.source}: ${i._count.id}`);
  }

  const sources = await prisma.threatIntelSource.findMany({
    orderBy: { sourceId: 'asc' },
  });
  console.log('\n=== ThreatIntelSource ===');
  for (const s of sources) {
    console.log(`  ${s.sourceId}: status=${s.status}, entryCount=${s.entryCount}, lastUpdate=${s.lastUpdate}`);
  }

  const totalEntries = await prisma.threatIntelEntry.count();
  const totalDomains = await prisma.maliciousDomain.count();
  const totalIPs = await prisma.maliciousIP.count();
  console.log(`\n=== Total: ${totalEntries} entries, ${totalDomains} domains, ${totalIPs} IPs ===`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
