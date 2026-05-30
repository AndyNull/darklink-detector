import { NextRequest, NextResponse } from 'next/server';
import { validateLogin, createSession, checkRateLimit, resetRateLimit, validateUsername, rsaDecrypt, isDefaultPassword } from '@/lib/server-config';
import { auditLog } from '@/lib/audit-logger';

export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP
    const ip = request.headers.get('x-real-ip') ||
               request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               'unknown';
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      const waitMinutes = Math.ceil(rateLimit.remainingMs / 60000);
      return NextResponse.json(
        { error: `登录尝试过于频繁，请${waitMinutes}分钟后再试` },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { username, password, encrypted } = body;

    // 强制要求加密传输，拒绝明文密码
    if (!encrypted) {
      return NextResponse.json(
        { error: '安全验证失败：密码必须加密传输，请刷新页面重试' },
        { status: 400 }
      );
    }

    if (!password) {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 解密RSA加密的密码
    const decrypted = rsaDecrypt(password);
    if (!decrypted) {
      return NextResponse.json(
        { error: '密码解密失败，请刷新页面重试' },
        { status: 400 }
      );
    }
    const decryptedPassword = decrypted;

    // Input validation
    if (!username) {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }

    if (typeof username !== 'string' || typeof decryptedPassword !== 'string') {
      return NextResponse.json({ error: '输入格式无效' }, { status: 400 });
    }

    // Length validation to prevent DoS
    if (username.length > 50 || decryptedPassword.length > 128) {
      return NextResponse.json({ error: '输入长度超出限制' }, { status: 400 });
    }

    const usernameValidation = validateUsername(username);
    if (!usernameValidation.valid) {
      return NextResponse.json({ error: usernameValidation.errors[0] }, { status: 400 });
    }

    const isValid = validateLogin(username, decryptedPassword);
    if (!isValid) {
      // Log failed login attempt
      auditLog.auth('login_failed', username || 'unknown', `Failed login attempt for username: ${username || '(empty)'}`, ip).catch(() => {});
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    // Reset rate limit on successful login
    resetRateLimit(ip);

    const token = createSession(username);
    const isDefault = isDefaultPassword(username);

    // Log successful login
    auditLog.auth('login_success', username, `User logged in successfully${isDefault ? ' (using default password)' : ''}`, ip).catch(() => {});

    return NextResponse.json({ success: true, token, username, isDefaultPassword: isDefault });
  } catch {
    return NextResponse.json({ error: '登录失败' }, { status: 500 });
  }
}
