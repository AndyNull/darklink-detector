import { NextRequest, NextResponse } from 'next/server';
import {
  getServiceStatus,
  getAllServiceNames,
  autoStartOfflineServices,
  type ServiceName,
  type ServiceStatus,
} from '@/lib/engine-manager';

export const dynamic = 'force-dynamic';

// Auto-start cooldown — only attempt auto-start once every 120 seconds
let lastAutoStartAttempt = 0;
const AUTO_START_COOLDOWN_MS = 120000;

// Track consecutive auto-start failures per service; after MAX_RETRIES, stop trying
const autoStartRetryCount: Record<string, number> = {};
const MAX_AUTO_START_RETRIES = 3;

// Auto-start is DISABLED in development mode because spawning child processes
// from the Next.js dev server can cause instability (especially in sandboxed environments).
// In production (Docker), the entrypoint script starts mini-services directly.
const AUTO_START_ENABLED = process.env.NODE_ENV === 'production';

export async function GET(request: NextRequest) {
  // Engine status is publicly viewable (read-only, no sensitive data exposed)
  try {
    const services = getAllServiceNames();
    const statusEntries = await Promise.all(
      services.map(async (service: ServiceName) => {
        const status: ServiceStatus = await getServiceStatus(service);
        return [service, status] as const;
      })
    );

    const [scanEngineStatus, dataSyncStatus] = statusEntries;

    // Auto-start offline services — ONLY in production mode
    // In development, use `bun run start:all` or start mini-services manually
    if (AUTO_START_ENABLED) {
      const anyOffline = scanEngineStatus[1].status === 'offline' || dataSyncStatus[1].status === 'offline';
      const anyFailed = Object.values(autoStartRetryCount).some(c => c >= MAX_AUTO_START_RETRIES);
      if (anyOffline && !anyFailed) {
        const now = Date.now();
        if (now - lastAutoStartAttempt > AUTO_START_COOLDOWN_MS) {
          lastAutoStartAttempt = now;
          // Fire and forget — don't block the status response
          autoStartOfflineServices(autoStartRetryCount, MAX_AUTO_START_RETRIES).catch(() => {});
        }
      }
    }

    // Map status — if a service hit max retries, report 'failed' instead of 'offline'
    const mapStatus = (name: string, rawStatus: string) => {
      if (rawStatus === 'offline' && (autoStartRetryCount[name] ?? 0) >= MAX_AUTO_START_RETRIES) {
        return 'failed';
      }
      return rawStatus;
    };

    return NextResponse.json({
      scanEngine: {
        status: mapStatus('scan-engine', scanEngineStatus[1].status),
        port: scanEngineStatus[1].port,
        uptime: scanEngineStatus[1].uptime,
        activeTasks: scanEngineStatus[1].activeTasks,
      },
      dataSyncService: {
        status: mapStatus('data-sync-service', dataSyncStatus[1].status),
        port: dataSyncStatus[1].port,
        uptime: dataSyncStatus[1].uptime,
        connectedClients: dataSyncStatus[1].connectedClients,
      },
    });
  } catch (err) {
    console.error('[ENGINE] Status check error:', err);
    return NextResponse.json(
      { error: '引擎状态检查失败' },
      { status: 500 }
    );
  }
}
