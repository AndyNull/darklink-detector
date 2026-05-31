#!/usr/bin/env bash
# ==============================================================================
#  暗链检测系统 — 一键启动脚本
#  这是唯一需要用户关心的 shell 脚本
# ==============================================================================

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# ─── Resolve project root ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║         暗链检测系统  ·  一键启动               ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ─── Step 0: Ensure .env file exists ─────────────────────────────────────────
ENV_FILE="$PROJECT_ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${YELLOW}${BOLD}[准备]${NC} ${BOLD}创建 .env 文件...${NC}"
  cp "$PROJECT_ROOT/.env.example" "$ENV_FILE"
  echo -e "${GREEN}  ✓ 已从 .env.example 创建 .env (默认使用 SQLite)${NC}"
  echo ""
fi

# ─── Step 1: Install main project dependencies ───────────────────────────────
echo -e "${BLUE}${BOLD}[1/6]${NC} ${BOLD}安装主项目依赖...${NC}"
cd "$PROJECT_ROOT"
bun install
echo -e "${GREEN}  ✓ 主项目依赖安装完成${NC}"
echo ""

# ─── Step 2: Install mini-services dependencies ─────────────────────────────
echo -e "${BLUE}${BOLD}[2/6]${NC} ${BOLD}安装扫描引擎依赖...${NC}"
cd "$PROJECT_ROOT/mini-services/scan-engine"
bun install
echo -e "${GREEN}  ✓ 扫描引擎依赖安装完成${NC}"

echo -e "${BLUE}${BOLD}[2/6]${NC} ${BOLD}安装数据同步服务依赖...${NC}"
cd "$PROJECT_ROOT/mini-services/data-sync-service"
bun install
echo -e "${GREEN}  ✓ 数据同步服务依赖安装完成${NC}"
echo ""

# ─── Step 3: Initialize database ─────────────────────────────────────────────
echo -e "${BLUE}${BOLD}[3/6]${NC} ${BOLD}初始化数据库...${NC}"
cd "$PROJECT_ROOT"
bun run db:push
echo -e "${GREEN}  ✓ 数据库初始化完成${NC}"
echo ""

# ─── Step 4: Ensure default admin account ────────────────────────────────────
echo -e "${BLUE}${BOLD}[4/6]${NC} ${BOLD}检查默认管理员账户...${NC}"
AUTH_FILE="$PROJECT_ROOT/config/auth.json"
ADMIN_HASH='$2b$12$jVgFdgNLBU34Ge9szNlbfuMrS3hf3Nd3gxFkNk68EthZtjlW.H5r2'

if [ ! -f "$AUTH_FILE" ]; then
  # Create auth.json with default admin account
  mkdir -p "$PROJECT_ROOT/config"
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
  echo -e "${GREEN}  ✓ 已创建默认管理员账户${NC}"
else
  # Check if admin user exists
  if grep -q '"admin"' "$AUTH_FILE" 2>/dev/null; then
    echo -e "${GREEN}  ✓ 管理员账户已存在${NC}"
  else
    echo -e "${YELLOW}  ⚠ auth.json 中未找到 admin 用户，请手动检查${NC}"
  fi
fi
echo ""

# ─── Step 5: Start all services ──────────────────────────────────────────────
echo -e "${BLUE}${BOLD}[5/6]${NC} ${BOLD}启动所有服务...${NC}"

# Start scan-engine (port 3003)
cd "$PROJECT_ROOT/mini-services/scan-engine"
echo -e "${DIM}  → 启动扫描引擎 (port 3003)...${NC}"
bun --hot index.ts &
SCAN_PID=$!
echo -e "${GREEN}  ✓ 扫描引擎已启动 (PID: $SCAN_PID)${NC}"

# Start data-sync-service (port 3004)
cd "$PROJECT_ROOT/mini-services/data-sync-service"
echo -e "${DIM}  → 启动数据同步服务 (port 3004)...${NC}"
bun --hot index.ts &
SYNC_PID=$!
echo -e "${GREEN}  ✓ 数据同步服务已启动 (PID: $SYNC_PID)${NC}"

# Start Next.js dev server (port 3000)
cd "$PROJECT_ROOT"
echo -e "${DIM}  → 启动 Next.js 主应用 (port 3000)...${NC}"
bun run dev &
NEXT_PID=$!
echo -e "${GREEN}  ✓ Next.js 主应用已启动 (PID: $NEXT_PID)${NC}"
echo ""

# ─── Step 6: Show startup info ───────────────────────────────────────────────
echo -e "${BLUE}${BOLD}[6/6]${NC} ${BOLD}启动完成！${NC}"
echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║              启动信息                           ║${NC}"
echo -e "${CYAN}${BOLD}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}${BOLD}║${NC}                                                  ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}  ${BOLD}访问地址:${NC}  ${GREEN}http://localhost:3000${NC}              ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}                                                  ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}  ${BOLD}默认账号:${NC}  ${YELLOW}admin${NC}                            ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}  ${BOLD}默认密码:${NC}  ${YELLOW}admin123${NC}                         ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}                                                  ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}  ${RED}${BOLD}⚠ 首次登录后请立即修改默认密码！${NC}           ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}                                                  ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}  ${DIM}扫描引擎:    port 3003 (内部)${NC}              ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}  ${DIM}数据同步:    port 3004 (内部)${NC}              ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}  ${DIM}主应用:      port 3000 (对外)${NC}              ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}                                                  ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}  ${DIM}按 Ctrl+C 停止所有服务${NC}                    ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}║${NC}                                                  ${CYAN}${BOLD}║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ─── Graceful shutdown ───────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo -e "${YELLOW}${BOLD}正在停止所有服务...${NC}"
  kill $SCAN_PID 2>/dev/null || true
  kill $SYNC_PID 2>/dev/null || true
  kill $NEXT_PID 2>/dev/null || true
  echo -e "${GREEN}${BOLD}所有服务已停止${NC}"
  exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for any child process to exit
wait
