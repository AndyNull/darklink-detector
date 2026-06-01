/**
 * Engine Manager — shared utility for managing scan-engine and data-sync-service
 * child processes from Next.js API routes.
 *
 * Process references are stored in `globalThis.__engine_processes__` as a Map
 * so they survive HMR / route re-evaluation within the same Node.js process.
 */

import type { ChildProcess } from 'child_process';
import path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServiceName = 'scan-engine' | 'data-sync-service';

export interface ServiceConfig {
  name: ServiceName;
  label: string;
  port: number;
  directory: string;
  command: string;
  args: string[];
  healthUrl: string;
}

export interface ServiceStatus {
  status: 'online' | 'offline';
  port: number;
  uptime?: number;
  activeTasks?: number;
  connectedClients?: number;
}

export interface HealthCheckResult {
  status: 'ok' | 'error';
  uptime?: number;
  activeTasks?: number;
  connectedClients?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SERVICE_CONFIGS: Record<ServiceName, ServiceConfig> = {
  'scan-engine': {
    name: 'scan-engine',
    label: '扫描引擎',
    port: 3003,
    directory: path.join(process.cwd(), 'mini-services/scan-engine'),
    command: 'bun',
    args: ['index.ts'],
    healthUrl: 'http://localhost:3003/health',
  },
  'data-sync-service': {
    name: 'data-sync-service',
    label: '数据同步服务',
    port: 3004,
    directory: path.join(process.cwd(), 'mini-services/data-sync-service'),
    command: 'bun',
    args: ['index.ts'],
    healthUrl: 'http://localhost:3004/health',
  },
};

// ─── Global Process Store ─────────────────────────────────────────────────────

const GLOBAL_KEY = '__engine_processes__';
const AUTO_START_DISABLED_KEY = '__engine_auto_start_disabled__';

interface ProcessEntry {
  process: ChildProcess;
  startedAt: number;
  service: ServiceName;
}

function getProcessMap(): Map<ServiceName, ProcessEntry> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<ServiceName, ProcessEntry>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<ServiceName, ProcessEntry>;
}

// Track services that were manually stopped (don't auto-start these)
function getAutoStartDisabledSet(): Set<ServiceName> {
  if (!(globalThis as Record<string, unknown>)[AUTO_START_DISABLED_KEY]) {
    (globalThis as Record<string, unknown>)[AUTO_START_DISABLED_KEY] = new Set<ServiceName>();
  }
  return (globalThis as Record<string, unknown>)[AUTO_START_DISABLED_KEY] as Set<ServiceName>;
}

export function markAutoStartDisabled(service: ServiceName) {
  getAutoStartDisabledSet().add(service);
}

export function clearAutoStartDisabled(service: ServiceName) {
  getAutoStartDisabledSet().delete(service);
}

export function isAutoStartDisabled(service: ServiceName): boolean {
  return getAutoStartDisabledSet().has(service);
}

// ─── Health Check ─────────────────────────────────────────────────────────────

/**
 * Check the health of a service by fetching its /health endpoint.
 * Returns parsed health data or null if the service is unreachable.
 * Includes retry logic: if the first attempt fails, retries up to 2 more times
 * with short delays to avoid false negatives during service startup.
 */
export async function checkServiceHealth(service: ServiceName, retries = 0): Promise<HealthCheckResult | null> {
  const config = SERVICE_CONFIGS[service];
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      // Short timeout (2s) — these are local services on localhost,
      // they should respond within milliseconds if running.
      // Long timeouts block the event loop and cascade into server crashes.
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(config.healthUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 300));
          continue;
        }
        return null;
      }

      const data = await response.json() as HealthCheckResult;
      return data;
    } catch {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      return null;
    }
  }
  
  return null;
}

/**
 * Get the full status of a single service.
 */
export async function getServiceStatus(service: ServiceName): Promise<ServiceStatus> {
  const config = SERVICE_CONFIGS[service];
  const health = await checkServiceHealth(service);

  if (!health || health.status !== 'ok') {
    // Check if we have a tracked process — it might be starting up
    const processMap = getProcessMap();
    const entry = processMap.get(service);
    if (entry && entry.process.exitCode === null) {
      // Process is running but health check failed — probably still starting
      return {
        status: 'offline',
        port: config.port,
      };
    }
    return { status: 'offline', port: config.port };
  }

  return {
    status: 'online',
    port: config.port,
    uptime: health.uptime,
    activeTasks: health.activeTasks,
    connectedClients: health.connectedClients,
  };
}

// ─── Start Service ────────────────────────────────────────────────────────────

/**
 * Start a service by spawning a child process.
 * Returns the PID of the spawned process.
 * Throws if the service is already running.
 */
