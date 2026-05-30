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

# ─── 1. 初始化数据库 ─────────────────────────────────────────────────────────
if [ ! -f /app/db/custom.db ]; then
  echo "[1/5] 初始化数据库..."
  cd /app && bunx prisma db push --skip-generate 2>&1
  echo "  ✓ 数据库初始化完成"
else
  echo "[1/5] 数据库已存在，跳过初始化"
fi

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
echo "  ✓ 数据同步服务已启动 (PID: $SYNC_PID)"

# ─── 4. 启动扫描引擎 ───────────────────────────────────────────────────────
echo "[4/5] 启动扫描引擎 (port 3003)..."
cd /app/mini-services/scan-engine
bun index.ts &
SCAN_PID=$!
echo "  ✓ 扫描引擎已启动 (PID: $SCAN_PID)"

# 等待后端服务就绪
sleep 2

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
  # 给子进程时间清理
  sleep 2
  echo "所有服务已停止"
  exit 0
}

trap cleanup SIGTERM SIGINT

# 启动 Next.js standalone server（前台运行）
# standalone 模式输出的是 node 格式的 server.js，bun 兼容运行
exec bun server.js
