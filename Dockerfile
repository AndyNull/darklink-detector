# syntax=docker/dockerfile:1.4
# ==============================================================================
#  暗链检测系统 — Dockerfile (多阶段构建, v4 优化版)
#  单容器方案: Next.js 主应用 + 扫描引擎 + 数据同步服务
#
#  优化策略:
#  1. Builder 使用 bun install 替代 npm install (406s → ~30-60s)
#  2. 从 oven/bun:1.2 镜像直接 COPY bun 二进制 (免安装)
#  3. Prisma CLI 安装到 /opt/prisma (全局可访问, 不依赖 /root/.bun)
#  4. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD — builder 中跳过浏览器下载
#  5. 并行阶段 — Playwright / mini-deps 与主项目构建并行
#  6. BuildKit 缓存挂载 — bun cache + next build 增量构建
#  7. standalone 自带 @prisma/client — 无需手动复制
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

# 从官方 bun 镜像复制二进制 (比 npm install -g bun 快得多)
COPY --from=oven/bun:1.2 /usr/local/bin/bun /usr/local/bin/bun

# 跳过 Playwright 浏览器下载 — 浏览器由 playwright-base 阶段单独安装
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json bun.lock ./

# 使用 bun install 替代 npm install (显著加速依赖安装)
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install

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

# ── 安装 Prisma CLI 到 /opt/prisma ──
# 将 prisma 安装到独立目录 (而非 bun global), 避免权限问题
# 所有用户均可通过 /usr/local/bin/prisma 调用
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    mkdir -p /opt/prisma && cd /opt/prisma && \
    echo '{"name":"prisma-cli","dependencies":{}}' > package.json && \
    bun add prisma@6 && \
    chmod -R o+rX /opt/prisma/node_modules

# 创建 prisma wrapper 脚本 (放在 /usr/local/bin, 所有用户 PATH 可达)
RUN echo '#!/bin/sh' > /usr/local/bin/prisma && \
    echo 'exec bun /opt/prisma/node_modules/prisma/build/index.js "$@"' >> /usr/local/bin/prisma && \
    chmod +x /usr/local/bin/prisma

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
