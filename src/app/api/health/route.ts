import { NextResponse } from 'next/server';

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

  return NextResponse.json({
    status: 'ok',
    activeTasks,
    uptime: Math.floor(process.uptime()),
    engine: 'integrated',
  });
}
