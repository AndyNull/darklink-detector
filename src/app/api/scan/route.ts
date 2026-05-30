import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAuth } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ─── Shared state via globalThis ──────────────────────────────────────────────
// Next.js Turbopack may create separate module instances for different API routes.
// Using globalThis ensures all requests share the same state and scan engine.

interface ScanStoreState {
  taskResults: Map<string, any[]>;
  taskProgress: Map<string, any>;
  taskLogs: Map<string, any[]>;
  taskTimestamps: Map<string, number>;
  activeScanPromises: Map<string, Promise<void>>;
  activeTasks: Map<string, any>; // AbortController
}

const GLOBAL_KEY = '__darklink_scan_store__';

function getStore(): ScanStoreState {
  if (!(globalThis as any)[GLOBAL_KEY]) {
    (globalThis as any)[GLOBAL_KEY] = {
      taskResults: new Map(),
      taskProgress: new Map(),
      taskLogs: new Map(),
      taskTimestamps: new Map(),
      activeScanPromises: new Map(),
      activeTasks: new Map(),
    };
  }
  return (globalThis as any)[GLOBAL_KEY];
}

// ─── Scan Engine (inline) ─────────────────────────────────────────────────────

const MAX_JS_REDIRECTS = 3;
const MAX_EXTERNAL_JS = 10;
const MAX_EXTERNAL_CSS = 10;
const EXTERNAL_FETCH_CONCURRENCY = 5;

// Import scan engine functions dynamically
async function getScanEngine() {
  const { executeScan, stopTask, isTaskRunning } = await import('@/lib/scan-engine/scan-engine');
  return { executeScan, stopTask, isTaskRunning };
}

// ─── Route Handler ─────────────────────────────────────────────────────────────

