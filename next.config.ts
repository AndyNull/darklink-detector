import type { NextConfig } from "next";

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
};

export default nextConfig;
