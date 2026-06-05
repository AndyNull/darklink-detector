#!/bin/bash
# ==============================================================================
#  暗链检测系统 — Docker 容器启动入口
#  启动顺序: 初始化数据库 → 创建管理员 → 数据同步服务 → 扫描引擎 → 主应用
# ==============================================================================

set -e

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         暗链检测系统  ·  Docker 启动             ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── 1. 初始化/同步数据库 ───────────────────────────────────────────────────
# Always run prisma db push — it's idempotent and ensures the schema is up-to-date.
# This handles both first-run (creates DB) and upgrades (applies schema changes).
# Uses globally installed prisma@6 CLI (bun add -g prisma@6 in Dockerfile)
# CRITICAL: Must NOT use bunx/npx which downloads Prisma 7.x (incompatible)
echo "[1/5] 同步数据库 schema..."
cd /app && prisma db push 2>&1
echo "  ✓ 数据库 schema 同步完成"

# ─── 2. 确保默认管理员账户 ───────────────────────────────────────────────────
echo "[2/5] 检查管理员账户..."
AUTH_FILE="/app/config/auth.json"
ADMIN_HASH='$2b$12$jVgFdgNLBU34Ge9szNlbfuMrS3hf3Nd3gxFkNk68EthZtjlW.H5r2'

if [ ! -f "$AUTH_FILE" ] || ! grep -q '"username"' "$AUTH_FILE" 2>/dev/null; then
  mkdir -p /app/config
  cat > "$AUTH_FILE" <<EOF
{
  "users": [
    {
      "username": "admin",
      "passwordHash": "$ADMIN_HASH"
    }
  ]
}
EOF
  echo "  ✓ 已创建默认管理员账户 (admin/admin123)"
else
  echo "  ✓ 管理员账户已存在"
fi

# ─── 3. 启动数据同步服务 ───────────────────────────────────────────────────
echo "[3/5] 启动数据同步服务 (port 3004)..."
cd /app/mini-services/data-sync-service
DB_PATH=/app/db/custom.db bun index.ts &
SYNC_PID=$!
sleep 0.5
if ! kill -0 $SYNC_PID 2>/dev/null; then
  echo "  ✗ 数据同步服务启动失败!"
fi
echo "  ✓ 数据同步服务已启动 (PID: $SYNC_PID)"

# ─── 4. 启动扫描引擎 ───────────────────────────────────────────────────────
echo "[4/5] 启动扫描引擎 (port 3003)..."
cd /app/mini-services/scan-engine
bun index.ts &
SCAN_PID=$!
sleep 0.5
if ! kill -0 $SCAN_PID 2>/dev/null; then
  echo "  ✗ 扫描引擎启动失败!"
fi
echo "  ✓ 扫描引擎已启动 (PID: $SCAN_PID)"

# Wait for mini-services to be ready
echo "  等待后端服务就绪..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3003/health >/dev/null 2>&1 && \
     curl -sf http://localhost:3004/health >/dev/null 2>&1; then
    echo "  ✓ 后端服务已就绪 (${i}s)"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "  ⚠ 后端服务未在30秒内就绪，继续启动..."
  fi
  sleep 1
done

# ─── 5. 启动主应用 ─────────────────────────────────────────────────────────
echo "[5/5] 启动 Next.js 主应用 (port 3000)..."
cd /app

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║              启动完成                            ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  访问地址:  http://localhost:3000                 ║"
echo "║  默认账号:  admin                                ║"
echo "║  默认密码:  admin123                             ║"
echo "║                                                  ║"
echo "║  ⚠ 首次登录后请立即修改默认密码！                ║"
echo "║                                                  ║"
echo "║  服务端口: 3000 (含内部服务代理)                  ║"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# 优雅关闭：捕获信号，通知子进程
cleanup() {
  echo ""
  echo "正在停止所有服务..."
  kill $SCAN_PID 2>/dev/null || true
  kill $SYNC_PID 2>/dev/null || true
  kill $MAIN_PID 2>/dev/null || true
  wait
  echo "所有服务已停止"
  exit 0
}

trap cleanup SIGTERM SIGINT

# 启动 Next.js standalone server（后台运行）
# standalone 模式输出的是 node 格式的 server.js，bun 兼容运行
bun server.js &
MAIN_PID=$!

# Monitor background services and restart if crashed
while kill -0 $MAIN_PID 2>/dev/null; do
  if ! kill -0 $SCAN_PID 2>/dev/null; then
    echo "[监控] 扫描引擎已停止，正在重启..."
    cd /app/mini-services/scan-engine && bun index.ts &
    SCAN_PID=$!
  fi
  if ! kill -0 $SYNC_PID 2>/dev/null; then
    echo "[监控] 数据同步服务已停止，正在重启..."
    cd /app/mini-services/data-sync-service && DB_PATH=/app/db/custom.db bun index.ts &
    SYNC_PID=$!
  fi
  sleep 10
done &

wait $MAIN_PID
