/**
 * Sync Task Manager
 * Manages background sync tasks for threat intelligence sources.
 * Supports pause/resume/cancel via AbortController references.
 *
 * IMPORTANT: All in-memory state is persisted via globalThis to survive
 * HMR (Hot Module Replacement) re-evaluations during development.
 * Without this, HMR would reset runningTasks/processStartTime/initDone,
 * causing running tasks to be incorrectly marked as "paused".
 */

import { db } from '@/lib/db';
import { isSafeDomain, isSafeIP } from '@/lib/safe-domain-whitelist';

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface CollectorResult {
  sourceId: string;
  domains: number;
  ips: number;
  entries: number;
  totalDomains?: number;
  totalIps?: number;
  totalEntries?: number;
  skipped?: boolean;
  error?: string;
}

type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

interface RunningTaskState {
  abortController: AbortController;
  paused: boolean;
  resumeResolve: (() => void) | null;
}

// ─── In-Memory State (persisted across HMR via globalThis) ──────────────────────────

const globalScope = globalThis as any;

// Persist runningTasks Map across HMR so in-flight tasks aren't lost
if (!globalScope.__SYNC_TASK_RUNNING_TASKS__) {
  globalScope.__SYNC_TASK_RUNNING_TASKS__ = new Map<string, RunningTaskState>();
}
const runningTasks: Map<string, RunningTaskState> = globalScope.__SYNC_TASK_RUNNING_TASKS__;

// Track process start time — only set once per real process (not per HMR re-evaluation)
if (!globalScope.__SYNC_TASK_PROCESS_START_TIME__) {
  globalScope.__SYNC_TASK_PROCESS_START_TIME__ = Date.now();
}
const PROCESS_START_TIME: number = globalScope.__SYNC_TASK_PROCESS_START_TIME__;

// Track whether initInterruptedTasks has already run
if (globalScope.__SYNC_TASK_INIT_DONE__ === undefined) {
  globalScope.__SYNC_TASK_INIT_DONE__ = false;
}

// ─── Initialization: Resume interrupted tasks ───────────────────────────────────────

/**
 * On server startup, check for tasks that were "running" when the server stopped
 * and mark them as "paused" so they can be manually resumed.
 *
 * IMPORTANT: Only pauses tasks that were started BEFORE this process started,
 * to avoid interfering with tasks that are legitimately running in the current process.
 * Also skips tasks that are still tracked in runningTasks (still in-memory).
 */
