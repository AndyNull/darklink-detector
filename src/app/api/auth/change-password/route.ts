import { NextRequest, NextResponse } from 'next/server';
import { changePassword, validatePasswordStrength, checkPasswordChangeRateLimit, getSessionFromRequest, rsaDecrypt } from '@/lib/server-config';
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
        { error: `密码修改尝试过于频繁，请${waitMinutes}分钟后再试` },
        { status: 429 }
      );
    }

    // Validate session via Authorization header
    const username = getSessionFromRequest(request);
    if (!username) {
      return NextResponse.json({ error: '会话已过期，请重新登录' }, { status: 401 });
    }

    const body = await request.json();
    const { oldPassword, newPassword, encrypted } = body;

    // 强制要求加密传输，拒绝明文密码
    if (!encrypted) {
      return NextResponse.json(
        { error: '安全验证失败：密码必须加密传输，请刷新页面重试' },
        { status: 400 }
      );
    }

    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: '旧密码和新密码不能为空' }, { status: 400 });
    }

    // 解密RSA加密的旧密码
    const decryptedOld = rsaDecrypt(oldPassword);
    if (!decryptedOld) {
      return NextResponse.json({ error: '旧密码解密失败，请刷新页面重试' }, { status: 400 });
    }

    // 解密RSA加密的新密码
    const decryptedNew = rsaDecrypt(newPassword);
    if (!decryptedNew) {
      return NextResponse.json({ error: '新密码解密失败，请刷新页面重试' }, { status: 400 });
    }

    if (typeof decryptedOld !== 'string' || typeof decryptedNew !== 'string') {
      return NextResponse.json({ error: '输入格式无效' }, { status: 400 });
    }

    // Length validation to prevent DoS
    if (decryptedOld.length > 128 || decryptedNew.length > 128) {
      return NextResponse.json({ error: '密码长度不能超过128个字符' }, { status: 400 });
    }

    if (decryptedOld.length < 1) {
      return NextResponse.json({ error: '旧密码不能为空' }, { status: 400 });
    }

    // Validate new password strength
    const strengthCheck = validatePasswordStrength(decryptedNew);
    if (!strengthCheck.valid) {
      return NextResponse.json({ error: strengthCheck.errors[0] }, { status: 400 });
    }

    // New password must be different from old password
    if (decryptedOld === decryptedNew) {
      return NextResponse.json({ error: '新密码不能与旧密码相同' }, { status: 400 });
    }

    const success = changePassword(username, decryptedOld, decryptedNew);
    if (!success) {
      return NextResponse.json({ error: '旧密码错误' }, { status: 400 });
    }

    // Log password change
    auditLog.auth('password_changed', username, 'Password changed successfully', ip).catch(() => {});

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '修改密码失败' }, { status: 500 });
  }
}
