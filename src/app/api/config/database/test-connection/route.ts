import { NextRequest, NextResponse } from 'next/server';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { requireSessionAuth } from '@/lib/api-auth';
import { rsaDecrypt, DatabaseConfig } from '@/lib/server-config';
import { validateResolvedIP } from '@/lib/security';

/**
 * Test TCP connectivity to a given host:port within a timeout.
 * Returns true if the connection succeeds, false otherwise.
 */
function testTcpConnection(host: string, port: number, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Attempt to decrypt an RSA-encrypted password.
 * If decryption fails (e.g. plaintext), return the original value.
 */
function tryDecryptPassword(password: string): string {
  if (!password) return '';
  // Try RSA decryption — if it looks like base64 and decryption succeeds, use it
  const decrypted = rsaDecrypt(password);
  return decrypted ?? password;
}

/**
 * POST /api/config/database/test-connection
 *
 * Accepts a DatabaseConfig in the body and tests the connection.
 * - SQLite: checks if the file path is writable/accessible
 * - MySQL: tests TCP connectivity to host:port
 * - PostgreSQL: tests TCP connectivity to host:port
 *
 * Passwords may be RSA-encrypted; they will be decrypted server-side.
 */
export async function POST(request: NextRequest) {
  // Require authentication
  const sessionError = requireSessionAuth(request);
  if (sessionError) return sessionError;

  try {
    const body = await request.json();
    const config = body.config as DatabaseConfig;

    if (!config || !config.type) {
      return NextResponse.json(
        { success: false, message: '配置无效: 数据库类型为必填项' },
        { status: 400 }
      );
    }

    if (config.type === 'sqlite') {
      return await testSqlite(config);
    } else if (config.type === 'mysql') {
      return await testMysql(config);
    } else if (config.type === 'postgresql') {
      return await testPostgresql(config);
    } else {
      return NextResponse.json(
        { success: false, message: `不支持的数据库类型: ${config.type}` },
        { status: 400 }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      { success: false, message: `连接测试失败: ${message}` },
      { status: 500 }
    );
  }
}

async function testSqlite(config: DatabaseConfig): Promise<NextResponse> {
  const dbPath = config.sqlite?.path;
  if (!dbPath || dbPath.trim().length === 0) {
    return NextResponse.json({
      success: false,
      message: 'SQLite 文件路径不能为空',
    });
  }

  try {
    const resolvedPath = path.resolve(dbPath);
    const dir = path.dirname(resolvedPath);

    // Check if the directory exists and is writable
    if (fs.existsSync(resolvedPath)) {
      // File exists — check if it's readable
      try {
        fs.accessSync(resolvedPath, fs.constants.R_OK | fs.constants.W_OK);
        const stats = fs.statSync(resolvedPath);
        const sizeKB = (stats.size / 1024).toFixed(1);
        return NextResponse.json({
          success: true,
          message: `SQLite 连接成功 — 文件可读写 (${sizeKB} KB)`,
          details: {
            '文件路径': resolvedPath,
            '文件大小': `${sizeKB} KB`,
          },
        });
      } catch {
        return NextResponse.json({
          success: false,
          message: `SQLite 连接失败 — 文件存在但无读写权限`,
          details: { '文件路径': resolvedPath },
        });
      }
    } else {
      // File doesn't exist — check if the directory is writable so we can create it
      try {
        if (!fs.existsSync(dir)) {
          // Try to create the directory
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.accessSync(dir, fs.constants.W_OK);
        return NextResponse.json({
          success: true,
          message: 'SQLite 连接成功 — 目录可写，数据库文件将在首次使用时创建',
          details: {
            '文件路径': resolvedPath,
            '目录': dir,
          },
        });
      } catch {
        return NextResponse.json({
          success: false,
          message: `SQLite 连接失败 — 目录不可写: ${dir}`,
          details: { '目录': dir },
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({
      success: false,
      message: `SQLite 连接失败: ${message}`,
    });
  }
}

async function testMysql(config: DatabaseConfig): Promise<NextResponse> {
  const host = config.mysql?.host;
  const port = config.mysql?.port;
  const database = config.mysql?.database;
  const username = config.mysql?.username;
  const encryptedPassword = config.mysql?.password ?? '';

  if (!host || !port || !database || !username) {
    return NextResponse.json({
      success: false,
      message: 'MySQL 配置不完整，请填写所有必填字段',
    });
  }

  // Private IP filter: prevent connections to internal network addresses
  try {
    const { lookup } = await import('dns');
    const resolvedIp = await new Promise<string>((resolve, reject) => {
      lookup(host, (err, address) => {
        if (err) reject(err);
        else resolve(address);
      });
    });
    if (!validateResolvedIP(resolvedIp)) {
      return NextResponse.json({
        error: '不允许连接到内网地址',
        success: false,
      }, { status: 400 });
    }
  } catch (dnsErr: any) {
    // DNS lookup failed - let it proceed and the connection will fail naturally
  }

  // Decrypt password if RSA-encrypted
  const password = tryDecryptPassword(encryptedPassword);

  // Test TCP connectivity
  const reachable = await testTcpConnection(host, port, 5000);

  if (!reachable) {
    return NextResponse.json({
      success: false,
      message: `MySQL 连接失败 — 无法连接到 ${host}:${port}`,
      details: {
        '主机地址': host,
        '端口': String(port),
        '数据库名': database,
        '用户名': username,
      },
    });
  }

  return NextResponse.json({
    success: true,
    message: `MySQL 连接成功 — ${host}:${port} 可达`,
    details: {
      '主机地址': host,
      '端口': String(port),
      '数据库名': database,
      '用户名': username,
      '密码': password ? '已提供' : '未提供',
    },
  });
}

async function testPostgresql(config: DatabaseConfig): Promise<NextResponse> {
  const host = config.postgresql?.host;
  const port = config.postgresql?.port;
  const database = config.postgresql?.database;
  const username = config.postgresql?.username;
  const ssl = config.postgresql?.ssl ?? false;
  const encryptedPassword = config.postgresql?.password ?? '';

  if (!host || !port || !database || !username) {
    return NextResponse.json({
      success: false,
      message: 'PostgreSQL 配置不完整，请填写所有必填字段',
    });
  }

  // Private IP filter: prevent connections to internal network addresses
  try {
    const { lookup } = await import('dns');
    const resolvedIp = await new Promise<string>((resolve, reject) => {
      lookup(host, (err, address) => {
        if (err) reject(err);
        else resolve(address);
      });
    });
    if (!validateResolvedIP(resolvedIp)) {
      return NextResponse.json({
        error: '不允许连接到内网地址',
        success: false,
      }, { status: 400 });
    }
  } catch (dnsErr: any) {
    // DNS lookup failed - let it proceed and the connection will fail naturally
  }

  // Decrypt password if RSA-encrypted
  const password = tryDecryptPassword(encryptedPassword);

  // Test TCP connectivity
  const reachable = await testTcpConnection(host, port, 5000);

  if (!reachable) {
    return NextResponse.json({
      success: false,
      message: `PostgreSQL 连接失败 — 无法连接到 ${host}:${port}`,
      details: {
        '主机地址': host,
        '端口': String(port),
        '数据库名': database,
        '用户名': username,
        'SSL': ssl ? '已启用' : '已关闭',
      },
    });
  }

  return NextResponse.json({
    success: true,
    message: `PostgreSQL 连接成功 — ${host}:${port} 可达`,
    details: {
      '主机地址': host,
      '端口': String(port),
      '数据库名': database,
      '用户名': username,
      'SSL': ssl ? '已启用' : '已关闭',
      '密码': password ? '已提供' : '未提供',
    },
  });
}