async function initInterruptedTasks(): Promise<void> {
  // Guard: only run once per process (persisted across HMR via globalThis)
  if (globalScope.__SYNC_TASK_INIT_DONE__) return;
  globalScope.__SYNC_TASK_INIT_DONE__ = true;

  try {
    // 1. Reset stuck SyncTasks (running → paused)
    // Only pause tasks that were started BEFORE this process (they must be from a previous instance)
    // AND are not still tracked in the runningTasks Map (still in-memory from before HMR)
    const interrupted = await db.syncTask.findMany({
      where: {
        status: 'running',
        startedAt: { lt: new Date(PROCESS_START_TIME) },
      },
    });
    for (const task of interrupted) {
      // Skip tasks that are still tracked in runningTasks (still running in memory)
      if (runningTasks.has(task.id)) {
        console.log(`[SyncTaskManager] Skipping task ${task.id} ("${task.name}") — still tracked in runningTasks`);
        continue;
      }
      await db.syncTask.update({
        where: { id: task.id },
        data: { status: 'paused', message: '服务器重启后任务中断，可手动恢复' },
      });
      console.log(`[SyncTaskManager] Marked interrupted task ${task.id} ("${task.name}") as paused`);
    }
    if (interrupted.length > 0) {
      console.log(`[SyncTaskManager] ${interrupted.length} interrupted task(s) checked, ${interrupted.filter(t => !runningTasks.has(t.id)).length} marked as paused`);
    }

    // 2. Reset ThreatIntelSource records stuck in "collecting" status
    // This happens when the server crashes/restarts during a sync
    const stuckSources = await db.threatIntelSource.findMany({
      where: { status: 'collecting' },
    });
    if (stuckSources.length > 0) {
      const result = await db.threatIntelSource.updateMany({
        where: { status: 'collecting' },
        data: { status: 'idle' },
      });
      console.log(`[SyncTaskManager] Reset ${result.count} stuck source(s) from "collecting" to "idle": ${stuckSources.map(s => s.sourceId).join(', ')}`);
    }

    // 3. Recalculate entryCount for all sources (fix inaccurate counts)
    const allSources = await db.threatIntelSource.findMany();
    let fixedCount = 0;
    for (const source of allSources) {
      try {
        const [domainCount, ipCount, entryCount] = await Promise.all([
          db.maliciousDomain.count({ where: { source: source.sourceId } }),
          db.maliciousIP.count({ where: { source: source.sourceId } }),
          db.threatIntelEntry.count({ where: { sourceId: source.sourceId } }),
        ]);
        const totalCount = domainCount + ipCount + entryCount;
        if (source.entryCount !== totalCount) {
          await db.threatIntelSource.update({
            where: { sourceId: source.sourceId },
            data: { entryCount: totalCount },
          });
          fixedCount++;
        }
      } catch {
        // Skip sources that fail to count
      }
    }
    if (fixedCount > 0) {
      console.log(`[SyncTaskManager] Fixed entryCount for ${fixedCount} source(s)`);
    }

    // 4. Clean up safe domains/IPs that should never be in the malicious library
    // This runs once on startup and removes well-known safe domains (github.com, w3.org, etc.)
    // and safe IPs (private/reserved ranges) that may have been incorrectly added by collectors
    try {
      const allDomains = await db.maliciousDomain.findMany({
        select: { id: true, domain: true },
      });
      const safeDomainIds: string[] = [];
      const safeDomainNames: string[] = [];
      for (const entry of allDomains) {
        if (isSafeDomain(entry.domain)) {
          safeDomainIds.push(entry.id);
          safeDomainNames.push(entry.domain);
        }
      }
      if (safeDomainIds.length > 0) {
        const BATCH_SIZE = 500;
        for (let i = 0; i < safeDomainIds.length; i += BATCH_SIZE) {
          const batch = safeDomainIds.slice(i, i + BATCH_SIZE);
          await db.maliciousDomain.deleteMany({ where: { id: { in: batch } } });
        }
        console.log(`[SyncTaskManager] Cleaned up ${safeDomainIds.length} safe domains from malicious library: ${safeDomainNames.slice(0, 10).join(', ')}${safeDomainNames.length > 10 ? '...' : ''}`);
      }

      const allIPs = await db.maliciousIP.findMany({
        select: { id: true, ip: true },
      });
      const safeIPIds: string[] = [];
      const safeIPValues: string[] = [];
      for (const entry of allIPs) {
        if (isSafeIP(entry.ip)) {
          safeIPIds.push(entry.id);
          safeIPValues.push(entry.ip);
        }
      }
      if (safeIPIds.length > 0) {
        const BATCH_SIZE = 500;
        for (let i = 0; i < safeIPIds.length; i += BATCH_SIZE) {
          const batch = safeIPIds.slice(i, i + BATCH_SIZE);
          await db.maliciousIP.deleteMany({ where: { id: { in: batch } } });
        }
        console.log(`[SyncTaskManager] Cleaned up ${safeIPIds.length} safe IPs from malicious library: ${safeIPValues.slice(0, 10).join(', ')}${safeIPValues.length > 10 ? '...' : ''}`);
      }

      // Clean up ThreatIntelEntry for safe domains/IPs
      const safeEntryIds: string[] = [];
      const domainEntries = await db.threatIntelEntry.findMany({
        where: { type: 'domain' },
        select: { id: true, value: true },
      });
      for (const entry of domainEntries) {
        if (isSafeDomain(entry.value)) {
          safeEntryIds.push(entry.id);
        }
      }
      const ipEntries = await db.threatIntelEntry.findMany({
        where: { type: 'ip' },
        select: { id: true, value: true },
      });
      for (const entry of ipEntries) {
        if (isSafeIP(entry.value)) {
          safeEntryIds.push(entry.id);
        }
      }
      if (safeEntryIds.length > 0) {
        const BATCH_SIZE = 500;
        for (let i = 0; i < safeEntryIds.length; i += BATCH_SIZE) {
          const batch = safeEntryIds.slice(i, i + BATCH_SIZE);
          await db.threatIntelEntry.deleteMany({ where: { id: { in: batch } } });
        }
        console.log(`[SyncTaskManager] Cleaned up ${safeEntryIds.length} safe threat intel entries`);
      }
    } catch (cleanupErr) {
      console.error('[SyncTaskManager] Safe domain cleanup failed:', cleanupErr);
    }
  } catch (err) {
    console.error('[SyncTaskManager] Failed to initialize interrupted tasks:', err);
  }
}

