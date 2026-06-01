/**
 * Safe error response helper for API routes.
 *
 * In production, internal error details are hidden to prevent information leakage.
 * In development, the original error message is returned for debugging.
 */

export function safeErrorResponse(err: unknown, defaultMessage: string = '服务器内部错误') {
  const message = process.env.NODE_ENV === 'production'
    ? defaultMessage
    : (err instanceof Error ? err.message : String(err));
  return Response.json({ error: message }, { status: 500 });
}
