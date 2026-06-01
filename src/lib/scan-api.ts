'use client';

import type {
  ScanRequest,
  ScanResultData,
  ScanProgress as EngineScanProgress,
} from '@/lib/scan-engine/types';

import { getAuthHeaders } from '@/lib/auth-context';

// REST API client for the scan engine - unified API route
// All operations go through /api/scan?action=xxx

export interface ScanStartResponse {
  taskId: string;
  status: string;
}

export interface ScanStatusResponse {
  taskId: string;
  progress: EngineScanProgress;
  resultCount: number;
  isRunning: boolean;
}

/** Scan result as returned by the API (extends engine type with optional rawHtml) */
export interface ApiScanResult extends ScanResultData {
  rawHtml?: string;
}

/** Log entry as returned by the API (timestamp is serialized, not a Date object) */
export interface ApiLogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  detail?: string;
  timestamp: number | string;
}

export interface ScanResultsResponse {
  taskId: string;
  results: ApiScanResult[];
  /** Total result count on server (for incremental polling sync) */
  totalResultCount?: number;
  /** Total log count on server (for incremental polling sync) */
  totalLogCount?: number;
  progress: EngineScanProgress;
  logs: ApiLogEntry[];
}

export interface HealthResponse {
  status: string;
  activeTasks: number;
  uptime: number;
}

export interface TaskInfo {
  taskId: string;
  createdAt: number;
  status: string;
  urlCount: number;
  darkLinks: number;
  qrCodes: number;
  firstUrl?: string;
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/scan?action=health');
  if (!res.ok) throw new Error('Engine not available');
  return res.json();
}

export async function startScan(taskId: string, request: ScanRequest): Promise<ScanStartResponse> {
  const res = await fetch('/api/scan?action=start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, request }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to start scan' }));
    throw new Error(err.error || 'Failed to start scan');
  }
  return res.json();
}

export async function stopScan(taskId: string): Promise<{ taskId: string; stopped: boolean }> {
  const res = await fetch('/api/scan?action=stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
  });
  if (!res.ok) throw new Error('Failed to stop scan');
  return res.json();
}

export async function deleteScan(taskId: string): Promise<{ taskId: string; deleted: boolean }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...getAuthHeaders() };
  const res = await fetch('/api/scan?action=delete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ taskId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to delete scan' }));
    throw new Error(err.error || 'Failed to delete scan');
  }
  return res.json();
}

export async function getScanStatus(taskId: string): Promise<ScanStatusResponse> {
  const res = await fetch(`/api/scan?action=status&taskId=${encodeURIComponent(taskId)}`);
  if (!res.ok) throw new Error('Failed to get scan status');
  return res.json();
}

export async function getScanResults(taskId: string, sinceResultCount = 0, sinceLogCount = 0): Promise<ScanResultsResponse> {
  const params = new URLSearchParams({ taskId: encodeURIComponent(taskId) });
  if (sinceResultCount > 0) params.set('sinceResultCount', String(sinceResultCount));
  if (sinceLogCount > 0) params.set('sinceLogCount', String(sinceLogCount));
  const res = await fetch(`/api/scan?action=results&${params.toString()}`);
  if (!res.ok) throw new Error('Failed to get scan results');
  return res.json();
}

export async function getTaskList(): Promise<{ tasks: TaskInfo[] }> {
  const res = await fetch('/api/scan?action=list');
  if (!res.ok) throw new Error('Failed to get task list');
  return res.json();
}

export interface SublinksResponse {
  url: string;
  hostname: string;
  sublinks: string[];
  count: number;
}

export async function discoverSublinks(url: string, maxLinks: number = 200, maxDepth: number = 2): Promise<SublinksResponse> {
  const res = await fetch('/api/scan/sublinks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, maxLinks, maxDepth: Math.min(maxDepth, 5) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to discover sublinks' }));
    throw new Error(err.error || 'Failed to discover sublinks');
  }
  return res.json();
}

// Polling helper - polls until scan is complete
export function pollScanUntilComplete(
  taskId: string,
  onProgress: (progress: EngineScanProgress) => void,
  onResult: (result: ApiScanResult) => void,
  onLog: (log: ApiLogEntry) => void,
  intervalMs: number = 1500,
): { stop: () => void } {
  let stopped = false;
  let lastResultCount = 0;
  let lastLogCount = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const MAX_POLL_DURATION = 10 * 60 * 1000; // 10 minutes max
  const startTime = Date.now();

  const poll = async () => {
    if (stopped) return;

    // Check if polling has exceeded the maximum duration
    if (Date.now() - startTime > MAX_POLL_DURATION) {
      onLog({ level: 'error', message: '扫描轮询超时（10分钟），请检查扫描引擎状态', timestamp: Date.now() });
      onProgress({ taskId, totalUrls: 0, completedUrls: 0, progress: 0, status: 'error' });
      stopped = true;
      return;
    }

    try {
      // Use incremental polling: only fetch new results/logs since last check
      const data = await getScanResults(taskId, lastResultCount, lastLogCount);

      // Process new results (incremental)
      if (data.results && data.results.length > 0) {
        for (const result of data.results) {
          onResult(result);
        }
      }
      // Update counters from total counts returned by the server
      if (data.totalResultCount !== undefined) {
        lastResultCount = data.totalResultCount;
      } else if (data.results) {
        lastResultCount += data.results.length;
      }

      // Process new logs (incremental)
      if (data.logs && data.logs.length > 0) {
        for (const log of data.logs) {
          onLog(log);
        }
      }
      if (data.totalLogCount !== undefined) {
        lastLogCount = data.totalLogCount;
      } else if (data.logs) {
        lastLogCount += data.logs.length;
      }

      // Report progress
      if (data.progress) {
        onProgress(data.progress);
      }

      // Check if done
      if (data.progress && (data.progress.status === 'completed' || data.progress.status === 'stopped' || data.progress.status === 'error')) {
        return;
      }
    } catch (err) {
      console.error('Poll error:', err);
    }

    if (!stopped) {
      timeoutId = setTimeout(poll, intervalMs);
    }
  };

  function stop() {
    stopped = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  // Start polling after a short delay
  timeoutId = setTimeout(poll, 500);

  return { stop };
}
