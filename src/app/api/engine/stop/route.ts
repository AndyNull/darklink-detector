import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAuth } from '@/lib/api-auth';
import { getSessionFromRequest } from '@/lib/server-config';
import {
  stopService,
  getAllServiceNames,
  type ServiceName,
} from '@/lib/engine-manager';
import { auditLog } from '@/lib/audit-logger';
import { safeErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

// ─── Rate Limiting for Engine Control ──────────────────────────────────────

const engineStopRateLimitMap = new Map<string, { count: number; lastAttempt: number }>();
const ENGINE_STOP_RATE_LIMIT_MAX = 10;
const ENGINE_STOP_RATE_LIMIT_WINDOW = 60000;

function checkEngineStopRateLimit(key: string): { allowed: boolean; remainingMs: number } {
  const now = Date.now();
  const record = engineStopRateLimitMap.get(key);

  if (!record || now - record.lastAttempt > ENGINE_STOP_RATE_LIMIT_WINDOW) {
    engineStopRateLimitMap.set(key, { count: 1, lastAttempt: now });
    return { allowed: true, remainingMs: 0 };
  }

  if (record.count >= ENGINE_STOP_RATE_LIMIT_MAX) {
    return { allowed: false, remainingMs: ENGINE_STOP_RATE_LIMIT_WINDOW - (now - record.lastAttempt) };
  }

  record.count++;
  record.lastAttempt = now;
  return { allowed: true, remainingMs: 0 };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of engineStopRateLimitMap.entries()) {
    if (now - record.lastAttempt > ENGINE_STOP_RATE_LIMIT_WINDOW) {
      engineStopRateLimitMap.delete(key);
    }
  }
}, 60000);

export async function POST(request: NextRequest) {
  // Require authentication for management operations
  const authError = requireSessionAuth(request);
  if (authError) return authError;

  // Rate limiting — prevent rapid repeated stop requests
  const rateLimitKey = request.headers.get('x-real-ip') ||
                       request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                       'unknown';
  const rateLimit = checkEngineStopRateLimit(rateLimitKey);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: '操作过于频繁，请稍后再试' },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const { service } = body as { service: ServiceName | 'all' };

    if (!service) {
      return NextResponse.json(
        { error: '缺少 service 参数' },
        { status: 400 }
      );
    }

    const validServices: ServiceName[] = getAllServiceNames();

    if (service !== 'all' && !validServices.includes(service)) {
      return NextResponse.json(
        { error: `无效的服务名称: ${service}。有效值: ${validServices.join(', ')}, all` },
        { status: 400 }
      );
    }

    const servicesToStop: ServiceName[] =
      service === 'all' ? validServices : [service];

    const results: Array<{
      service: ServiceName;
      success: boolean;
      error?: string;
    }> = [];

    // Get IP for audit logging
    const ip = request.headers.get('x-real-ip') ||
               request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               'unknown';

    for (const svc of servicesToStop) {
      try {
        await stopService(svc);
        results.push({ service: svc, success: true });
        auditLog.system('engine_stopped', getSessionFromRequest(request) || 'system', `Engine service stopped: ${svc}`, ip).catch(() => {});
      } catch (err) {
        results.push({
          service: svc,
          success: false,
          error: (err as Error).message,
        });
        auditLog.system('engine_stop_failed', getSessionFromRequest(request) || 'system', `Engine service stop failed: ${svc} — ${(err as Error).message}`, ip).catch(() => {});
      }
    }

    // If only one service was requested, return a simple response
    if (servicesToStop.length === 1) {
      const result = results[0];
      if (!result.success) {
        return NextResponse.json(
          { success: false, service: result.service, error: result.error },
          { status: 409 }
        );
      }
      return NextResponse.json({
        success: true,
        service: result.service,
      });
    }

    // Multiple services — return array
    const allSucceeded = results.every((r) => r.success);
    return NextResponse.json(
      {
        success: allSucceeded,
        services: results,
      },
      { status: allSucceeded ? 200 : 207 }
    );
  } catch (err) {
    console.error('[ENGINE] Stop error:', err);
    return safeErrorResponse(err, '引擎停止失败');
  }
}
