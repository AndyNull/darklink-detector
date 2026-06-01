# Changelog

All notable changes to DarkLink Detector will be documented in this file.

---

## [v1.13.0] - 2026-06-01

### Security

- **SSRF 重定向绕过修复** — HTTP 重定向到私有 IP 可绕过 DNS Rebinding 检查，现在对重定向目标的 IP 地址直接校验（S1）
- **错误信息脱敏** — `/api/scan/route.ts` 不再向客户端暴露 `(err as Error).message`，统一使用 `safeErrorResponse()`（C1）
- **HTML 大小限制** — 新增 `MAX_HTML_SIZE = 2MB`，防止超大页面耗尽内存（S2）
- **CORS 可配置** — Mini-services 的 `ALLOWED_ORIGINS` 改为从 `CORS_ORIGINS` 环境变量读取，不再硬编码 localhost（C2）
- **WebSocket 输入校验** — `scan:start` 事件新增 `concurrency`/`timeout` 参数范围校验，防止资源耗尽（A4）

### Fixed

- **SQLite 并发写入** — 添加 `busy_timeout=5000` + `connection_limit=1`，启用 WAL 模式，解决 SQLITE_BUSY 错误（D2）
- **并发扫描竞态** — 新增 `isAnyTaskRunning()` 守卫，防止重复点击"开始扫描"触发多个并发扫描（A1）
- **ErrorBoundary 日志** — 添加 `componentDidCatch` 和 `resetKey` 强制重挂载，修复静默吞错误和状态残留（F1）
- **Socket 断线重连** — 服务端断开后不再被动等待，2 秒后主动重连（F2）
- **轮询定时器泄漏** — `pollScanUntilComplete` 的 `stop()` 现在正确清除 `setTimeout`（F3）
- **parallelWithLimit 并发 bug** — 修复 `Promise.race` 始终返回 `false` 的竞态条件，改用 `Set<Promise>` + `.finally()` 自移除（m8）
- **导入路由性能** — 10 个顺序 `upsert` 改为批量 `createMany`（每批 500 条），大幅提升导入速度（m3）
- **错误响应格式统一** — `sync-tasks` 路由 3 处泄露 `err.message` 的错误处理改为统一中文脱敏消息（m1）
- **自动启动崩溃循环** — 引擎自动启动添加重试上限（3 次）和冷却时间（60s），防止崩溃风暴
- **Playwright 缺失错误** — `chromium.launch()` 捕获异常，给出友好提示而非崩溃
- **扫描无限挂起** — 新增 10 分钟最大扫描时长保护，超时自动终止
- **SQLite 路径安全** — `buildDatabaseUrl()` 新增路径遍历防护和自动创建目录
- **DNS 超时** — 新增 5 秒 DNS 查询超时，防止扫描挂起在无响应的 DNS 服务器（S3）
- **Prisma 连接关闭** — 添加 `SIGTERM`/`SIGINT` 信号处理，优雅关闭数据库连接（D3）

### Added

- **健康检查版本号** — `/api/health` 返回 `version` 字段
- **扫描 API 错误码** — 新增 6 个标准错误码：`SCAN_RATE_LIMITED`/`SCAN_MISSING_PARAMS`/`SCAN_INVALID_URLS`/`SCAN_ALREADY_RUNNING`/`SCAN_MISSING_TASK_ID`/`SCAN_UNKNOWN_ACTION`
- **启动健康恢复** — 服务器重启后自动将残留 `running` 任务标记为 `error`
- **WebSocket 心跳** — 客户端 25 秒 ping 间隔 + 10 秒超时，服务端 pong 响应
- **URL 输入净化** — 新增 `sanitizeScanUrl()`：去空白、去控制字符、Unicode NFC 规范化、去追踪参数
- **版本单一来源** — 版本号统一从 `package.json` 读取，`version.ts`/`config.ts` 不再硬编码

### Changed

- **Mini-service SSRF 防护** — scan-engine REST 和 WebSocket 路由新增 `validateScanUrlConfigs()` 校验
- **Mini-service CORS 限制** — 从 `*` 改为白名单 `localhost:3000`，支持 `CORS_ORIGINS` 环境变量
- **扫描限速消息** — 从英文改为中文 `'扫描请求过于频繁，请稍后再试'`
- **自动启动冷却** — 从 30 秒延长到 60 秒，添加 3 次重试上限

---

## [v1.12.0] - 2026-06-01

### Security

