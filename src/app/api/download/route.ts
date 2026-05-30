import { NextResponse } from 'next/server';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { ARCHIVE_NAME } from '@/lib/version';

// GET /api/download — returns archive info (JSON) or file stream
// Archive is stored in the public/ directory for direct web access
export async function GET(request: Request) {
  // Check public/ folder first (preferred location), then download/ folder (legacy)
  const publicPath = join(process.cwd(), 'public', ARCHIVE_NAME);
  const downloadPath = join(process.cwd(), 'download', ARCHIVE_NAME);

  let filePath: string | null = null;
  if (existsSync(publicPath)) {
    filePath = publicPath;
  } else if (existsSync(downloadPath)) {
    filePath = downloadPath;
  }

  if (!filePath) {
    return NextResponse.json({ error: 'Archive not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // ?action=file — stream the archive file directly
  if (action === 'file') {
    const fileSize = statSync(filePath).size;
    const fileBuffer = await import('fs').then(fs => fs.promises.readFile(filePath));

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${ARCHIVE_NAME}"`,
        'Content-Length': String(fileSize),
      },
    });
  }

  // Default: return archive info as JSON
  const fileSize = statSync(filePath).size;
  return NextResponse.json({
    name: ARCHIVE_NAME,
    size: fileSize,
    sizeMB: (fileSize / (1024 * 1024)).toFixed(1),
    // Direct static file URL from public/ folder — no API overhead
    downloadUrl: `/${ARCHIVE_NAME}`,
  });
}
