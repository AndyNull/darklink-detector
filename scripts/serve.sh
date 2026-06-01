#!/usr/bin/env bash
# ─── Production server with auto-restart ─────────────────────────────────────
# Runs the Next.js standalone server with automatic restart on crash.
# Used by `bun run dev` for stable preview in sandboxed environments.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PORT="${PORT:-3000}"
# Force HOSTNAME to 0.0.0.0 to listen on all interfaces
# (container HOSTNAME env var would override Next.js binding otherwise)
export HOSTNAME=0.0.0.0
SERVER_BIN=".next/standalone/server.js"
LOG_FILE="${1:-dev.log}"
RESTART_DELAY=3
MAX_RESTARTS=10
restart_count=0

cd "$(dirname "$0")/.."

# Ensure build exists
if [ ! -f "$SERVER_BIN" ]; then
  echo "Building production bundle..."
  bun run build
fi

echo "Starting DarkLink Detector server on :${PORT} (auto-restart enabled)"

while [ $restart_count -lt $MAX_RESTARTS ]; do
  NODE_ENV=production PORT=$PORT \
    node "$SERVER_BIN" 2>&1 | tee "$LOG_FILE"
  
  exit_code=${PIPESTATUS[0]}
  restart_count=$((restart_count + 1))
  
  echo "Server exited (code=$exit_code), restarting in ${RESTART_DELAY}s... (attempt $restart_count/$MAX_RESTARTS)"
  sleep $RESTART_DELAY
done

echo "Max restarts reached ($MAX_RESTARTS). Exiting."
exit 1