// Run initialization
initInterruptedTasks().catch(err => {
  console.error('[SyncTaskManager] Init failed:', err);
});

// ─── Task CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Create a new sync task record in the database.
 * The task is created with status 'pending' and will be set to 'running'
 * by startTask() immediately after.
 */
export async function createTask(
  name: string,
  sources: string[],
  createdBy?: string,
) {
  const task = await db.syncTask.create({
    data: {
      name,
      sources: JSON.stringify(sources),
      totalSources: sources.length,
      status: 'pending',
      createdBy: createdBy || null,
    },
  });
  return task;
}

/**
 * Get a task by ID.
 */
export async function getTask(taskId: string) {
  return db.syncTask.findUnique({ where: { id: taskId } });
}

/**
 * List all tasks, newest first.
 */
export async function listTasks() {
  return db.syncTask.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Delete a task record.
 */
export async function deleteTask(taskId: string): Promise<boolean> {
  // Cancel if running
  const state = runningTasks.get(taskId);
  if (state) {
    state.abortController.abort();
    runningTasks.delete(taskId);
  }

  try {
    await db.syncTask.delete({ where: { id: taskId } });
    return true;
  } catch {
    return false;
  }
}

// ─── Task Execution ────────────────────────────────────────────────────────────────

/**
 * Start executing a sync task. Runs collectors in parallel batches.
 * Updates the database on each state transition and each collector completion.
 *
 * This function awaits the initial status update to 'running' before returning,
 * so callers can be sure the task is visible as 'running' in the DB.
 *
 * When resuming a paused task:
 * - Preserves existing results from previous partial run
 * - Skips sources that already have results (already completed)
 * - Continues progress from where it left off
 */
export async function startTask(taskId: string): Promise<void> {
  const task = await db.syncTask.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  if (task.status !== 'pending' && task.status !== 'paused') {
    throw new Error(`Task ${taskId} is in '${task.status}' state, cannot start`);
  }

  // Prevent concurrent runs for the same task
  const existingState = runningTasks.get(taskId);
  if (existingState) {
    // Task is already running in-memory — abort the old one first
    existingState.abortController.abort();
    runningTasks.delete(taskId);
    // Small delay to let the old runner clean up
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const sources: string[] = JSON.parse(task.sources);

  // Set up abort controller for this task
  const abortController = new AbortController();
  const taskState: RunningTaskState = {
    abortController,
    paused: false,
    resumeResolve: null,
  };
  runningTasks.set(taskId, taskState);

  // Parse existing results for resume support
  const existingResults: CollectorResult[] = task.results ? JSON.parse(task.results) : [];
  const completedSourceIds = new Set(existingResults.map(r => r.sourceId));
  const previousCompleted = existingResults.filter(r => !r.error).length;
  const previousFailed = existingResults.filter(r => r.error).length;

  // IMPORTANT: Update task to 'running' BEFORE returning, so the frontend
  // never sees a 'pending' → 'paused' race condition
  await db.syncTask.update({
    where: { id: taskId },
    data: {
      status: 'running',
      // Only set startedAt if this is a fresh start (not resume)
      ...(task.status === 'pending' ? { startedAt: new Date() } : {}),
      message: `准备开始采集 ${sources.length} 个情报源...`,
    },
  });

  console.log(`[SyncTaskManager] Starting task "${task.name}" (${taskId}) with ${sources.length} sources (${completedSourceIds.size} already completed)`);

  // Run the collection in the background (non-blocking)
  // The task is already in 'running' state in the DB at this point
  runTaskInBackground(taskId, sources, taskState, existingResults, previousCompleted, previousFailed).catch(async (err) => {
    console.error(`[SyncTaskManager] Task "${task.name}" failed with error:`, err);
    try {
      await db.syncTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          error: err.message || 'Unknown error',
          completedAt: new Date(),
          message: `同步失败: ${err.message || 'Unknown error'}`,
        },
      });
    } catch (dbErr) {
      console.error(`[SyncTaskManager] Failed to update task status:`, dbErr);
    }
    runningTasks.delete(taskId);
  });
}

