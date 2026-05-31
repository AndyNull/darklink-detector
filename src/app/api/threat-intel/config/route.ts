import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { checkApiAuth, requireSessionAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET /api/threat-intel/config — Get current auto-update config
export async function GET(request: NextRequest) {
  const authError = checkApiAuth(request);
  if (authError) return authError;

  try {
    let config = await (db as any).threatIntelConfig.findUnique({
      where: { id: 'default' },
    });

    // Create default config if not exists
    if (!config) {
      config = await (db as any).threatIntelConfig.create({
        data: { id: 'default' },
      });
    }

    // Calculate if an update is due
    const now = new Date();
    let isUpdateDue = false;
    let nextUpdateAt: Date | null = null;

    if (config.autoUpdateEnabled) {
      if (config.lastUpdateAt) {
        const nextUpdate = new Date(
          config.lastUpdateAt.getTime() + config.updateIntervalHours * 60 * 60 * 1000
        );
        nextUpdateAt = nextUpdate;
        isUpdateDue = now >= nextUpdate;
      } else {
        // Never updated, update is due immediately
        isUpdateDue = true;
        nextUpdateAt = now;
      }
    }

    return NextResponse.json({
      ...config,
      isUpdateDue,
      nextUpdateAt: nextUpdateAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error('Failed to fetch threat intel config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/threat-intel/config — Update auto-update config
export async function PUT(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;
  const authError = checkApiAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { autoUpdateEnabled, updateIntervalHours } = body;

    // Validate interval hours
    const validIntervals = [6, 12, 24, 48];
    const interval = updateIntervalHours;
    if (interval !== undefined && !validIntervals.includes(interval)) {
      return NextResponse.json(
        { error: `Invalid interval. Must be one of: ${validIntervals.join(', ')}` },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (autoUpdateEnabled !== undefined) {
      updateData.autoUpdateEnabled = Boolean(autoUpdateEnabled);
    }
    if (interval !== undefined) {
      updateData.updateIntervalHours = interval;
    }

    const config = await (db as any).threatIntelConfig.upsert({
      where: { id: 'default' },
      update: updateData,
      create: {
        id: 'default',
        autoUpdateEnabled: autoUpdateEnabled ?? false,
        updateIntervalHours: interval ?? 24,
      },
    });

    // Recalculate isUpdateDue
    const now = new Date();
    let isUpdateDue = false;
    let nextUpdateAt: Date | null = null;

    if (config.autoUpdateEnabled) {
      if (config.lastUpdateAt) {
        const nextUpdate = new Date(
          config.lastUpdateAt.getTime() + config.updateIntervalHours * 60 * 60 * 1000
        );
        nextUpdateAt = nextUpdate;
        isUpdateDue = now >= nextUpdate;
      } else {
        isUpdateDue = true;
        nextUpdateAt = now;
      }
    }

    return NextResponse.json({
      ...config,
      isUpdateDue,
      nextUpdateAt: nextUpdateAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error('Failed to update threat intel config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
