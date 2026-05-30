# DarkLink Detector（暗链检测系统）

> 专业的网页暗链检测与威胁情报分析平台

**版本：v1.8.1**

---

## 项目概述

DarkLink Detector（暗链检测系统）是一款面向网站安全运维人员的暗链检测工具。系统通过深度解析网页 HTML 结构、CSS 样式、JavaScript 动态内容以及二维码图像，自动识别 **21 种** 暗链隐藏手法，帮助用户发现被植入的隐蔽恶意链接。

核心能力包括：多 URL 批量扫描、深度子链挖掘、威胁情报联动、QR 码暗链检测、DNS Rebinding 防护、RSA 加密传输认证等。支持 Docker 一键部署，适配生产与开发环境。

---

## 项目架构

```
darklink-detector/
├── src/                          # Next.js 主应用源码
│   ├── app/                      # Next.js App Router
│   │   ├── page.tsx              # 主页面入口
│   │   ├── api/                  # API 路由
│   │   │   ├── scan/             # 扫描相关 API
│   │   │   │   ├── start/        # POST 启动扫描
│   │   │   │   ├── status/       # GET 扫描状态
│   │   │   │   ├── results/      # GET 扫描结果
│   │   │   │   ├── stop/         # POST 停止扫描
│   │   │   │   └── sublinks/     # POST 子链发现
│   │   │   ├── engine/           # 扫描引擎管理
│   │   │   ├── auth/             # 认证相关
│   │   │   ├── threat-intel/     # 威胁情报
│   │   │   └── config/           # 系统配置
│   │   └── layout.tsx            # 根布局
│   ├── components/               # React 组件
│   │   ├── scan/                 # 扫描相关组件
│   │   │   ├── scan-controls.tsx # 扫描控制（并发/超时/子链设置）
│   │   │   ├── url-input-panel.tsx # URL输入面板
│   │   │   ├── sublink-progress-panel.tsx # 子链进度
│   │   │   ├── results-panel/    # 扫描结果面板
│   │   │   └── settings/         # 设置面板
│   │   ├── layout/               # 布局组件
│   │   ├── settings/             # 系统设置
│   │   └── ui/                   # shadcn/ui 基础组件
│   ├── lib/                      # 核心库
│   │   ├── scan-engine/          # 集成扫描引擎
│   │   │   ├── scan-engine.ts    # 扫描执行核心
│   │   │   ├── html-parser.ts    # HTML解析 & 暗链检测
│   │   │   ├── browser-renderer.ts # Playwright浏览器渲染
│   │   │   ├── browser-sim.ts    # 浏览器请求模拟
│   │   │   ├── qr-detector.ts    # 二维码检测
│   │   │   ├── task-store.ts     # 任务数据存储
│   │   │   └── types.ts          # 类型定义
│   │   ├── scan-store.ts         # Zustand 状态管理
│   │   ├── scan-api.ts           # REST API 客户端
│   │   ├── config.ts             # 配置加载器
│   │   ├── security.ts           # SSRF/DNS安全验证
│   │   ├── auth-context.ts       # 认证上下文
│   │   └── version.ts            # 版本号
│   └── hooks/                    # React Hooks
├── mini-services/                # 独立微服务
│   ├── scan-engine/              # 扫描引擎服务 (Socket.IO, port 3003)
│   ├── data-sync-service/        # 威胁情报数据同步 (port 3004)
│   └── download-server/          # 文件下载服务 (port 3006)
├── prisma/                       # 数据库 Schema
│   ├── schema.prisma             # SQLite Schema（默认）
│   ├── schema.mysql.prisma       # MySQL Schema
│   └── schema.postgresql.prisma  # PostgreSQL Schema
├── scripts/                      # 工具脚本
│   ├── seed-threat-intel.ts      # 威胁情报种子数据
│   ├── fix-db.ts                 # 数据库修复
│   └── check-db.ts               # 数据库检查
├── config/                       # 运行时配置目录（自动生成）
├── db/                           # SQLite 数据库目录
├── public/                       # 静态资源
└── examples/                     # 示例代码
```

### 根目录文件说明

