import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    activeTasks: 0,
    uptime: Math.floor(process.uptime()),
    engine: 'integrated',
  });
}
