import { NextRequest, NextResponse } from 'next/server';
import { validateSession, destroySession } from '@/lib/server-config';
import { auditLog } from '@/lib/audit-logger';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    const ip = request.headers.get('x-real-ip') ||
               request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               'unknown';

    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const username = validateSession(token);
      if (username) {
        destroySession(token);
        auditLog.auth('logout', username, 'User logged out', ip).catch(() => {});
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}
