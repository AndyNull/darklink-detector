import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { resolve } from "path";

// Read version from package.json — single source of truth
let appVersion = "0.0.0";
try {
  const pkgPath = resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  appVersion = pkg.version || "0.0.0";
} catch {}

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // 不自动重定向去掉尾斜杠，避免干扰代理路径
  skipTrailingSlashRedirect: true,
  // 允许 Docker 部署时的外部访问
  allowedDevOrigins: [
    '.space-z.ai',
    '.localhost',
    '.local',
    'localhost',
  ],
  // 服务端专用包，不打包进客户端bundle
  serverExternalPackages: ['sharp', 'cheerio', 'jsqr', 'playwright', 'playwright-core'],
  // 将 package.json 版本号注入到客户端构建中
  // 这样 version.ts 可以在客户端和服务端使用同一个版本号
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
};

export default nextConfig;
