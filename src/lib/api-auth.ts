import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/server-config';

/**
 * API authentication middleware
 *
 * Environment variables:
 * - API_AUTH_ENABLED: Set to "true" to enable auth (default: disabled)
 * - API_KEYS: Comma-separated list of valid API keys
 *
 * Supported auth methods:
 * 1. x-api-key header
 * 2. apikey query parameter
 * 3. Authorization: Bearer <token> header
 */

function isAuthEnabled(): boolean {
  return process.env.API_AUTH_ENABLED === 'true';
}

function getValidApiKeys(): Set<string> {
  const keysStr = process.env.API_KEYS || '';
  return new Set(keysStr.split(',').map(k => k.trim()).filter(k => k.length > 0));
}

function extractApiKey(request: NextRequest): string | null {
  // 1. x-api-key header
  const headerKey = request.headers.get('x-api-key');
  if (headerKey) return headerKey;

  // 2. apikey query parameter
  const { searchParams } = new URL(request.url);
  const queryKey = searchParams.get('apikey');
  if (queryKey) return queryKey;

  // 3. Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

function isHealthCheckRequest(request: NextRequest): boolean {
  const { searchParams } = new URL(request.url);
  return searchParams.get('action') === 'health';
}

/**
 * Check API authentication. Returns null on pass, or 401 NextResponse on failure.
 * This checks API key auth (env-based), which is optional and disabled by default.
 */
export function checkApiAuth(request: NextRequest): NextResponse | null {
  // Auth disabled by default
  if (!isAuthEnabled()) return null;

  // Exempt health check endpoint
  if (isHealthCheckRequest(request)) return null;

  const apiKey = extractApiKey(request);

  // No API key provided
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Authentication required. Provide API key via x-api-key header, apikey query param, or Authorization: Bearer <token>' },
      { status: 401 }
    );
  }

  // Validate API key
  const validKeys = getValidApiKeys();
  if (validKeys.size === 0) {
    return NextResponse.json(
      { error: 'API authentication is enabled but no API_KEYS are configured' },
      { status: 401 }
    );
  }

  if (!validKeys.has(apiKey)) {
    return NextResponse.json(
      { error: 'Invalid API key' },
      { status: 401 }
    );
  }

  return null;
}

/**
 * Check session-based authentication for protected write operations.
 * Always enforced regardless of API_AUTH_ENABLED env var.
 * Returns null on pass (authenticated), or 401 NextResponse on failure.
 * 
 * This requires a valid session token in the Authorization header.
 * Used for operations like: delete tasks, update malicious DB, 
 * change settings, manage API keys, etc.
 */
export function requireSessionAuth(request: NextRequest): NextResponse | null {
  // Exempt health check endpoint
  if (isHealthCheckRequest(request)) return null;

  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json(
      { error: '登录后才能执行此操作', requiresAuth: true },
      { status: 401 }
    );
  }

  const username = validateSession(token);
  if (!username) {
    return NextResponse.json(
      { error: '登录已过期，请重新登录', requiresAuth: true },
      { status: 401 }
    );
  }

  return null;
}
