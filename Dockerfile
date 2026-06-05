# syntax=docker/dockerfile:1.4
# ==============================================================================
#  暗链检测系统 — Dockerfile (多阶段构建, 优化版)
#  单容器方案: Next.js 主应用 + 扫描引擎 + 数据同步服务
#
#  优化策略:
#  1. BuildKit 缓存挂载 — bun install / next build 增量构建
#  2. Node.js 构建 Next.js — next build 需要 worker_threads (Bun 不支持)
#  3. 并行阶段 — Playwright 安装与主项目构建并行
#  4. 精简 .dockerignore — 减少构建上下文体积
#  5. Prisma 版本锁定 — 避免 bunx 动态安装不兼容版本
# ==============================================================================

# ─── 阶段1: 安装主项目依赖 (Bun 安装快) ──────────────────────────────────────
FROM oven/bun:1.2 AS deps

WORKDIR /app

COPY package.json bun.lock ./

RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install

# ─── 阶段1b: 安装 mini-services 依赖 (与主项目并行) ─────────────────────────
FROM oven/bun:1.2 AS mini-deps

WORKDIR /app

COPY mini-services/scan-engine/package.json mini-services/scan-engine/bun.lock ./mini-services/scan-engine/
COPY mini-services/data-sync-service/package.json mini-services/data-sync-service/bun.lock ./mini-services/data-sync-service/

RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    cd mini-services/scan-engine && bun install && \
    cd /app/mini-services/data-sync-service && bun install

# ─── 阶段2: Playwright 预安装 (与构建并行) ───────────────────────────────────
FROM oven/bun:1.2 AS playwright-base

ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl sqlite3 && \
    rm -rf /var/lib/apt/lists/* && \
    bunx playwright install --with-deps chromium && \
    chown -R 1001:1001 /app/.cache

# ─── 阶段3: 构建前端 (使用 Node.js — next build 依赖 worker_threads) ────────
FROM node:20-slim AS builder

WORKDIR /app

# 从 deps 阶段复制 bun 安装的 node_modules (node 兼容)
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# 生成 Prisma Client
COPY prisma ./prisma
RUN npx prisma generate

# 复制源代码并构建
COPY . .

ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_TELEMETRY_DISABLED=1

RUN --mount=type=cache,target=/app/.next/cache,sharing=locked \
    npx next build && \
    cp -r .next/static .next/standalone/.next/ && \
    cp -r public .next/standalone/

# ─── 阶段4: 生产镜像 ─────────────────────────────────────────────────────────
FROM oven/bun:1.2 AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

# 安装运行时系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl sqlite3 && \
    rm -rf /var/lib/apt/lists/*

# 从 Playwright 预构建阶段复制 Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright
COPY --from=playwright-base --chown=appuser:appgroup /app/.cache/ms-playwright /app/.cache/ms-playwright

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:./db/custom.db

RUN mkdir -p /app/db /app/config && \
    chown -R appuser:appgroup /app/db /app/config

# ── 复制 Next.js standalone 产物 ──
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public

RUN echo 'DATABASE_URL=file:./db/custom.db' > .env && \
    chown appuser:appgroup .env

# ── 复制 Prisma（运行时 db:push 需要）──
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=builder --chown=appuser:appgroup /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=appuser:appgroup /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=appuser:appgroup /app/node_modules/prisma ./node_modules/prisma
# entrypoint 直接用 bun ./node_modules/prisma/bin/prisma 调用，无需 symlink

# ── 复制 mini-services ──
COPY --from=mini-deps --chown=appuser:appgroup /app/mini-services ./mini-services

# ── 复制启动脚本 ──
COPY --chown=appuser:appgroup docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER appuser

EXPOSE 3000
VOLUME ["/app/db", "/app/config"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