| 文件 | 用途 |
|------|------|
| `package.json` | 项目配置、依赖管理、NPM脚本 |
| `bun.lock` | Bun 依赖版本锁定 |
| `start.sh` | 一键启动脚本（安装依赖→初始化数据库→启动服务） |
| `config.yaml` | 应用配置（数据库类型/扫描参数/威胁情报API） |
| `.env` | 环境变量（DATABASE_URL） |
| `next.config.ts` | Next.js 框架配置 |
| `tsconfig.json` | TypeScript 编译配置 |
| `tailwind.config.ts` | Tailwind CSS 配置 |
| `postcss.config.mjs` | PostCSS 配置（Tailwind 依赖） |
| `Dockerfile` | Docker 多阶段构建文件 |
| `docker-compose.yml` | Docker Compose 编排文件 |
| `docker-entrypoint.sh` | Docker 容器启动入口 |
| `README.md` | 项目文档 |
| `.gitignore` | Git 忽略规则 |
| `.dockerignore` | Docker 构建忽略规则 |

### 系统架构图

```
浏览器 (React + Zustand + Tailwind CSS)
        │ HTTP / Socket.IO (polling via API proxy)
        ▼
┌───────────────────────────────────────────┐
│           Next.js 16 主应用 (端口 3000)     │
│     App Router + Prisma/SQLite + shadcn/ui │
│     API Route 代理内部 Socket.IO 服务       │
└──────┬──────────────────────────┬──────────┘
       │ (内部通信)                │ (内部通信)
       ▼                          ▼
┌──────────────┐          ┌──────────────────┐
│  扫描引擎     │          │  数据同步服务      │
│  (内部 3003)  │          │  (内部 3004)      │
│  Socket.IO   │          │  Socket.IO        │
│  HTML 解析    │          │  情报源抓取        │
│  QR 码检测    │          │  数据变更推送      │
└──────────────┘          └──────────────────┘

  ★ Docker 只需暴露 3000 端口，Socket.IO 通过 API 路由代理
```

---

## 快速开始

### 前提条件

