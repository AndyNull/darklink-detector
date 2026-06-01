import { NextRequest, NextResponse } from 'next/server';
import { executeScan, stopTask, isTaskRunning } from '@/lib/scan-engine/scan-engine';
import { addTaskResult, setTaskProgress, addTaskLog, setTaskResults, registerScanPromise } from '@/lib/scan-engine/task-store';
import { cleanup } from '@/lib/scan-engine/task-store';
import type { ScanRequest, ScanProgress, ScanResultData, LogEntry } from '@/lib/scan-engine/types';
import { validateScanUrls } from '@/lib/security';
import { checkRateLimit } from '@/lib/rate-limit';
import { auditLog } from '@/lib/audit-logger';
import { safeErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// NOTE: Scan start is publicly accessible — no login required per design
export async function POST(request: NextRequest) {
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

    // SSRF validation: validate all scan URLs before proceeding
    const { valid, invalid } = validateScanUrls(scanRequest.urls);
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: 'Invalid URLs detected', invalidUrls: invalid },
        { status: 400 },
      );
    }

    // Use only validated URLs
    scanRequest.urls = valid;

    // Cleanup old tasks periodically
    cleanup();

    // Initialize task storage
    setTaskResults(taskId, []);

    console.log(`[SCAN] Task started: ${taskId}, URLs: ${scanRequest.urls.length}`);

    // Log task creation
    const scanIp = request.headers.get('x-real-ip') ||
                   request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                   'unknown';
    auditLog.task('scan_started', 'system', `Scan task ${taskId} started with ${scanRequest.urls.length} URL(s)`, scanIp, 'scan_task', taskId).catch(() => {});

    const onProgress = (progress: ScanProgress) => {
      setTaskProgress(taskId, progress);
    };

    const onResult = (result: ScanResultData) => {
      addTaskResult(taskId, result);
    };

    const onLog = (log: LogEntry) => {
      addTaskLog(taskId, log);
    };

    // Run scan in background - register the promise to prevent GC
    const scanPromise = executeScan(taskId, scanRequest as ScanRequest, onProgress, onResult, onLog).catch((err) => {
      console.error(`[SCAN] Task error: ${taskId}`, err);
      addTaskLog(taskId, {
        level: 'error',
        message: `扫描任务执行出错: ${(err as Error).message}`,
        timestamp: new Date(),
      });
    });

    // Keep the promise alive in the registry
    registerScanPromise(taskId, scanPromise);

    // Also try waitUntil for Next.js 14.1+
    try {
      const reqAny = request as unknown as Record<string, unknown>;
      if (typeof reqAny.waitUntil === 'function') {
        (reqAny.waitUntil as (promise: Promise<unknown>) => void)(scanPromise);
      }
    } catch(e) { console.warn('Error:', e); }

    return NextResponse.json({ taskId, status: 'started' }, { status: 202 });
  } catch (err) {
    console.error('[SCAN] Start error:', err);
    return safeErrorResponse(err, '扫描启动失败');
  }
}
