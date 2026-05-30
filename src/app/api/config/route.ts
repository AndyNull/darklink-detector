import { NextRequest, NextResponse } from 'next/server';
import { requireSessionAuth } from '@/lib/api-auth';
import { getConfig, getEffectiveProvider } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  try {
    const config = getConfig();
    const provider = getEffectiveProvider();

    // Return safe config (no passwords)
    return NextResponse.json({
      database: {
        type: config.database.type,
        effectiveProvider: provider,
        sqlite: {
          path: config.database.sqlite.path,
        },
        mysql: {
          host: config.database.mysql.host,
          port: config.database.mysql.port,
          user: config.database.mysql.user,
          database: config.database.mysql.database,
          poolSize: config.database.mysql.poolSize,
        },
        postgresql: {
          host: config.database.postgresql.host,
          port: config.database.postgresql.port,
          user: config.database.postgresql.user,
          database: config.database.postgresql.database,
          poolSize: config.database.postgresql.poolSize,
          ssl: config.database.postgresql.ssl,
        },
      },
      scan: config.scan,
      app: config.app,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load config', details: (err as Error).message },
      { status: 500 }
    );
  }
}