- **XSS 修复** — HTML 预览使用 React JSX 替代 `dangerouslySetInnerHTML`
- **CRLF 注入修复** — `fetchWithCurl` 请求头添加 CR/LF 清理
- **速率限制器内存修复** — 最大条目数限制为 10K，优先使用 `x-real-ip`
- **localhost 子域名 SSRF** — 阻止 `*.localhost` 子域名绕过 SSRF 防护
- **重定向 DNS 校验** — `browser-sim.ts` 重定向目标新增 DNS 解析校验

### Performance

- **图片 URL 去重** — O(n²) → O(n)，改用 Set 数据结构
- **隐藏文本检测** — `$('*').each()` → `$('[style]').each()`，减少无样式元素遍历
- **正则编译优化** — 正则常量提升到模块级别，避免重复编译
- **DNS 缓存 LRU** — 最大 1000 条目限制，防止内存膨胀
- **暗链面板预计算** — `useMemo` 预计算 hostnames，减少重复计算
- **暗链过滤记忆化** — `getFilteredDarkLinks` 添加 Zustand 记忆化选择器

### Accuracy

- **CSS 隐藏检测扩展** — 新增 7 种隐藏技术：`visibility:hidden`、`opacity:0`、`text-indent:-9999px`、离屏定位、`clip-path`、`transform:scale(0)`、`max-height:0+overflow:hidden`
- **iframe 检测扩展** — 新增 5 种技术：clip、offscreen、sandbox、aria-hidden
- **混淆 JS 检测扩展** — 新增 8 种模式：setTimeout/setInterval 字符串、new Function、document.write、hex/unicode 转义、parseInt hex、atob
- **独立规则类型** — `link_farm` 和 `mixed_content` 从错误分类中拆分为独立规则类型
- **nofollow 上下文门控** — 低严重度无指标时不标记
- **上下文关键词检测** — 模糊关键词仅在伴随可疑指标时标记

### Quality

- **空 catch 块** — 28+ 处空 catch 块改为正确错误日志
- **无障碍标签** — 25+ 个仅图标按钮添加 `aria-label`
- **QR 码阈值调整** — 怀疑阈值从 300 调整到 500 字符 + 上下文检查
- **URL 缩短服务去重** — qr-detector.ts 去除重复缩短服务条目
- **数据库索引** — ScanResult/DarkLink/SyncTask/MaliciousDomain/IP 添加 `@@index`
- **Mini-service 同步** — 修正 CHEAP_TLDS 偏移，补充 UI 类型标签映射，添加 10 个新检测规则到设置
- **配置校验** — 新增 `validateConfig()` 范围检查和 `getScanConfigMs()` 毫秒转换
- **ErrorBoundary 组件** — 扫描结果面板添加错误边界组件
- **tsconfig 排除** — 排除 `skills/` 目录修复构建错误

---

## [v1.11.0] - 2026-05-31

### Added

- **DNS 缓存** — 新增内存 DNS 缓存（60s TTL），减少批量扫描重复解析延迟
- **关键词精度优化** — 移除 17 个过于宽泛的独立检测关键词，新增上下文感知规则（10a-ctx），模糊关键词仅在伴随可疑指标时标记
- **健康检查增强** — `/api/health` 新增数据库连接检查和 mini-service 健康监控（扫描引擎 3003、数据同步 3004）
- **Docker Playwright** — Dockerfile runner 阶段添加 `bunx playwright install --with-deps chromium`

### Changed

- **HTML 预览权限** — `/api/scan/html` 移除 `requireSessionAuth`，查看扫描结果改为公开访问（与 `/api/scan` GET 一致）
- **Docker 入口点** — 替换 `sleep 2` 为健康检查循环，添加服务监控/重启和启动验证
- **Dockerfile** — 复制 `bun.lock` 确保可复现构建
- **Mini-service 进度同步** — types.ts 补全缺失字段（currentUrlStartTime/avgTimePerUrl/estimatedTimeRemaining/darkLinksFound）
- **扫描引擎进度** — 同步新增进度字段到 mini-service 发射

---

## [v1.10.0] - 2026-05-31

### Security

- **SSRF 修复** — 为所有 `fetchWithCurl` 调用点添加 DNS Rebinding 检查，堵住 curl 回退路径的 SSRF 漏洞
- **SQL 注入修复** — data-sync-service 的搜索参数改用参数化查询
- **认证补全** — socket-proxy 和 scan/stop 路由添加 `requireSessionAuth` 认证
- **SSRF 校验统一** — 统一扫描端点 POST start 添加 `validateScanUrls()` 校验
- **数据库连接测试** — 添加私有 IP 过滤，禁止连接内网地址
- **API Key 保护** — ThreatBook API Key 从 URL 查询参数迁移到请求头
- **错误信息脱敏** — 新增 `safeErrorResponse()` 工具函数，生产环境隐藏内部错误详情

### Fixed

