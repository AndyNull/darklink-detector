import { NextRequest, NextResponse } from 'next/server';
import { checkApiAuth, requireSessionAuth } from '@/lib/api-auth';
import { getScheduleConfig, updateScheduleConfig, checkAndTriggerUpdate } from '@/lib/update-scheduler';

// GET /api/threat-intel/schedule — Get schedule config and check if update is due
export async function GET(request: NextRequest) {
  const authError = checkApiAuth(request);
  if (authError) return authError;

  try {
    // Check if an update should be triggered
    const result = await checkAndTriggerUpdate();

    return NextResponse.json({
      schedule: {
        id: result.schedule.id,
        enabled: result.schedule.enabled,
        frequency: result.schedule.frequency,
        lastRunAt: result.schedule.lastRunAt?.toISOString() || null,
        nextRunAt: result.schedule.nextRunAt?.toISOString() || null,
        status: result.schedule.status,
        createdAt: result.schedule.createdAt?.toISOString(),
        updatedAt: result.schedule.updatedAt?.toISOString(),
      },
      updateTriggered: result.triggered,
    });
  } catch (error) {
    console.error('Failed to get schedule config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/threat-intel/schedule — Update schedule config
export async function PUT(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;
  const authError = checkApiAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { enabled, frequency } = body;

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    if (frequency !== undefined) {
      const validFreqs = ['hourly', 'every-6h', 'every-12h', 'daily', 'weekly'];
      if (!validFreqs.includes(frequency)) {
        return NextResponse.json({ error: `frequency must be one of: ${validFreqs.join(', ')}` }, { status: 400 });
      }
    }

    const schedule = await updateScheduleConfig({ enabled, frequency });

    return NextResponse.json({
      schedule: {
        id: schedule.id,
        enabled: schedule.enabled,
        frequency: schedule.frequency,
        lastRunAt: schedule.lastRunAt?.toISOString() || null,
        nextRunAt: schedule.nextRunAt?.toISOString() || null,
        status: schedule.status,
      },
    });
  } catch (error) {
    console.error('Failed to update schedule config:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/threat-intel/schedule — Trigger a manual check of whether update should run
export async function POST(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;
  const authError = checkApiAuth(request);
  if (authError) return authError;

  try {
    const result = await checkAndTriggerUpdate();

    return NextResponse.json({
      schedule: {
        id: result.schedule.id,
        enabled: result.schedule.enabled,
        frequency: result.schedule.frequency,
        lastRunAt: result.schedule.lastRunAt?.toISOString() || null,
        nextRunAt: result.schedule.nextRunAt?.toISOString() || null,
        status: result.schedule.status,
      },
      updateTriggered: result.triggered,
    });
  } catch (error) {
    console.error('Failed to check schedule:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
