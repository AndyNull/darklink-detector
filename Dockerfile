# syntax=docker/dockerfile:1.4
# ==============================================================================
#  暗链检测系统 — Dockerfile (多阶段构建, v3 优化版)
#  单容器方案: Next.js 主应用 + 扫描引擎 + 数据同步服务
#
#  优化策略:
#  1. 消除 1.2GB 跨阶段 COPY — builder 内直接 npm install + 缓存挂载
#  2. Prisma CLI 全局安装 — 避免手动复制依赖树（effect等传递依赖）
#  3. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD — builder 中跳过浏览器下载
#  4. 并行阶段 — Playwright / mini-deps 与主项目构建并行
#  5. BuildKit 缓存挂载 — npm cache + next build 增量构建
#  6. standalone 自带 @prisma/client — 无需手动复制
# ==============================================================================

# ─── 阶段1: 安装 mini-services 依赖 ─────────────────────────────────────────
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

# ─── 阶段3: 构建前端 (deps + build 合并) ────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# 跳过 Playwright 浏览器下载 — 浏览器由 playwright-base 阶段单独安装
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json ./

# 直接在 builder 内安装依赖，使用 BuildKit 缓存挂载加速后续构建
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install

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

# 全局安装 Prisma CLI (用于 entrypoint 中的 db:push)
# 这样不需要手动复制 prisma 的完整依赖树 (effect, @prisma/config 等)
# 版本与 package.json 中的 ^6.11.1 对齐
RUN bun add -g prisma@6

# 从 Playwright 预构建阶段复制 Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright
COPY --from=playwright-base --chown=appuser:appgroup /app/.cache/ms-playwright /app/.cache/ms-playwright

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:./db/custom.db

RUN mkdir -p /app/db /app/config && \
    chown -R appuser:appgroup /app/db /app/config

# ── 复制 Next.js standalone 产物 ──
# standalone 已包含精简的 node_modules (含 @prisma/client + .prisma/client)
# 不需要手动复制 Prisma 相关目录
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public

RUN echo 'DATABASE_URL=file:./db/custom.db' > .env && \
    chown appuser:appgroup .env

# ── 复制 Prisma schema (全局 prisma CLI 需要) ──
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma

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