export async function startService(service: ServiceName): Promise<number> {
  const config = SERVICE_CONFIGS[service];
  const processMap = getProcessMap();

  // Check if already tracked and running
  const existing = processMap.get(service);
  if (existing && existing.process.exitCode === null) {
    throw new Error(`${config.label}已在运行中 (PID: ${existing.process.pid})`);
  }

  // Also check health endpoint — service might be running outside our control
  const health = await checkServiceHealth(service);
  if (health && health.status === 'ok') {
    throw new Error(`${config.label}已在运行中（检测到健康检查响应）`);
  }

  // Clean up stale entry if any
  if (existing) {
    processMap.delete(service);
  }

  // Spawn the process as detached so it survives the parent exiting
  const { spawn } = await import('child_process');
  const child = spawn(config.command, config.args, {
    cwd: config.directory,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  });

  const pid = child.pid;

  if (!pid) {
    throw new Error(`启动${config.label}失败：无法获取进程ID`);
  }

  // Store in global map
  processMap.set(service, {
    process: child,
    startedAt: Date.now(),
    service,
  });

  // Handle unexpected exit
  child.on('exit', (code, signal) => {
    console.log(`[${config.name}] 进程退出: code=${code}, signal=${signal}`);
    processMap.delete(service);
  });

  child.on('error', (err) => {
    console.error(`[${config.name}] 进程错误:`, err);
    processMap.delete(service);
  });

  // Detach the child — it runs independently and won't keep the parent alive
  child.unref();

  return pid;
}

// ─── Stop Service ─────────────────────────────────────────────────────────────

/**
 * Auto-start offline services that were not manually stopped.
 * Called from the status API to ensure services are running.
 * Returns the list of services that were auto-started.
 */
export async function autoStartOfflineServices(
  retryCount?: Record<string, number>,
  maxRetries?: number,
): Promise<ServiceName[]> {
  const started: ServiceName[] = [];
  const services = getAllServiceNames();
  
  for (const service of services) {
    // Skip services that were manually stopped
    if (isAutoStartDisabled(service)) continue;

    // Skip services that have exceeded max retries
    if (retryCount && maxRetries && (retryCount[service] ?? 0) >= maxRetries) {
      console.warn(`[ENGINE] Skipping auto-start for ${service}: exceeded ${maxRetries} retry limit`);
      continue;
    }
    
    // Check if service is already online
    const health = await checkServiceHealth(service, 0); // No retries for quick check
    if (health && health.status === 'ok') {
      // Service came back online — reset retry counter
      if (retryCount) retryCount[service] = 0;
      continue;
    }
    
    // Service is offline and was not manually stopped — try to start it
    try {
      console.log(`[ENGINE] Auto-starting offline service: ${service}`);
      await startService(service);
      started.push(service);
      // Clear the disabled flag since the service was auto-started
      clearAutoStartDisabled(service);
      // Reset retry counter on success
      if (retryCount) retryCount[service] = 0;
    } catch (err) {
      // If it says "already running", that's fine
      const msg = (err as Error).message || '';
      if (msg.includes('已在运行中')) {
        clearAutoStartDisabled(service);
        if (retryCount) retryCount[service] = 0;
      } else {
        console.error(`[ENGINE] Auto-start failed for ${service}:`, msg);
        // Increment retry counter
        if (retryCount) {
          retryCount[service] = (retryCount[service] ?? 0) + 1;
          const count = retryCount[service];
          if (maxRetries && count >= maxRetries) {
            console.error(`[ENGINE] Service ${service} has failed ${count} auto-start attempts — marking as failed`);
          }
        }
      }
    }
  }
  
  return started;
}

/**
 * Stop a service by killing its child process.
 * Returns true if a process was killed, false if no tracked process was found.
 */
export async function stopService(service: ServiceName): Promise<boolean> {
  const config = SERVICE_CONFIGS[service];
  const processMap = getProcessMap();
  const entry = processMap.get(service);

  if (!entry || entry.process.exitCode !== null) {
    // No tracked process — but service might be running externally
    const health = await checkServiceHealth(service);
    if (health && health.status === 'ok') {
      throw new Error(`${config.label}正在运行但不是由此管理器启动的，无法停止。请手动终止进程。`);
    }
    // Already stopped
    return false;
  }

  // Mark as manually stopped to prevent auto-start
  markAutoStartDisabled(service);

  return new Promise<boolean>((resolve) => {
    const child = entry.process;
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        processMap.delete(service);
        resolve(true);
      }
    };

    // Set a timeout to force-kill if graceful shutdown fails
    const forceKillTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Process may have already exited
      }
      cleanup();
    }, 10000);

    child.on('exit', () => {
      clearTimeout(forceKillTimer);
      cleanup();
    });

    // Try graceful shutdown first
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(forceKillTimer);
      cleanup();
    }
  });
}

/**
 * Check if a service has a tracked running process.
 */
export function isServiceTracked(service: ServiceName): boolean {
  const processMap = getProcessMap();
  const entry = processMap.get(service);
  return !!entry && entry.process.exitCode === null;
}

/**
 * Get all service names.
 */
export function getAllServiceNames(): ServiceName[] {
  return Object.keys(SERVICE_CONFIGS) as ServiceName[];
}