- [Bun](https://bun.sh/) >= 1.0
- curl

### 一键启动

```bash
# 克隆项目
git clone <repository-url>
cd darklink-detector

# 一键启动（自动安装依赖 → 初始化数据库 → 启动所有服务）
bash start.sh
```

启动后访问 `http://localhost:3000`。

**默认登录信息：**
- 用户名：`admin`
- 密码：`admin123`
- ⚠️ 首次登录后请立即修改密码！

`start.sh` 脚本执行流程：

1. **安装依赖** — 主项目及各 mini-service 的 `bun install`
2. **初始化数据库** — 执行 `bun run db:push` 推送 Schema
3. **启动微服务** — 后台启动扫描引擎（3003）、数据同步服务（3004）、下载服务（3006）
4. **启动主应用** — 启动 Next.js 开发服务器（3000）

### 手动分步启动

```bash
# 1. 安装依赖
bun install
cd mini-services/scan-engine && bun install && cd ../..
cd mini-services/data-sync-service && bun install && cd ../..
cd mini-services/download-server && bun install && cd ../..

# 2. 初始化数据库
bun run db:push

# 3. 启动扫描引擎（终端 1）
cd mini-services/scan-engine && bun --hot index.ts

# 4. 启动数据同步服务（终端 2）
cd mini-services/data-sync-service && bun --hot index.ts

# 5. 启动主应用（终端 3）
bun run dev
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `bash start.sh` | 一键启动所有服务 |
| `bun run setup` | 安装依赖 + 初始化数据库 |
| `bun run dev` | 启动 Next.js 开发服务器（端口 3000） |
| `bun run lint` | 运行 ESLint 检查代码 |
| `bun run db:push` | 推送数据库 Schema |
| `bun run build` | 生产构建 |

---

## Docker 部署

适合生产环境，一键部署，数据持久化。

**前提条件：** 安装 [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/)

### 快速部署

```bash
# 克隆项目
git clone <repository-url>
cd darklink-detector

# 一键构建并启动
docker compose up -d

# 查看启动日志
docker compose logs -f
```

启动后访问 `http://localhost:3000`，默认账号 `admin` / `admin123`。

### Docker 架构

```
┌──────────────────────────────────────────────┐
│              Docker 容器                      │
│             只暴露端口 3000                    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  Next.js 主应用 (:3000)              │    │
│  │  ├─ UI + API 路由                    │    │
│  │  └─ API Route 代理内部 Socket.IO     │    │
│  │     /api/socket-proxy/scan-engine/*  │    │
│  │     /api/socket-proxy/data-sync/*    │    │
│  └────────────┬────────────┬─────────────┘    │
│               │            │                   │
│  ┌────────────▼──┐  ┌──────▼──────────────┐   │
│  │ Scan Engine   │  │ Data Sync Service   │   │
│  │ (内部 :3003)  │  │ (内部 :3004)        │   │
│  └───────────────┘  └─────────────────────┘   │
│                                              │
│  Volume: /app/db     ← 数据库持久化           │
│  Volume: /app/config ← 配置持久化             │
│  ←── docker-entrypoint.sh 自动初始化+启动     │
└──────────────────────────────────────────────┘
```

| 特性 | 说明 |
|------|------|
| 镜像基础 | `oven/bun:1.2`（Bun 官方镜像） |
| 构建方式 | 三阶段：deps → builder → runner |
| 单端口 | 只暴露 3000，Socket.IO 通过 API 路由代理 |
| 持久化 | `db/` 和 `config/` 通过 Docker Volume 持久化 |
| 健康检查 | 每 30s 检查 `/api/health` |
| 自动初始化 | 首次启动自动创建数据库和管理员账户 |
| 优雅关闭 | 捕获 SIGTERM/SIGINT，通知子进程退出 |

### 常用操作

```bash
docker compose up -d           # 启动
docker compose logs -f         # 查看日志
docker compose restart         # 重启
docker compose down            # 停止
docker compose up -d --build   # 代码更新后重新构建
```

### 自定义配置

```yaml
# 修改 docker-compose.yml

# 1. 修改主应用对外端口
ports:
  - "8080:3000"    # 改为 8080 访问

# 2. 使用本地目录持久化（代替 Docker Volume）
volumes:
  - ./my-data/db:/app/db
  - ./my-data/config:/app/config
```

### 数据备份与恢复

```bash
# 备份 — 直接复制数据库
docker cp darklink-detector:/app/db/custom.db ./backup/

# 备份 — 导出 SQL
docker exec darklink-detector sqlite3 /app/db/custom.db .dump > backup.sql

# 恢复 — 将备份文件复制到 Volume
docker cp ./backup/custom.db darklink-detector:/app/db/custom.db
docker compose restart
```

---

## 检测能力

系统支持 **21 种暗链类型**的自动检测：

| 编号 | 暗链类型 | 检测原理 |
|------|---------|---------|
| 1 | `display:none` 隐藏 | CSS 属性使元素不可见但仍存在于 DOM |
| 2 | `visibility:hidden` 隐藏 | CSS 属性隐藏元素但保留布局空间 |
| 3 | `overflow:hidden` + 偏移定位 | 利用溢出裁剪 + 负坐标将链接移出可视区 |
| 4 | `font-size:0` 隐藏 | 将字体大小设为零使文字不可见 |
| 5 | `color` 与背景色相同 | 文字颜色与背景色一致，视觉上不可见 |
| 6 | `position:absolute` 负坐标 | 绝对定位到屏幕可视区域外 |
| 7 | `z-index` 负值 | 层叠顺序置于页面内容之下 |
| 8 | `opacity:0` 透明链接 | 透明度设为零，完全透明但可点击 |
| 9 | `clip` / `clip-path` 裁剪 | CSS 裁剪将元素可见区域设为零 |
| 10 | `text-indent` 负值 | 文本缩移至可视区域外 |
| 11 | `width/height:0` 隐藏 | 将元素尺寸收缩为零 |
| 12 | `iframe` 隐藏嵌入 | 利用不可见 iframe 加载恶意页面 |
| 13 | JavaScript 动态注入链接 | 通过 JS 脚本在运行时插入隐藏链接 |
| 14 | `document.write` 注入 | 使用 document.write 写入恶意内容 |
| 15 | 隐藏 `<marquee>` 标签 | 利用 marquee 的滚动特性隐藏链接 |
| 16 | 恶意关键词检测 | 检测赌博/色情/非法药品等敏感关键词 |
| 17 | QR 码暗链 | 解析页面中的二维码，检测可疑跳转 URL |
| 18 | 链接农场 | 检测大量异常外链指向可疑域名 |
| 19 | `<meta>` 刷新跳转 | 利用 meta refresh 实现隐蔽重定向 |
| 20 | `<script>` 重定向 | 通过 JS 脚本实现页面跳转 |
| 21 | 同域名隐藏子链 | 发现同域名下未被直接引用的隐藏子链 |

---

## 技术栈

| 技术 | 说明 |
|------|------|
| **Next.js 16** (App Router) | 前端框架 + API 路由 |
| **TypeScript 5** | 全栈类型安全 |
| **Tailwind CSS 4** + **shadcn/ui** | 样式系统 + 组件库 |
| **Prisma ORM** | 数据库 ORM（默认 SQLite，支持 MySQL / PostgreSQL） |
| **Socket.IO** | 实时通信（扫描进度、数据同步推送） |
| **Playwright** | 浏览器渲染引擎（JS 动态页面解析） |
| **Zustand** | 客户端状态管理 |
| **Cheerio** | HTML 解析（11 种提取方法，21 种检测规则） |
| **jsQR + Sharp** | QR 码检测与图像处理 |
| **RSA-OAEP + bcrypt** | 加密传输 + 密码哈希 |
| **Bun** | JavaScript 运行时 |

---

## 安全设计

### 强制加密传输

所有涉及密码的操作均强制 RSA-OAEP 加密，**不允许明文传输**：

- **登录** — 密码经 RSA 公钥加密后传输，服务端私钥解密
- **修改密码** — 旧密码和新密码均加密传输
- **修改用户名** — 确认密码加密传输
- **加密失败** — 自动清除缓存重试一次，仍失败则拒绝操作
- **服务端校验** — `encrypted: false` 的请求直接返回 400 错误

### 认证体系

- **bcrypt(cost=12)** 密码哈希存储，支持 SHA256 旧格式自动升级
- **Token 会话** — 30 天最大有效期 + 7 天空闲超时（滑动窗口）
- **会话持久化** — `config/sessions.json`，重启不丢失
- **登录限速** — 15 分钟内最多 10 次
- **密码强度** — 至少 6 位，必须包含字母和数字

### 忘记密码

1. 停止应用（Docker: `docker compose down`）
2. 删除 `config/auth.json`（Docker: `docker exec darklink-detector rm /app/config/auth.json`）
3. 重启应用，密码恢复为 `admin123`
4. 登录后立即修改密码

---

## 威胁情报源

| 情报源 | 类型 | 需 API Key |
|--------|------|-----------|
| OpenPhish | 域名 + IP | 否 |
| URLhaus (text + CSV + Live API) | 域名 + IP | 否 |
| ThreatFox | 域名 + IP | 否 |
| Blocklist.de | IP | 否 |
| CINS Army | IP | 否 |
| Spamhaus DROP/EDROP | IP | 否 |
| AlienVault OTX | 域名 + IP + URL | 可选 |
| PhishTank | 域名 + IP | 否 |
| SSL Blacklist | JA3 指纹 | 否 |
| Ransomware Tracker | 域名 + IP | 否 |

---

## 更新日志

完整版本更新记录请查看 [CHANGELOG.md](./CHANGELOG.md)

### 最近更新 (v1.8.1)

- **审计日志关联性修复** — 为日志条目新增 `entityType`/`entityId`/`metadata` 字段，支持与扫描任务、情报源等实体的结构化关联
- **日志详情展开** — 审计日志面板支持展开查看结构化元数据，实体类型显示中文标签
- **下载包修复** — 项目打包文件移至 `public/` 目录，支持直接下载

---

## 许可证

本项目为私有项目，未经授权不得使用、复制或分发。

© 2026 DarkLink Detector（暗链检测系统）All Rights Reserved
