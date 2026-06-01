import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

// ─── Shared state via globalThis (same as scan route) ─────────────────────────
interface ScanStoreState {
  taskResults: Map<string, any[]>;
  taskProgress: Map<string, any>;
  taskLogs: Map<string, any[]>;
  taskTimestamps: Map<string, number>;
  activeScanPromises: Map<string, Promise<void>>;
  activeTasks: Map<string, any>;
}

const GLOBAL_KEY = '__darklink_scan_store__';

function getStore(): ScanStoreState | null {
  return (globalThis as any)[GLOBAL_KEY] || null;
}

export async function GET() {
  const store = getStore();
  const activeTasks = store?.activeScanPromises.size ?? 0;

  // Check database connectivity
  let dbStatus = 'ok';
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'error';
  }

  // Check mini-services (non-blocking, short timeout)
  let scanEngine = 'unknown';
  let dataSync = 'unknown';
  try {
    const scanRes = await fetch('http://localhost:3003/health', { signal: AbortSignal.timeout(2000) });
    if (scanRes.ok) scanEngine = 'ok';
    else scanEngine = 'degraded';
  } catch {
    scanEngine = 'unreachable';
  }
  try {
    const syncRes = await fetch('http://localhost:3004/health', { signal: AbortSignal.timeout(2000) });
    if (syncRes.ok) dataSync = 'ok';
    else dataSync = 'degraded';
  } catch {
    dataSync = 'unreachable';
  }

  const overallStatus = dbStatus === 'ok' ? 'ok' : 'degraded';

  return NextResponse.json({
    status: overallStatus,
    version: APP_VERSION,
    activeTasks,
    uptime: Math.floor(process.uptime()),
    engine: 'integrated',
    database: dbStatus,
    services: {
      scanEngine,
      dataSync,
    },
  });
}
