# ==============================================================================
#  暗链检测系统 — Dockerfile (多阶段构建)
#  单容器方案: Next.js 主应用 + 扫描引擎 + 数据同步服务
# ==============================================================================

# ─── 阶段1: 安装依赖 ──────────────────────────────────────────────────────────
FROM oven/bun:1.2 AS deps

WORKDIR /app

# 先复制 package 文件，利用 Docker 缓存层
COPY package.json ./
COPY mini-services/scan-engine/package.json ./mini-services/scan-engine/
COPY mini-services/data-sync-service/package.json ./mini-services/data-sync-service/

# 安装主项目依赖（含 prisma CLI，构建时需要）
RUN bun install

# 安装 mini-services 依赖
RUN cd mini-services/scan-engine && bun install
RUN cd mini-services/data-sync-service && bun install

# ─── 阶段2: 构建前端 ─────────────────────────────────────────────────────────
FROM deps AS builder

WORKDIR /app

# 生成 Prisma Client
COPY prisma ./prisma
RUN bunx prisma generate

# 复制源代码并构建
COPY . .
RUN bun run build

# ─── 阶段3: 生产镜像 ─────────────────────────────────────────────────────────
FROM oven/bun:1.2 AS runner

WORKDIR /app

# 安装运行时依赖: curl(扫描引擎回退) + sqlite3(db:push需要)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl sqlite3 && \
    rm -rf /var/lib/apt/lists/*

# 环境变量
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:./db/custom.db

# 创建非 root 用户
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

# 创建持久化目录
RUN mkdir -p /app/db /app/config && \
    chown -R appuser:appgroup /app/db /app/config

# ── 复制 Next.js standalone 产物 ──
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public

# ── 复制 Prisma（运行时 db:push 需要）──
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=builder --chown=appuser:appgroup /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=appuser:appgroup /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=appuser:appgroup /app/node_modules/prisma ./node_modules/prisma

# ── 复制 mini-services（完整源码 + 依赖）──
COPY --from=builder --chown=appuser:appgroup /app/mini-services ./mini-services

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
