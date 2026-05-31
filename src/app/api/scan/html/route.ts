import { NextRequest, NextResponse } from 'next/server';
import { getTaskResults } from '@/lib/scan-engine/task-store';
import { requireSessionAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Lazy-load rawHtml for a specific scan result.
 * The main /api/scan?action=results endpoint strips rawHtml by default
 * to reduce network payload. This endpoint fetches it on demand when
 * the user clicks "View Source" in the UI.
 */
export async function GET(request: NextRequest) {
  const authError = await requireSessionAuth(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');
  const resultUrl = url.searchParams.get('url');

  if (!taskId || !resultUrl) {
    return NextResponse.json({ error: '缺少 taskId 或 url 参数' }, { status: 400 });
  }

  const results = getTaskResults(taskId) || [];
  const result = results.find((r: any) => r.url === resultUrl);

  if (!result) {
    return NextResponse.json({ error: '未找到扫描结果' }, { status: 404 });
  }

  return NextResponse.json({
    rawHtml: result.rawHtml || null,
    url: result.url,
  });
}
