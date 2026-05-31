import { NextRequest, NextResponse } from 'next/server';
import {
  getDatabaseConfig,
  setDatabaseConfig,
  validateDatabaseConfigInput,
  maskDatabaseConfig,
  DatabaseConfig,
  rsaDecrypt,
  getSessionFromRequest,
} from '@/lib/server-config';
import { auditLog } from '@/lib/audit-logger';
import { requireSessionAuth } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    // Require authentication — database config may expose connection details
    const sessionError = requireSessionAuth(request);
    if (sessionError) return sessionError;

    const config = getDatabaseConfig();
    // Mask passwords in response - never send real passwords to client
    const safeConfig = maskDatabaseConfig(config);
    return NextResponse.json({ config: safeConfig });
  } catch {
    return NextResponse.json({ error: '读取数据库配置失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const sessionError = requireSessionAuth(request);
    if (sessionError) return sessionError;

    const actor = getSessionFromRequest(request) || 'system';
    const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    const body = await request.json();
    const config = body.config as DatabaseConfig;

    if (!config || !config.type) {
      return NextResponse.json({ error: '配置无效: 数据库类型为必填项' }, { status: 400 });
    }

    // Validate input
    const validation = validateDatabaseConfigInput(config as unknown as Record<string, unknown>);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    // Decrypt RSA-encrypted passwords before merging
    const decryptPassword = (pw: string | undefined): string | undefined => {
      if (!pw || pw === '******') return pw;
      const decrypted = rsaDecrypt(pw);
      return decrypted ?? pw; // Fall back to plaintext if not RSA-encrypted
    };

    // Merge with existing config to preserve passwords if masked
    const existingConfig = getDatabaseConfig();
    const decryptedMysqlPw = decryptPassword(config.mysql?.password);
    const decryptedPgPw = decryptPassword(config.postgresql?.password);

    const mergedConfig: DatabaseConfig = {
      type: config.type,
      sqlite: { ...existingConfig.sqlite, ...config.sqlite },
      mysql: {
        ...existingConfig.mysql,
        ...config.mysql,
        // If password is masked, keep existing; if RSA-encrypted, use decrypted; otherwise use as-is
        password: decryptedMysqlPw === '******' ? existingConfig.mysql.password : (decryptedMysqlPw ?? existingConfig.mysql.password),
      },
      postgresql: {
        ...existingConfig.postgresql,
        ...config.postgresql,
        password: decryptedPgPw === '******' ? existingConfig.postgresql.password : (decryptedPgPw ?? existingConfig.postgresql.password),
      },
    };

    setDatabaseConfig(mergedConfig);

    auditLog.system('db_config_changed', actor, { type: mergedConfig.type }, ip, 'database_config', 'main');

    // Return masked config in response - never leak real passwords
    const safeConfig = maskDatabaseConfig(mergedConfig);
    return NextResponse.json({ success: true, config: safeConfig });
  } catch {
    return NextResponse.json({ error: '保存数据库配置失败' }, { status: 500 });
  }
}