/**
 * Internal: Run the actual collection logic in background.
 *
 * @param existingResults - Results from a previous partial run (for resume)
 * @param previousCompleted - Number of previously completed sources
 * @param previousFailed - Number of previously failed sources
 */
async function runTaskInBackground(
  taskId: string,
  sources: string[],
  taskState: RunningTaskState,
  existingResults: CollectorResult[] = [],
  previousCompleted: number = 0,
  previousFailed: number = 0,
): Promise<void> {
  // Start with existing results (preserves partial progress)
  const results: CollectorResult[] = [...existingResults];
  let completedCount = previousCompleted;
  let failedCount = previousFailed;
  const CONCURRENCY = 4;

  // Import the collector map dynamically to avoid circular deps
  const { COLLECTOR_MAP } = await import('@/app/api/threat-intel/update/route');

  // Filter to only valid collectors
  const validSources = sources.filter(id => COLLECTOR_MAP[id]);

  if (validSources.length === 0) {
    await db.syncTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        progress: 100,
        completedSources: 0,
        failedSources: 0,
        results: JSON.stringify([]),
        completedAt: new Date(),
        message: '无有效情报源可采集',
      },
    });
    runningTasks.delete(taskId);
    return;
  }

  const actualTotal = validSources.length;

  // Update total sources if it changed (some sources may be invalid)
  if (actualTotal !== sources.length) {
    await db.syncTask.update({
      where: { id: taskId },
      data: { totalSources: actualTotal },
    });
  }

  // Determine which sources still need to run (skip already completed ones)
  const completedSourceIds = new Set(existingResults.map(r => r.sourceId));
  const remainingSources = validSources.filter(id => !completedSourceIds.has(id));

  console.log(`[SyncTaskManager] Task "${taskId}": ${completedSourceIds.size} already done, ${remainingSources.length} remaining`);

  if (remainingSources.length === 0) {
    // All sources already completed — just finalize
    const successCount = completedCount - failedCount;
    await db.syncTask.update({
      where: { id: taskId },
      data: {
        status: failedCount === actualTotal ? 'failed' : 'completed',
        progress: 100,
        completedSources: successCount,
        failedSources: failedCount,
        results: JSON.stringify(results),
        completedAt: new Date(),
        error: failedCount > 0 && successCount > 0 ? `${failedCount} of ${actualTotal} sources failed` : null,
        message: failedCount > 0
          ? `同步完成 — ${successCount} 成功, ${failedCount} 失败`
          : `同步完成 — 全部 ${successCount} 个源成功`,
      },
    });
    runningTasks.delete(taskId);
    return;
  }

  // Run remaining sources in batches
  for (let i = 0; i < remainingSources.length; i += CONCURRENCY) {
    // Check if cancelled
    if (taskState.abortController.signal.aborted) {
      await db.syncTask.update({
        where: { id: taskId },
        data: {
          status: 'cancelled',
          progress: actualTotal > 0 ? (completedCount / actualTotal) * 100 : 0,
          completedSources: completedCount - failedCount,
          failedSources: failedCount,
          results: JSON.stringify(results),
          completedAt: new Date(),
          message: '任务已取消',
        },
      });
      runningTasks.delete(taskId);
      return;
    }

    // Check if paused — wait for resume
    if (taskState.paused) {
      await db.syncTask.update({
        where: { id: taskId },
        data: { message: '任务已暂停，等待恢复...' },
      });
      await new Promise<void>((resolve) => {
        taskState.resumeResolve = resolve;
      });
      // After resume, check cancel again
      if (taskState.abortController.signal.aborted) {
        await db.syncTask.update({
          where: { id: taskId },
          data: {
            status: 'cancelled',
            progress: actualTotal > 0 ? (completedCount / actualTotal) * 100 : 0,
            completedSources: completedCount - failedCount,
            failedSources: failedCount,
            results: JSON.stringify(results),
            completedAt: new Date(),
            message: '任务已取消',
          },
        });
        runningTasks.delete(taskId);
        return;
      }
    }

    const batch = remainingSources.slice(i, i + CONCURRENCY);
    const alreadyDone = completedCount;

    // Update message BEFORE starting this batch — gives immediate visual feedback
    // Also bump progress slightly so the progress bar moves right away
    try {
      const preProgress = actualTotal > 0
        ? Math.min(((alreadyDone + batch.length * 0.1) / actualTotal) * 100, 95)
        : 0;
      await db.syncTask.update({
        where: { id: taskId },
        data: {
          message: `正在采集 ${batch.join(', ')} (${alreadyDone + 1}-${Math.min(alreadyDone + batch.length, actualTotal)}/${actualTotal})...`,
          progress: preProgress,
        },
      });
    } catch (dbErr) {
      console.error(`[SyncTaskManager] Failed to update pre-batch message:`, dbErr);
    }

    const batchResults = await Promise.allSettled(
      batch.map(async (sourceId) => {
        const collectorFn = COLLECTOR_MAP[sourceId];
        if (!collectorFn) {
          return { sourceId, domains: 0, ips: 0, entries: 0, error: 'Unknown collector' } as CollectorResult;
        }
        return collectorFn();
      }),
    );

    for (const settled of batchResults) {
      completedCount++;
      let result: CollectorResult;

      if (settled.status === 'fulfilled') {
        result = settled.value;
        if (result.error) {
          failedCount++;
        }
      } else {
        result = {
          sourceId: `unknown-${completedCount}`,
          domains: 0,
          ips: 0,
          entries: 0,
          error: settled.reason?.message || 'Unknown error',
        };
        failedCount++;
      }

      results.push(result);

      // Update progress in DB after each collector with descriptive message
      const progress = actualTotal > 0 ? (completedCount / actualTotal) * 100 : 100;
      const resultDesc = result.error
        ? `${result.sourceId} 失败`
        : `${result.sourceId} 完成 (新增 ${result.domains + result.ips})`;
      try {
        await db.syncTask.update({
          where: { id: taskId },
          data: {
            progress,
            completedSources: completedCount - failedCount,
            failedSources: failedCount,
            results: JSON.stringify(results),
            message: `${resultDesc} — ${completedCount}/${actualTotal} 源已完成`,
          },
        });
      } catch (dbErr) {
        console.error(`[SyncTaskManager] Failed to update progress:`, dbErr);
      }
    }

    // Small delay between batches
    if (i + CONCURRENCY < remainingSources.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Task completed - handle partial success
  const successCount = completedCount - failedCount;
  let finalStatus: TaskStatus;
  let errorMsg: string | null = null;

  if (failedCount === actualTotal) {
    // All sources failed
    finalStatus = 'failed';
    errorMsg = 'All sources failed';
  } else if (failedCount > 0 && successCount > 0) {
    // Partial success - mark as completed but note the failures
    finalStatus = 'completed';
    errorMsg = `${failedCount} of ${actualTotal} sources failed`;
  } else {
    // All succeeded
    finalStatus = 'completed';
  }

  await db.syncTask.update({
    where: { id: taskId },
    data: {
      status: finalStatus,
      progress: 100,
      completedSources: successCount,
      failedSources: failedCount,
      results: JSON.stringify(results),
      completedAt: new Date(),
      error: errorMsg,
      message: failedCount > 0
        ? `同步完成 — ${successCount} 成功, ${failedCount} 失败`
        : `同步完成 — 全部 ${successCount} 个源成功`,
    },
  });

  runningTasks.delete(taskId);
  console.log(`[SyncTaskManager] Task "${taskId}" completed: ${completedCount - failedCount} succeeded, ${failedCount} failed`);
}

// ─── Task Control ──────────────────────────────────────────────────────────────────

/**
 * Pause a running task.
 */
export async function pauseTask(taskId: string): Promise<void> {
  const task = await db.syncTask.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  if (task.status !== 'running') {
    throw new Error(`Task ${taskId} is in '${task.status}' state, cannot pause`);
  }

  const state = runningTasks.get(taskId);
  if (state) {
    state.paused = true;
  }

  await db.syncTask.update({
    where: { id: taskId },
    data: { status: 'paused', message: '任务已暂停' },
  });

  console.log(`[SyncTaskManager] Task "${taskId}" paused`);
}

/**
 * Resume a paused task.
 *
 * If the task is still in memory (was paused in the same process), it simply
 * resumes the background runner. If the task was interrupted (server restart),
 * it restarts the task, preserving existing results and skipping already-completed sources.
 */
export async function resumeTask(taskId: string): Promise<void> {
  const task = await db.syncTask.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  if (task.status !== 'paused') {
    throw new Error(`Task ${taskId} is in '${task.status}' state, cannot resume`);
  }

  const state = runningTasks.get(taskId);
  if (state) {
    // Task is still in memory (was paused, not interrupted)
    state.paused = false;
    if (state.resumeResolve) {
      state.resumeResolve();
      state.resumeResolve = null;
    }
    await db.syncTask.update({
      where: { id: taskId },
      data: { status: 'running', message: '任务已恢复，继续采集...' },
    });
  } else {
    // Task was interrupted (server restart) — restart it with resume support
    await startTask(taskId);
    return;
  }

  console.log(`[SyncTaskManager] Task "${taskId}" resumed`);
}

/**
 * Cancel a running task.
 */
export async function cancelTask(taskId: string): Promise<void> {
  const task = await db.syncTask.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }

  if (task.status !== 'running' && task.status !== 'paused' && task.status !== 'pending') {
    throw new Error(`Task ${taskId} is in '${task.status}' state, cannot cancel`);
  }

  const state = runningTasks.get(taskId);
  if (state) {
    state.abortController.abort();
    // If paused, also resolve the pause promise so the task can check the abort signal
    if (state.paused && state.resumeResolve) {
      state.resumeResolve();
      state.resumeResolve = null;
    }
  }

  // If task was pending (never started), just update DB directly
  if (task.status === 'pending') {
    await db.syncTask.update({
      where: { id: taskId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        message: '任务已取消',
      },
    });
    runningTasks.delete(taskId);
  }
  // For running/paused tasks, the background runner will update the DB when it detects the abort

  console.log(`[SyncTaskManager] Task "${taskId}" cancelled`);
}
