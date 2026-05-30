import { NextRequest, NextResponse } from 'next/server';
import { validateSession, isDefaultPassword } from '@/lib/server-config';

export async function GET(request: NextRequest) {
  try {
    // Only accept token via Authorization header (not URL query params which can be logged)
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ authenticated: false, username: null });
    }

    // Validate token format (should be 64 hex chars)
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return NextResponse.json({ authenticated: false, username: null });
    }

    const username = validateSession(token);
    if (!username) {
      return NextResponse.json({ authenticated: false, username: null });
    }

    return NextResponse.json({ authenticated: true, username, isDefaultPassword: isDefaultPassword(username) });
  } catch {
    return NextResponse.json({ authenticated: false, username: null });
  }
}