// NOTE: GET endpoints are publicly accessible — viewing scan status/results does not require login
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'status';
  const taskId = url.searchParams.get('taskId');

  const store = getStore();

  switch (action) {
    case 'health': {
      return NextResponse.json({
        status: 'ok',
        activeTasks: store.activeScanPromises.size,
        uptime: Math.floor(process.uptime()),
        engine: 'integrated',
      });
    }

    case 'status': {
      if (!taskId) {
        return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
      }
      const progress = store.taskProgress.get(taskId);
      const results = store.taskResults.get(taskId) || [];
      const { isTaskRunning } = await getScanEngine();
      return NextResponse.json({
        taskId,
        progress: progress || { taskId, totalUrls: 0, completedUrls: 0, progress: 0, status: 'pending' },
        resultCount: results.length,
        isRunning: isTaskRunning(taskId),
      });
    }

    case 'results': {
      if (!taskId) {
        return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
      }
      const results = store.taskResults.get(taskId) || [];
      const progress = store.taskProgress.get(taskId);
      const allLogs = store.taskLogs.get(taskId) || [];

      // Incremental polling: if sinceResultCount/sinceLogCount are specified,
      // only return new results/logs since that index
      const sinceResultCount = parseInt(url.searchParams.get('sinceResultCount') || '0', 10);
      const sinceLogCount = parseInt(url.searchParams.get('sinceLogCount') || '0', 10);

      const newResults = sinceResultCount > 0 ? results.slice(sinceResultCount) : results;
      const newLogs = sinceLogCount > 0 ? allLogs.slice(sinceLogCount) : allLogs;

      // Strip rawHtml from results by default to reduce network payload
      // (rawHtml can be 50KB+ per result; only include when explicitly requested)
      const includeRawHtml = url.searchParams.get('includeRawHtml') === 'true';
      const strippedResults = includeRawHtml
        ? newResults
        : newResults.map((r: any) => {
            const { rawHtml, ...rest } = r;
            return rest;
          });

      const responseData = safeStringify({
        taskId,
        results: strippedResults,
        totalResultCount: results.length,
        totalLogCount: allLogs.length,
        progress,
        logs: newLogs,
      });
      return new NextResponse(responseData, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    case 'list': {
      const tasks: Array<{ taskId: string; createdAt: number; status: string; urlCount: number; darkLinks: number; qrCodes: number; firstUrl?: string }> = [];
      for (const [tid, timestamp] of store.taskTimestamps) {
        const progress = store.taskProgress.get(tid);
        const results = store.taskResults.get(tid) || [];
        tasks.push({
          taskId: tid,
          createdAt: timestamp,
          status: progress?.status || 'unknown',
          urlCount: results.length,
          darkLinks: results.reduce((s: number, r: any) => s + (r.darkLinks || 0), 0),
          qrCodes: results.reduce((s: number, r: any) => s + (r.qrCodes || 0), 0),
          firstUrl: results.length > 0 ? results[0].url : undefined,
        });
      }
      tasks.sort((a, b) => b.createdAt - a.createdAt);
      return NextResponse.json({ tasks });
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'start';

  const store = getStore();

  switch (action) {
    case 'start': {
      // Rate limit: 10 scan starts per minute per IP
      const rateLimit = checkRateLimit(request, { windowMs: 60_000, maxRequests: 10 });
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Too many scan requests. Please try again later.', resetIn: rateLimit.resetIn },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)) } },
        );
      }

      try {
        const body = await request.json();
        const { taskId, request: scanRequest } = body;

        if (!taskId || !scanRequest || !scanRequest.urls) {
          return NextResponse.json({ error: 'Missing taskId or request' }, { status: 400 });
        }

        // Cleanup old tasks
        cleanupOldTasks(store);

        // Initialize task storage
        store.taskResults.set(taskId, []);
        store.taskLogs.set(taskId, []);
        store.taskTimestamps.set(taskId, Date.now());

        console.log(`[SCAN] Task started: ${taskId}, URLs: ${scanRequest.urls.length}`);

        const { executeScan } = await getScanEngine();

        const onProgress = (progress: any) => {
          store.taskProgress.set(taskId, progress);
        };

        const onResult = (result: any) => {
          const existing = store.taskResults.get(taskId) || [];
          existing.push(result);
          store.taskResults.set(taskId, existing);
        };

        const onLog = (log: any) => {
          const existing = store.taskLogs.get(taskId) || [];
          existing.push(log);
          store.taskLogs.set(taskId, existing);
        };

        // Run scan in a separate microtask to decouple from request lifecycle
        const scanPromise = new Promise<void>((resolve) => {
          setTimeout(() => {
            executeScan(taskId, scanRequest, onProgress, onResult, onLog)
              .then(() => {
                console.log(`[SCAN] Task completed: ${taskId}`);
                resolve();
              })
              .catch((err: any) => {
                console.error(`[SCAN] Task error: ${taskId}`, err);
                onLog({
                  level: 'error',
                  message: `扫描任务执行出错: ${err.message}`,
                  timestamp: new Date(),
                });
                resolve();
              });
          }, 100);
        });

        // Keep the promise reference alive
        store.activeScanPromises.set(taskId, scanPromise);
        scanPromise.finally(() => {
          store.activeScanPromises.delete(taskId);
        });

        return NextResponse.json({ taskId, status: 'started' }, { status: 202 });
      } catch (err) {
        console.error('[SCAN] Start error:', err);
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }
    }

    case 'stop': {
      try {
        const { taskId } = await request.json();
        if (!taskId) {
          return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
        }
        const { stopTask } = await getScanEngine();
        const stopped = stopTask(taskId);
        return NextResponse.json({ taskId, stopped });
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }
    }

    case 'delete': {
      try {
        const sessionError = requireSessionAuth(request);
        if (sessionError) return sessionError;
        const { taskId } = await request.json();
        if (!taskId) {
          return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
        }
        store.taskResults.delete(taskId);
        store.taskProgress.delete(taskId);
        store.taskLogs.delete(taskId);
        store.taskTimestamps.delete(taskId);
        return NextResponse.json({ taskId, deleted: true });
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 400 });
      }
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function safeStringify(obj: any): string {
  return JSON.stringify(obj, (key, value) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return value.toString();
    return value;
  });
}

function cleanupOldTasks(store: ScanStoreState): number {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  let removed = 0;

  for (const [taskId, timestamp] of store.taskTimestamps) {
    if (now - timestamp > ONE_HOUR) {
      store.taskResults.delete(taskId);
      store.taskProgress.delete(taskId);
      store.taskLogs.delete(taskId);
      store.taskTimestamps.delete(taskId);
      removed++;
    }
  }

  return removed;
}