- **页面源码预览** — 修复扫描结果 HTML 预览始终显示"无HTML内容"的 bug，新增 `/api/scan/html` 按需加载端点
- **扫描报告对话框** — 修复 `getScanDuration`/`maliciousMatches` 不存在的引用导致崩溃
- **浏览器渲染竞态** — `activePages` 计数器改用 Semaphore 信号量，消除并发竞态
- **扫描结果竞态** — `onResult`/`onLog` 回调改用不可变追加，消除数据丢失风险
- **`isZeroSize` 语义** — 拆分为 `isZeroSize`(仅0) + `isOnePixelSize`(仅1)，消除命名误导

### Added

- **共享常量模块** — 新增 `shared-constants.ts`，统一 TRUSTED_DOMAINS/URL_SHORTENERS/extractDomain/isValidDomain/isSuspiciousDomain
- **SQLite 索引** — 补全 ScanTask/ScanResult/UrlDetail/DarkLink/QrCodeResult/ScanLog 的所有 `@@index`
- **MySQL/PostgreSQL 模型** — 补全 7 个缺失模型（MaliciousDomain, MaliciousIP, UpdateSchedule, ThreatIntelSource, ThreatIntelEntry, ThreatIntelApiKey, SyncTask）
- **Mini 引擎同步** — IPv6 SSRF 防护、完整恶意关键词(150+)、URL缩短服务(70+)、可信域名(60+)
- **任务数据清理** — Mini scan-engine 添加 15 分钟定时清理过期任务数据
- **请求体大小限制** — Mini scan-engine `readBody()` 添加 1MB 默认上限

### Changed

- **Docker 优雅关闭** — `docker-entrypoint.sh` 不再使用 `exec`，确保 SIGTERM 信号正确传播
- **API 元数据** — 根路由 `/api/` 返回应用名称、版本、状态
- **健康检查** — `/api/health` 返回实际活跃任务数而非硬编码 0
- **data-sync-service** — 修复 ESM 环境下 `__dirname` 不可用问题，改用 `import.meta.dirname`

### Removed

- **settings-dialog.tsx** — 删除过时死代码（使用错误的 localStorage key 和 rule ID）
- **ignoreBuildErrors** — 移除 `next.config.ts` 中的 `ignoreBuildErrors: true`
- **未使用代码** — 清理 scan-engine.ts 中未使用的 `MAX_REDIRECTS`、`BrowserRenderResult`、`decodeDataUri`

---

## [v1.9.0] - 2026-05-31

### Added

- **开源许可证** — 采用 GNU AGPL-3.0 开源许可证，允许使用和分发，修改版必须开源
- **浏览器指纹池** — 新增 `BrowserFingerprint` 类型，包含 UA、Accept-Language、视口尺寸、平台、引擎类型，12 种真实指纹轮换
- **扫描线程指纹分配** — 每个 URL 扫描任务分配独立指纹（`getNextFingerprint()`），同一 URL 的所有请求（主请求/curl/外部资源/浏览器渲染）保持一致，模拟单一浏览器会话
- **资源请求指纹传递** — 新增 `getResourceHeaders()` 函数，外部资源（JS/CSS）请求使用与主页面一致的指纹
- **Playwright 指纹** — 浏览器渲染使用指纹中的 UA、视口和 Accept-Language

### Changed

- **UA 轮换机制** — 从 6 种 UA 扩展到 12 种指纹（含 Chrome/Firefox/Edge/Safari × Windows/macOS/Linux 组合），覆盖不同平台和屏幕分辨率
- **fetchWithCurl** — 新增 `userAgent` 参数，不再硬编码单一 UA
- **fetchExternalResource** — 新增 `fingerprint` 参数，不再硬编码请求头
- **qr-detector** — 图片下载请求使用轮换 UA，不再硬编码
- **sublinks/route.ts** — curl 和 fetch 请求均使用轮换 UA

### Removed

- **public/ 压缩包** — 项目打包不再放在 `public/` 目录，改用 GitHub Releases 分发

---

## [v1.8.1] - 2026-05-30

### Fixed

- **审计日志关联性** — `LogEntry` 新增 `entityType`、`entityId`、`metadata` 三个字段，支持日志与实体的结构化关联
- **日志详情序列化** — 修复 `details` 参数传入对象时序列化为 `[object Object]` 导致数据丢失的 bug，对象现在自动存入 `metadata` 并生成可读的 `details` 字符串
- **下载包位置** — 项目打包归档从 `download/` 移至 `public/` 目录，支持浏览器直接下载

### Added

