#!/bin/bash
# Start the download file server on port 3006
# Reads archive name from src/lib/version.ts

PORT=3006
DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# Read version from package.json
ARCHIVE_NAME="darklink-detector-$(node -p "require('$DIR/package.json').version").tar.gz"

# Check if already running
if lsof -i :$PORT >/dev/null 2>&1; then
  echo "Download server already running on port $PORT"
  exit 0
fi

# Start a simple file server using bun
cd "$DIR"
nohup bun -e "
const server = Bun.serve({
  port: $PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/archive') {
      const file = Bun.file('$DIR/download/$ARCHIVE_NAME');
      if (!(await file.exists())) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(file, {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': 'attachment; filename=\"$ARCHIVE_NAME\"',
        },
      });
    }
    return new Response('Not found', { status: 404 });
  },
});
console.log('Download server running on port $PORT');
" > /tmp/download-server.log 2>&1 &

echo "Download server started on port $PORT"
echo "Serving: $DIR/download/$ARCHIVE_NAME"
