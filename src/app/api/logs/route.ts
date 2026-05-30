import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAuth } from '@/lib/api-auth';
import { readLogs, getLogCategories, type LogCategory } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

// GET /api/logs?category=auth&startDate=...&endDate=...&search=...&limit=500&offset=0&entityType=...&entityId=...
export async function GET(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  try {
    const { searchParams } = new URL(request.url);

    const category = searchParams.get('category') as LogCategory | null;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const search = searchParams.get('search') || undefined;
    const limit = Math.min(2000, Math.max(1, parseInt(searchParams.get('limit') || '500')));
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'));
    const entityType = searchParams.get('entityType') || undefined;
    const entityId = searchParams.get('entityId') || undefined;

    // If requesting categories info
    if (searchParams.get('action') === 'categories') {
      const categories = await getLogCategories();
      return NextResponse.json({ categories });
    }

    // Validate category if provided
    if (category && !['auth', 'task', 'system', 'data'].includes(category)) {
      return NextResponse.json({ error: 'Invalid category. Must be one of: auth, task, system, data' }, { status: 400 });
    }

    const results = await readLogs({
      category: category || undefined,
      startDate,
      endDate,
      search,
      limit,
      offset,
      entityType,
      entityId,
    });

    // Merge all entries and sort by timestamp (most recent first)
    const allEntries = results.flatMap(r =>
      r.entries.map(e => ({ ...e, category: r.category }))
    );
    allEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const total = results.reduce((sum, r) => sum + r.total, 0);

    return NextResponse.json({
      entries: allEntries,
      total,
      limit,
      offset,
      categories: results.map(r => ({
        category: r.category,
        total: r.total,
      })),
    });
  } catch (err) {
    console.error('[Logs API] Failed to read logs:', err);
    return NextResponse.json({ error: 'Failed to read logs' }, { status: 500 });
  }
}
