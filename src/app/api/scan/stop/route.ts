import { NextRequest, NextResponse } from 'next/server';
import { stopTask, isTaskRunning } from '@/lib/scan-engine/scan-engine';
import { auditLog } from '@/lib/audit-logger';
import { requireSessionAuth } from '@/lib/api-auth';
import { safeErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = requireSessionAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { taskId } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
    }

    const stopped = stopTask(taskId);

    if (stopped) {
      const ip = request.headers.get('x-real-ip') ||
                 request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                 'unknown';
      auditLog.task('scan_stopped', 'system', `Scan task ${taskId} stopped by user`, ip, 'scan_task', taskId).catch(() => {});
    }

    return NextResponse.json({ taskId, stopped });
  } catch (err) {
    return safeErrorResponse(err, '停止扫描失败');
  }
}
