# Changelog

All notable changes to DarkLink Detector will be documented in this file.

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
