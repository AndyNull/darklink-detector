import type { ScanResultData, ScanProgress, LogEntry } from './types';

// ─── In-memory task store using globalThis ─────────────────────────────────────
// CRITICAL: Next.js Turbopack may create separate module instances for different
// API routes. Using globalThis ensures all routes share the same state.

interface ScanStoreState {
  taskResults: Map<string, ScanResultData[]>;
  taskProgress: Map<string, ScanProgress>;
  taskLogs: Map<string, LogEntry[]>;
  taskTimestamps: Map<string, number>;
  activeScanPromises: Map<string, Promise<void>>;
}

const GLOBAL_KEY = '__darklink_scan_store__';

function getStore(): ScanStoreState {
  if (!(globalThis as any)[GLOBAL_KEY]) {
    (globalThis as any)[GLOBAL_KEY] = {
      taskResults: new Map<string, ScanResultData[]>(),
      taskProgress: new Map<string, ScanProgress>(),
      taskLogs: new Map<string, LogEntry[]>(),
      taskTimestamps: new Map<string, number>(),
      activeScanPromises: new Map<string, Promise<void>>(),
    };
  }
  return (globalThis as any)[GLOBAL_KEY];
}

// ─── Results ──────────────────────────────────────────────────────────────────

export function getTaskResults(taskId: string): ScanResultData[] | undefined {
  return getStore().taskResults.get(taskId);
}

export function setTaskResults(taskId: string, results: ScanResultData[]): void {
  getStore().taskResults.set(taskId, results);
  ensureTimestamp(taskId);
}

export function addTaskResult(taskId: string, result: ScanResultData): void {
  const store = getStore();
  const existing = store.taskResults.get(taskId) || [];
  existing.push(result);
  store.taskResults.set(taskId, existing);
  ensureTimestamp(taskId);
}

// ─── Progress ─────────────────────────────────────────────────────────────────

export function getTaskProgress(taskId: string): ScanProgress | undefined {
  return getStore().taskProgress.get(taskId);
}

export function setTaskProgress(taskId: string, progress: ScanProgress): void {
  getStore().taskProgress.set(taskId, progress);
  ensureTimestamp(taskId);
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export function getTaskLogs(taskId: string): LogEntry[] | undefined {
  return getStore().taskLogs.get(taskId);
}

export function addTaskLog(taskId: string, log: LogEntry): void {
  const store = getStore();
  const existing = store.taskLogs.get(taskId) || [];
  existing.push(log);
  store.taskLogs.set(taskId, existing);
  ensureTimestamp(taskId);
}

// ─── Task existence / removal ─────────────────────────────────────────────────

export function taskExists(taskId: string): boolean {
  const store = getStore();
  return store.taskResults.has(taskId) || store.taskProgress.has(taskId);
}

export function removeTask(taskId: string): void {
  const store = getStore();
  store.taskResults.delete(taskId);
  store.taskProgress.delete(taskId);
  store.taskLogs.delete(taskId);
  store.taskTimestamps.delete(taskId);
}

// ─── List all tasks ──────────────────────────────────────────────────────────

export function listTasks(): Array<{ taskId: string; createdAt: number; status: string }> {
  const store = getStore();
  const tasks: Array<{ taskId: string; createdAt: number; status: string }> = [];
  for (const [taskId, timestamp] of store.taskTimestamps) {
    const progress = store.taskProgress.get(taskId);
    tasks.push({
      taskId,
      createdAt: timestamp,
      status: progress?.status || 'unknown',
    });
  }
  return tasks.sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/** Remove tasks older than 1 hour to prevent memory leaks */
export function cleanup(): number {
  const store = getStore();
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  let removed = 0;

  for (const [taskId, timestamp] of store.taskTimestamps) {
    if (now - timestamp > ONE_HOUR) {
      removeTask(taskId);
      removed++;
    }
  }

  return removed;
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function ensureTimestamp(taskId: string): void {
  const store = getStore();
  if (!store.taskTimestamps.has(taskId)) {
    store.taskTimestamps.set(taskId, Date.now());
  }
}

// ─── Background scan registry ─────────────────────────────────────────────────

export function registerScanPromise(taskId: string, promise: Promise<void>): void {
  const store = getStore();
  store.activeScanPromises.set(taskId, promise);
  promise.finally(() => {
    store.activeScanPromises.delete(taskId);
  });
}

// ─── Periodic cleanup (auto-start) ─────────────────────────────────────────────
const globalScope = globalThis as any;
if (!globalScope.__SCAN_TASK_CLEANUP_TIMER__) {
  globalScope.__SCAN_TASK_CLEANUP_TIMER__ = setInterval(() => {
    const removed = cleanup();
    if (removed > 0) console.log(`[TaskStore] Periodic cleanup: removed ${removed} old task(s)`);
  }, 15 * 60 * 1000); // Every 15 minutes
}
