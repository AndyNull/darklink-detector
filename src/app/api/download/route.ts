import { NextResponse } from 'next/server';
import { ARCHIVE_NAME, APP_VERSION } from '@/lib/version';

// GET /api/download — returns archive info pointing to GitHub Releases
export const dynamic = 'force-dynamic';

export async function GET() {
  // Project archives are now distributed via GitHub Releases
  const githubRepo = 'AndyNull/darklink-detector';
  const releaseUrl = `https://github.com/${githubRepo}/releases/tag/${APP_VERSION}`;
  const downloadUrl = `https://github.com/${githubRepo}/releases/download/${APP_VERSION}/${ARCHIVE_NAME}`;

  return NextResponse.json({
    name: ARCHIVE_NAME,
    version: APP_VERSION,
    sizeMB: null, // Size not available without local file; shown on GitHub Releases page
    downloadUrl,
    releaseUrl,
    source: 'github_releases',
  });
}
