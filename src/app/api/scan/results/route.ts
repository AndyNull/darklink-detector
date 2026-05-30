import { NextRequest, NextResponse } from 'next/server';
import { getTaskResults, getTaskProgress, getTaskLogs } from '@/lib/scan-engine/task-store';

export const dynamic = 'force-dynamic';

// Safe JSON serialization that handles Date objects and other non-serializable values
function safeStringify(obj: any): string {
  return JSON.stringify(obj, (key, value) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  });
}

// NOTE: GET is publicly accessible — viewing scan results does not require login
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');

  if (!taskId) {
    return NextResponse.json({ error: 'Missing taskId' }, { status: 400 });
  }

  try {
    const results = getTaskResults(taskId) || [];
    const progress = getTaskProgress(taskId);
    const logs = getTaskLogs(taskId) || [];

    const responseData = safeStringify({ taskId, results, progress, logs });

    return new NextResponse(responseData, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[SCAN] Error serializing results:', err);
    return NextResponse.json({ error: 'Failed to serialize results' }, { status: 500 });
  }
}
