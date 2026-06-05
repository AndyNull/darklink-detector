# syntax=docker/dockerfile:1.4
# ==============================================================================
#  暗链检测系统 — Dockerfile (多阶段构建, 优化版)
#  单容器方案: Next.js 主应用 + 扫描引擎 + 数据同步服务
#
#  优化策略:
#  1. BuildKit 缓存挂载 — bun install / next build 增量构建
#  2. Turbopack 生产构建 — 比 webpack 快 3-5 倍
#  3. 并行阶段 — Playwright 安装与主项目构建并行
#  4. 精简 .dockerignore — 减少构建上下文体积
#  5. Prisma 版本锁定 — 避免 bunx 动态安装不兼容版本
# ==============================================================================

# ─── 阶段1: 安装主项目依赖 ──────────────────────────────────────────────────
FROM oven/bun:1.2 AS deps

WORKDIR /app

# 先复制 package 文件，利用 Docker 缓存层
COPY package.json bun.lock ./

# 使用 BuildKit 缓存挂载加速依赖安装
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

# 安装运行时依赖 + Playwright Chromium (合并减少 apt 层数)
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl sqlite3 && \
    rm -rf /var/lib/apt/lists/* && \
    bunx playwright install --with-deps chromium && \
    chown -R 1001:1001 /app/.cache

# ─── 阶段3: 构建前端 ─────────────────────────────────────────────────────────
FROM deps AS builder

WORKDIR /app

# 生成 Prisma Client (使用项目安装的 prisma 版本，而非 bunx 动态下载)
COPY prisma ./prisma
RUN ./node_modules/.bin/prisma generate

# 复制源代码
COPY . .

# 构建优化:
# - Turbopack 比 webpack 快 3-5 倍
# - 缓存挂载实现增量构建
# - 增大 Node 堆内存减少 GC 停顿
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_TELEMETRY_DISABLED=1

RUN --mount=type=cache,target=/app/.next/cache,sharing=locked \
    bunx next build --turbopack && \
    cp -r .next/static .next/standalone/.next/ && \
    cp -r public .next/standalone/

# ─── 阶段4: 生产镜像 ─────────────────────────────────────────────────────────
FROM oven/bun:1.2 AS runner

WORKDIR /app

# 创建非 root 用户 (尽早创建，后续 COPY 可直接 --chown)
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

# 安装运行时系统依赖 (curl: 扫描引擎回退 + 健康检查, sqlite3: db:push)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl sqlite3 && \
    rm -rf /var/lib/apt/lists/*

# 从 Playwright 预构建阶段复制 Chromium (避免在 runner 中重新安装)
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright
COPY --from=playwright-base --chown=appuser:appgroup /app/.cache/ms-playwright /app/.cache/ms-playwright

# 环境变量
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:./db/custom.db

# 创建持久化目录
RUN mkdir -p /app/db /app/config && \
    chown -R appuser:appgroup /app/db /app/config

# ── 复制 Next.js standalone 产物 ──
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public

# 覆盖 standalone 中的 .env (构建时可能包含开发机绝对路径)
RUN echo 'DATABASE_URL=file:./db/custom.db' > .env && \
    chown appuser:appgroup .env

# ── 复制 Prisma（运行时 db:push 需要）──
# 关键: 使用 builder 阶段安装的 prisma 版本，而非 bunx 动态下载
# 这确保了 prisma CLI 版本与 @prisma/client 版本一致
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=builder --chown=appuser:appgroup /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=appuser:appgroup /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=appuser:appgroup /app/node_modules/prisma ./node_modules/prisma
# 创建 prisma CLI 软链接，让 entrypoint 可以直接调用
RUN mkdir -p /app/node_modules/.bin && \
    ln -sf ../prisma/bin/prisma /app/node_modules/.bin/prisma && \
    chown -R appuser:appgroup /app/node_modules/.bin

# ── 复制 mini-services（完整源码 + node_modules，从 mini-deps 阶段）──
# ⚠️ 必须在 standalone COPY 之后执行，覆盖 standalone 中不含依赖的 mini-services
COPY --from=mini-deps --chown=appuser:appgroup /app/mini-services ./mini-services

# ── 复制配置和启动脚本 ──
COPY --chown=appuser:appgroup docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# 切换到非 root 用户
USER appuser

# 只暴露主应用端口，内部服务(3003/3004)通过 Next.js rewrites 代理
EXPOSE 3000

# 数据卷（持久化）
VOLUME ["/app/db", "/app/config"]

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# 启动入口
ENTRYPOINT ["./docker-entrypoint.sh"]
