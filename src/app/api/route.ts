import { NextResponse } from "next/server";
import { APP_VERSION } from '@/lib/version';

export async function GET() {
  return NextResponse.json({
    name: 'DarkLink Detector',
    version: APP_VERSION,
    status: 'running',
  });
}