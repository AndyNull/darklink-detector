import { NextRequest, NextResponse } from 'next/server';
import { validateLogin, validateUsername, getSessionFromRequest, rsaDecrypt, changeUsernameInConfig, checkPasswordChangeRateLimit } from '@/lib/server-config';
import { auditLog } from '@/lib/audit-logger';

export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP
    const ip = request.headers.get('x-real-ip') ||
               request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               'unknown';
    const rateLimit = checkPasswordChangeRateLimit(ip);
    if (!rateLimit.allowed) {
      const waitMinutes = Math.ceil(rateLimit.remainingMs / 60000);
      return NextResponse.json(
        { error: `操作过于频繁，请${waitMinutes}分钟后再试` },
        { status: 429 }
      );
    }

    // Validate session via Authorization header
    const currentUsername = getSessionFromRequest(request);
    if (!currentUsername) {
      return NextResponse.json({ error: '会话已过期，请重新登录' }, { status: 401 });
    }

    const body = await request.json();
    const { newUsername, password, encrypted } = body;

    // 强制要求加密传输
    if (!encrypted) {
      return NextResponse.json(
        { error: '安全验证失败：密码必须加密传输，请刷新页面重试' },
        { status: 400 }
      );
    }

    if (!newUsername || !password) {
      return NextResponse.json({ error: '新用户名和密码不能为空' }, { status: 400 });
    }

    // 解密RSA加密的密码
    const decryptedPassword = rsaDecrypt(password);
    if (!decryptedPassword) {
      return NextResponse.json(
        { error: '密码解密失败，请刷新页面重试' },
        { status: 400 }
      );
    }

    // Validate new username
    const usernameValidation = validateUsername(newUsername);
    if (!usernameValidation.valid) {
      return NextResponse.json({ error: usernameValidation.errors[0] }, { status: 400 });
    }

    // Check new username is different
    if (newUsername === currentUsername) {
      return NextResponse.json({ error: '新用户名与当前用户名相同' }, { status: 400 });
    }

    // Verify password
    const isValid = validateLogin(currentUsername, decryptedPassword);
    if (!isValid) {
      auditLog.auth('username_change_failed', currentUsername, `Failed username change attempt (wrong password) from ${currentUsername} to ${newUsername}`, ip).catch(() => {});
      return NextResponse.json({ error: '密码错误' }, { status: 401 });
    }

    // Change username
    const success = changeUsernameInConfig(currentUsername, newUsername);
    if (!success) {
      return NextResponse.json({ error: '用户名修改失败，用户不存在' }, { status: 400 });
    }

    auditLog.auth('username_changed', currentUsername, `Username changed from "${currentUsername}" to "${newUsername}"`, ip).catch(() => {});

    return NextResponse.json({ success: true, username: newUsername });
  } catch {
    return NextResponse.json({ error: '修改用户名失败' }, { status: 500 });
  }
}
