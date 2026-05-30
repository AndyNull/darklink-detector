import { NextRequest, NextResponse } from 'next/server';
import { getTaskProgress, getTaskResults } from '@/lib/scan-engine/task-store';
import { isTaskRunning } from '@/lib/scan-engine/scan-engine';

export const dynamic = 'force-dynamic';

// NOTE: GET is publicly accessible — viewing scan status does not require login
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');

  if (!taskId) {
    return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
  }

  const progress = getTaskProgress(taskId);
  const results = getTaskResults(taskId) || [];

  return NextResponse.json({
    taskId,
    progress: progress || { taskId, totalUrls: 0, completedUrls: 0, progress: 0, status: 'pending' },
    resultCount: results.length,
    isRunning: isTaskRunning(taskId),
  });
}
