import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAuth } from '@/lib/api-auth';
import { getTask, pauseTask, resumeTask, cancelTask, deleteTask } from '@/lib/sync-task-manager';

export const dynamic = 'force-dynamic';

// GET /api/sync-tasks/[id] — Get task details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  const { id } = await params;

  try {
    const task = await getTask(id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (err: any) {
    console.error('[sync-tasks] Failed to get task:', err);
    return NextResponse.json(
      { error: '操作失败，请稍后重试' },
      { status: 500 },
    );
  }
}

// PATCH /api/sync-tasks/[id] — Control task (pause/resume/cancel)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const action: string = body.action;

    if (!action || !['pause', 'resume', 'cancel'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be: pause, resume, or cancel' },
        { status: 400 },
      );
    }

    switch (action) {
      case 'pause':
        await pauseTask(id);
        break;
      case 'resume':
        await resumeTask(id);
        break;
      case 'cancel':
        await cancelTask(id);
        break;
    }

    // Return updated task state
    const task = await getTask(id);
    return NextResponse.json({ task });
  } catch (err: any) {
    const status = err.message?.includes('not found') ? 404
      : err.message?.includes('cannot') ? 409
      : 500;
    console.error('[sync-tasks] Failed to control task:', err);
    return NextResponse.json(
      { error: '操作失败，请稍后重试' },
      { status },
    );
  }
}

// DELETE /api/sync-tasks/[id] — Delete a task
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  const { id } = await params;

  try {
    const deleted = await deleteTask(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    return NextResponse.json({ message: 'Task deleted' });
  } catch (err: any) {
    console.error('[sync-tasks] Failed to delete task:', err);
    return NextResponse.json(
      { error: '操作失败，请稍后重试' },
      { status: 500 },
    );
  }
}
