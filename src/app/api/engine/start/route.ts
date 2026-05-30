import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAuth } from '@/lib/api-auth';
import { getSessionFromRequest } from '@/lib/server-config';
import {
  startService,
  getAllServiceNames,
  clearAutoStartDisabled,
  type ServiceName,
} from '@/lib/engine-manager';
import { auditLog } from '@/lib/audit-logger';
import { safeErrorResponse } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

// ─── Rate Limiting for Engine Control ──────────────────────────────────────

const engineControlRateLimitMap = new Map<string, { count: number; lastAttempt: number }>();
const ENGINE_CONTROL_RATE_LIMIT_MAX = 10;  // max requests per window
const ENGINE_CONTROL_RATE_LIMIT_WINDOW = 60000; // 1 minute window

function checkEngineControlRateLimit(key: string): { allowed: boolean; remainingMs: number } {
  const now = Date.now();
  const record = engineControlRateLimitMap.get(key);

  if (!record || now - record.lastAttempt > ENGINE_CONTROL_RATE_LIMIT_WINDOW) {
    engineControlRateLimitMap.set(key, { count: 1, lastAttempt: now });
    return { allowed: true, remainingMs: 0 };
  }

  if (record.count >= ENGINE_CONTROL_RATE_LIMIT_MAX) {
    return { allowed: false, remainingMs: ENGINE_CONTROL_RATE_LIMIT_WINDOW - (now - record.lastAttempt) };
  }

  record.count++;
  record.lastAttempt = now;
  return { allowed: true, remainingMs: 0 };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of engineControlRateLimitMap.entries()) {
    if (now - record.lastAttempt > ENGINE_CONTROL_RATE_LIMIT_WINDOW) {
      engineControlRateLimitMap.delete(key);
    }
  }
}, 60000);

export async function POST(request: NextRequest) {
  // Require authentication for management operations
  const authError = requireSessionAuth(request);
  if (authError) return authError;

  // Rate limiting — prevent rapid repeated start requests
  const rateLimitKey = request.headers.get('x-real-ip') ||
                       request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                       'unknown';
  const rateLimit = checkEngineControlRateLimit(rateLimitKey);
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

    const servicesToStart: ServiceName[] =
      service === 'all' ? validServices : [service];

    const results: Array<{
      service: ServiceName;
      success: boolean;
      pid?: number;
      error?: string;
    }> = [];

    // Get IP for audit logging
    const ip = request.headers.get('x-real-ip') ||
               request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               'unknown';

    for (const svc of servicesToStart) {
      try {
        // Clear auto-start disabled flag when user manually starts
        clearAutoStartDisabled(svc);
        const pid = await startService(svc);
        results.push({ service: svc, success: true, pid });
        auditLog.system('engine_started', getSessionFromRequest(request) || 'system', `Engine service started: ${svc} (PID: ${pid})`, ip).catch(() => {});
      } catch (err) {
        results.push({
          service: svc,
          success: false,
          error: (err as Error).message,
        });
        auditLog.system('engine_start_failed', getSessionFromRequest(request) || 'system', `Engine service start failed: ${svc} — ${(err as Error).message}`, ip).catch(() => {});
      }
    }

    // If only one service was requested, return a simple response
    if (servicesToStart.length === 1) {
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
        pid: result.pid,
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
    console.error('[ENGINE] Start error:', err);
    return safeErrorResponse(err, '引擎启动失败');
  }
}
