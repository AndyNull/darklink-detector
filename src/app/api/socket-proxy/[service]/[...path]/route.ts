/**
 * Socket.io 统一代理 — 扫描引擎 & 数据同步服务
 *
 * 将 /api/socket-proxy/scan-engine/* 代理到 localhost:3003/*
 * 将 /api/socket-proxy/data-sync/*   代理到 localhost:3004/*
 *
 * 用于通过 Next.js API 路由代理 Socket.io 的 polling 请求，
 * 这样 Docker 只需暴露 3000 端口。
 */

import { NextRequest, NextResponse } from 'next/server';

// 服务端口映射
const SERVICE_PORTS: Record<string, number> = {
  'scan-engine': parseInt(process.env.SCAN_ENGINE_PORT || '3003', 10),
  'data-sync': parseInt(process.env.DATA_SYNC_PORT || '3004', 10),
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Socket.io long-polling 可能需要较长时间
export const maxDuration = 60;

async function proxyRequest(req: NextRequest, method: string) {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);

    // /api/socket-proxy/{service}/{path...}
    // segments: ['api', 'socket-proxy', service, ...path]
    const service = segments[2]; // 'scan-engine' or 'data-sync'
    const port = SERVICE_PORTS[service];

    if (!port) {
      return NextResponse.json(
        { error: `Unknown service: ${service}` },
        { status: 404 }
      );
    }

    // 构建后端路径：去掉 /api/socket-proxy/{service} 前缀
    const prefix = `/api/socket-proxy/${service}`;
    const originalPath = url.pathname;
    const backendPath = originalPath.slice(prefix.length) || '/';
    const backendUrl = `http://localhost:${port}${backendPath}${url.search}`;

    console.log(`[SocketProxy] ${method} ${originalPath} → ${backendUrl}`);

    // 构建请求头（过滤掉不需要的头）
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        !lower.startsWith('x-middleware-') &&
        !lower.startsWith('x-next') &&
        lower !== 'host' &&
        lower !== 'connection'
      ) {
        headers[key] = value;
      }
    });
    headers['host'] = `localhost:${port}`;
    headers['connection'] = 'close';

    const fetchOptions: RequestInit = {
      method,
      headers,
      redirect: 'manual',
    };

    if (method === 'POST' && req.body) {
      fetchOptions.body = await req.arrayBuffer();
    }

    const backendRes = await fetch(backendUrl, fetchOptions);

    // 构建响应头
    const responseHeaders = new Headers();
    backendRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // 过滤掉可能导致问题的头
      if (
        lower !== 'transfer-encoding' &&
        lower !== 'content-encoding' &&
        lower !== 'connection'
      ) {
        responseHeaders.set(key, value);
      }
    });

    // 读取响应体并返回（避免流式传输可能导致的问题）
    const body = await backendRes.text();

    return new Response(body, {
      status: backendRes.status,
      statusText: backendRes.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error('[SocketProxy] Proxy error:', err.message);
    return NextResponse.json(
      { error: 'Backend service unavailable' },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  return proxyRequest(req, 'GET');
}

export async function POST(req: NextRequest) {
  return proxyRequest(req, 'POST');
}

export async function OPTIONS(req: NextRequest) {
  return proxyRequest(req, 'OPTIONS');
}
