import { NextRequest, NextResponse } from 'next/server';
import {
  getServiceStatus,
  getAllServiceNames,
  autoStartOfflineServices,
  type ServiceName,
  type ServiceStatus,
} from '@/lib/engine-manager';

export const dynamic = 'force-dynamic';

// Auto-start cooldown — only attempt auto-start once every 30 seconds
let lastAutoStartAttempt = 0;
const AUTO_START_COOLDOWN_MS = 30000;

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

    // Auto-start offline services (with cooldown to avoid excessive restart attempts)
    const anyOffline = scanEngineStatus[1].status === 'offline' || dataSyncStatus[1].status === 'offline';
    if (anyOffline) {
      const now = Date.now();
      if (now - lastAutoStartAttempt > AUTO_START_COOLDOWN_MS) {
        lastAutoStartAttempt = now;
        // Fire and forget — don't block the status response
        autoStartOfflineServices().catch(() => {});
      }
    }

    return NextResponse.json({
      scanEngine: {
        status: scanEngineStatus[1].status,
        port: scanEngineStatus[1].port,
        uptime: scanEngineStatus[1].uptime,
        activeTasks: scanEngineStatus[1].activeTasks,
      },
      dataSyncService: {
        status: dataSyncStatus[1].status,
        port: dataSyncStatus[1].port,
        uptime: dataSyncStatus[1].uptime,
        connectedClients: dataSyncStatus[1].connectedClients,
      },
    });
  } catch (err) {
    console.error('[ENGINE] Status check error:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
