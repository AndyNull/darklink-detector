import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAuth } from '@/lib/api-auth';
import { createTask, listTasks, startTask } from '@/lib/sync-task-manager';

export const dynamic = 'force-dynamic';

// GET /api/sync-tasks — List all sync tasks
// NOTE: GET is publicly accessible — viewing sync tasks does not require login
export async function GET(request: NextRequest) {
  try {
    const tasks = await listTasks();
    return NextResponse.json({ tasks });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// POST /api/sync-tasks — Create and start a new sync task
export async function POST(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  try {
    const body = await request.json().catch(() => ({}));
    const requestedSources: string[] | undefined = body.sources && Array.isArray(body.sources) ? body.sources : undefined;
    const name: string = body.name || `Sync ${new Date().toLocaleString('zh-CN')}`;
    const createdBy: string | undefined = body.createdBy;

    // Determine sources
    // Import COLLECTOR_MAP to validate sources
    const { COLLECTOR_MAP } = await import('@/app/api/threat-intel/update/route');
    const sources = requestedSources
      ? requestedSources.filter(id => COLLECTOR_MAP[id])
      : Object.keys(COLLECTOR_MAP);

    if (sources.length === 0) {
      return NextResponse.json(
        { error: 'No valid sources specified' },
        { status: 400 },
      );
    }

    // Create task in DB
    const task = await createTask(name, sources, createdBy);

    // IMPORTANT: await startTask() so the task is in 'running' state in the DB
    // before the response is sent. This prevents the frontend from seeing a
    // 'pending' → 'paused' race condition on first poll.
    // startTask() resolves quickly — it only does a DB read + update before
    // firing the long-running background work as a separate promise.
    try {
      await startTask(task.id);
    } catch (err: any) {
      console.error(`[SyncTasks API] Failed to start task ${task.id}:`, err);
      // Still return 202 — the task was created, it just failed to start
      // The user can retry by creating a new task
    }

    return NextResponse.json({
      taskId: task.id,
      status: 'started',
      message: 'Sync task created and started',
      sources,
    }, { status: 202 });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
