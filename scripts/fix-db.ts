import { PrismaClient } from '../node_modules/@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Reset stuck "collecting" sources to "idle"
  const stuckSources = await prisma.threatIntelSource.findMany({
    where: { status: 'collecting' },
  });
  console.log(`Found ${stuckSources.length} sources stuck in "collecting" status:`);
  for (const s of stuckSources) {
    console.log(`  - ${s.sourceId}: resetting to "idle"`);
  }
  
  if (stuckSources.length > 0) {
    const result = await prisma.threatIntelSource.updateMany({
      where: { status: 'collecting' },
      data: { status: 'idle' },
    });
    console.log(`Reset ${result.count} sources to "idle"`);
  }

  // 2. Recalculate entryCount for all sources
  const allSources = await prisma.threatIntelSource.findMany();
  console.log(`\nRecalculating entryCount for ${allSources.length} sources:`);
  
  for (const source of allSources) {
    const [domainCount, ipCount, entryCount] = await Promise.all([
      prisma.maliciousDomain.count({ where: { source: source.sourceId } }),
      prisma.maliciousIP.count({ where: { source: source.sourceId } }),
      prisma.threatIntelEntry.count({ where: { sourceId: source.sourceId } }),
    ]);
    const totalCount = domainCount + ipCount + entryCount;
    
    const oldCount = source.entryCount;
    if (oldCount !== totalCount) {
      console.log(`  - ${source.sourceId}: ${oldCount} → ${totalCount} (domains=${domainCount}, ips=${ipCount}, entries=${entryCount})`);
      await prisma.threatIntelSource.update({
        where: { sourceId: source.sourceId },
        data: { entryCount: totalCount },
      });
    } else {
      console.log(`  - ${source.sourceId}: ${totalCount} (correct)`);
    }
  }

  // 3. Check for SyncTask stuck in "running" status
  const stuckSyncTasks = await prisma.syncTask.findMany({
    where: { status: 'running' },
  });
  console.log(`\nFound ${stuckSyncTasks.length} SyncTasks stuck in "running" status`);
  for (const t of stuckSyncTasks) {
    await prisma.syncTask.update({
      where: { id: t.id },
      data: { status: 'cancelled', completedAt: new Date(), error: 'Server restart - task interrupted' },
    });
    console.log(`  - ${t.id} (${t.name}): cancelled`);
  }

  console.log('\n✅ Database fix completed!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