- **实体关联** — 所有审计日志调用点新增实体关联：扫描任务(`scan_task`)、情报源(`threat_intel_source`)、数据库(`database`)
- **日志元数据展开** — 审计日志面板支持点击展开查看结构化元数据（key-value 展示）
- **实体类型中文标签** — 审计日志中实体类型显示为中文（如"扫描任务"、"情报源"等）
- **日志 API 实体过滤** — `/api/logs` 新增 `entityType` 和 `entityId` 查询参数

---

## [v1.8.0] - 2026-05-29

### Added

- **扫描结果子标签** — "全部"标签下新增"成功"和"失败"子筛选，支持按类别复制 URL 便于重新扫描
- **速率限制重试** — 子链扫描新增指数退避重试机制，检测 429/速率限制模式时使用 5s/10s 退避，普通错误 2s/4s 退避，最多 2 次重试
- **子链爬取节流** — 并发爬取之间新增 200ms 间隔，不同 URL 发现之间新增 500ms 间隔，避免突发流量

### Changed

- **复制按钮样式** — 复制 URL 按钮改为更小巧的样式（text-muted-foreground, font-normal）

---

## [v1.7.0] - 2026-05-28

### Added

- **按钮布局重组** — 扫描控制区按钮重新组织，提升操作效率
- **全局弹出层优化** — 优化所有 Popover/Dialog 组件的交互体验

---

## [v1.6.0] - 2026-05-26

### Added

- **深度子链挖掘** — 替换简单正则为完整 Cheerio HTML 解析器（11 种提取方法，25+ 标签/属性对），显著提升子链发现能力
- **DNS Rebinding 防护** — 为 mini-services 扫描引擎的外部资源请求添加 DNS rebinding SSRF 缓解措施
- **可信域名同步** — 在嵌入式和独立扫描引擎之间同步可信 CDN/服务域名白名单
- **HTML 缓存统一** — 统一 MAX_HTML_CACHE_SIZE 为 200KB
- **子链发现重试** — 失败的子链发现新增重试机制（1 次重试，1s 延迟）
- **ETA 预估** — 子链发现和扫描阶段新增剩余时间预估显示
- **改进日志** — 更好的子链发现完成日志，显示新增与已有 URL 数量

---

## [v1.5.0] - 2026-05-25

### Added

- **威胁情报集成** — 集成 10 个威胁情报源（OpenPhish、URLhaus、ThreatFox、Blocklist.de 等）
- **数据同步服务** — 独立微服务实现威胁情报定时同步（port 3004）
- **情报源管理** — 支持启用/禁用情报源、API Key 配置
- **恶意库管理** — 恶意域名/IP 的增删改查、批量导入导出

### Changed

- **扫描结果联动** — 扫描结果与威胁情报库联动，自动标注已知恶意链接

---

## [v1.4.0] - 2026-05-24

### Added

- **QR 码暗链检测** — 集成 jsQR + Sharp，自动解析页面中的二维码并检测可疑跳转
- **审计日志系统** — 文件化审计日志（4 类：认证/任务/系统/数据），支持搜索、日期筛选、分页
- **RSA 加密传输** — 所有密码操作强制 RSA-OAEP 加密，不允许明文传输

---

## [v1.3.0] - 2026-05-25

### Added

- **Docker 部署** — 新增 Dockerfile、docker-compose.yml、docker-entrypoint.sh
- **多数据库支持** — Prisma Schema 支持 SQLite（默认）、MySQL、PostgreSQL
- **数据库配置界面** — 设置面板新增数据库配置、迁移、导入导出功能
- **一键启动脚本** — `start.sh` 自动安装依赖→初始化数据库→启动服务

---

## [v1.2.0] - 2026-05-22

### Added

- **Socket.IO 实时通信** — 扫描进度实时推送，数据同步实时通知
- **扫描引擎微服务** — 独立扫描引擎服务（port 3003），通过 API 路由代理
- **Playwright 浏览器渲染** — 支持 JS 动态页面渲染解析

---

## [v1.1.0] - 2026-05-20

### Added

- **扫描结果面板** — 暗链结果、QR码结果、失败链接分类展示
- **设置面板** — 系统设置、引擎管理、检测规则配置
- **认证系统** — 登录/登出/修改密码/修改用户名，bcrypt 哈希 + Token 会话

---

## [v1.0.0] - 2026-05-18

### Added

- **核心扫描功能** — 21 种暗链类型自动检测
- **HTML 解析引擎** — 基于 Cheerio 的深度 HTML 解析，11 种提取方法
- **URL 批量扫描** — 支持多 URL 并发扫描，可配置并发数和超时
- **Next.js 框架搭建** — App Router + Prisma/SQLite + shadcn/ui + Tailwind CSS
- **基础 UI** — 扫描界面、URL 输入、结果展示、日志面板
