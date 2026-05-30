/**
 * Update Scheduler - handles auto-scheduled threat intel updates
 * Uses database-backed schedule config instead of in-process timers
 * (more reliable for Next.js serverless environment)
 */

import { db } from '@/lib/db';
import { spawn } from 'child_process';
import path from 'path';

export type UpdateFrequency = 'hourly' | 'every-6h' | 'every-12h' | 'daily' | 'weekly';

const FREQUENCY_MS: Record<UpdateFrequency, number> = {
  hourly: 60 * 60 * 1000,
  'every-6h': 6 * 60 * 60 * 1000,
  'every-12h': 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Get or create the schedule config from the database
 */
export async function getScheduleConfig() {
  let schedule = await db.updateSchedule.findFirst();
  if (!schedule) {
    schedule = await db.updateSchedule.create({
      data: {
        enabled: false,
        frequency: 'daily',
        status: 'idle',
      },
    });
  }
  return schedule;
}

/**
 * Update the schedule config
 */
export async function updateScheduleConfig(data: {
  enabled?: boolean;
  frequency?: UpdateFrequency;
}) {
  let schedule = await db.updateSchedule.findFirst();
  if (!schedule) {
    schedule = await db.updateSchedule.create({
      data: {
        enabled: data.enabled ?? false,
        frequency: data.frequency ?? 'daily',
        status: 'idle',
      },
    });
  } else {
    const updateData: Record<string, unknown> = {};
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.frequency !== undefined) updateData.frequency = data.frequency;

    // Recalculate nextRunAt if frequency changes or if enabling
    if (data.frequency || (data.enabled === true)) {
      const freq = (data.frequency || schedule.frequency) as UpdateFrequency;
      const lastRun = schedule.lastRunAt || new Date();
      updateData.nextRunAt = new Date(lastRun.getTime() + FREQUENCY_MS[freq]);
    }

    if (data.enabled === false) {
      updateData.nextRunAt = null;
    }

    schedule = await db.updateSchedule.update({
      where: { id: schedule.id },
      data: updateData,
    });
  }
  return schedule;
}

/**
 * Check if an update is due and trigger it if so.
 * Spawns the seed script as a detached child process (non-blocking).
 * Returns info about whether an update was triggered.
 */
export async function checkAndTriggerUpdate(): Promise<{
  triggered: boolean;
  schedule: Awaited<ReturnType<typeof getScheduleConfig>>;
}> {
  const schedule = await getScheduleConfig();

  if (!schedule.enabled) {
    return { triggered: false, schedule };
  }

  // If already running, skip
  if (schedule.status === 'running') {
    return { triggered: false, schedule };
  }

  const now = new Date();

  // Check if nextRunAt has passed
  if (schedule.nextRunAt && now >= schedule.nextRunAt) {
    // Spawn the seed script directly (non-blocking, detached)
    try {
      await db.updateSchedule.update({
        where: { id: schedule.id },
        data: { status: 'running' },
      });

      const scriptPath = path.join(process.cwd(), 'scripts', 'seed-threat-intel.ts');
      const child = spawn('bun', [scriptPath], {
        cwd: process.cwd(),
        stdio: 'pipe',
        detached: true,
      });

      // Let the child process run independently
      child.unref();

      // Mark as completed immediately since the script runs asynchronously
      // The actual data will appear in the DB as the script processes
      const freq = schedule.frequency as UpdateFrequency;
      const nextRun = new Date(now.getTime() + FREQUENCY_MS[freq]);
      await db.updateSchedule.update({
        where: { id: schedule.id },
        data: {
          status: 'completed',
          lastRunAt: now,
          nextRunAt: nextRun,
        },
      });
      schedule.status = 'completed';
      schedule.lastRunAt = now;
      schedule.nextRunAt = nextRun;

      return { triggered: true, schedule };
    } catch (error) {
      await db.updateSchedule.update({
        where: { id: schedule.id },
        data: { status: 'failed' },
      }).catch(() => {});
      schedule.status = 'failed';
      return { triggered: true, schedule };
    }
  }

  // If no nextRunAt but enabled, calculate and set it
  if (!schedule.nextRunAt) {
    const freq = schedule.frequency as UpdateFrequency;
    const baseTime = schedule.lastRunAt || now;
    const nextRun = new Date(baseTime.getTime() + FREQUENCY_MS[freq]);
    await db.updateSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: nextRun },
    });
    schedule.nextRunAt = nextRun;
  }

  return { triggered: false, schedule };
}

/**
 * Calculate the next run time based on frequency
 */
export function calculateNextRun(frequency: UpdateFrequency, from?: Date): Date {
  const base = from || new Date();
  return new Date(base.getTime() + FREQUENCY_MS[frequency]);
}

/**
 * Format a frequency value for display
 */
export function formatFrequency(frequency: string): string {
  const labels: Record<string, string> = {
    hourly: '每小时',
    'every-6h': '每6小时',
    'every-12h': '每12小时',
    daily: '每天',
    weekly: '每周',
  };
  return labels[frequency] || frequency;
}
