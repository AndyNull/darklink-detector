/**
 * Configuration loader for DarkLink Detector
 * Supports SQLite, MySQL, and PostgreSQL
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ─── Config Types ────────────────────────────────────────────────────────────

export interface DatabaseConfig {
  type: 'sqlite' | 'mysql' | 'postgresql';
  sqlite: {
    path: string;
  };
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    poolSize: number;
  };
  postgresql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    poolSize: number;
    ssl: 'disable' | 'require' | 'verify-ca' | 'verify-full';
  };
}

export interface ScanConfig {
  defaultConcurrency: number;
  defaultTimeout: number;
  maxExternalJs: number;
  maxExternalCss: number;
  taskRetentionHours: number;
}

export interface AppConfig {
  title: string;
  version: string;
  description: string;
}

export interface ThreatIntelProviderConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
}

export interface ThreatIntelConfig {
  enabled: boolean;
  threatbook: ThreatIntelProviderConfig;
  virustotal: ThreatIntelProviderConfig;
  urlhaus: ThreatIntelProviderConfig;
}

export interface AppConfigFile {
  database: DatabaseConfig;
  scan: ScanConfig;
  app: AppConfig;
  threatIntel: ThreatIntelConfig;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AppConfigFile = {
  database: {
    type: 'sqlite',
    sqlite: {
      path: './db/custom.db',
    },
    mysql: {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'darklink_detector',
      poolSize: 10,
    },
    postgresql: {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: '',
      database: 'darklink_detector',
      poolSize: 10,
      ssl: 'disable',
    },
  },
  scan: {
    defaultConcurrency: 10,
    defaultTimeout: 3,
    maxExternalJs: 15,
    maxExternalCss: 15,
    taskRetentionHours: 24,
  },
  app: {
    title: 'DarkLink Detector',
    version: '1.10.0',
    description: '网页暗链检测工具',
  },
  threatIntel: {
    enabled: true,
    threatbook: {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://api.threatbook.cn/v3',
    },
    virustotal: {
      enabled: false,
      apiKey: '',
    },
    urlhaus: {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://urlhaus-api.abuse.ch/v1',
    },
  },
};

// ─── Config Loader ───────────────────────────────────────────────────────────

let _cachedConfig: AppConfigFile | null = null;

function parseYamlSimple(content: string): Record<string, any> {
  // A very simple YAML parser for our flat config structure
  const result: Record<string, any> = {};
  const lines = content.split('\n');
  const stack: Array<{ obj: Record<string, any>; indent: number }> = [{ obj: result, indent: -1 }];

  for (const line of lines) {
    // Skip empty lines and comments
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.trimStart().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const stripped = trimmed.trimStart();

    // Pop stack to find the right parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    // Check if it's a key with a value
    const colonIdx = stripped.indexOf(':');
    if (colonIdx === -1) continue;

    const key = stripped.substring(0, colonIdx).trim();
    const value = stripped.substring(colonIdx + 1).trim();

    if (value === '' || value === undefined) {
      // This is a nested object
      parent[key] = {};
      stack.push({ obj: parent[key] as Record<string, any>, indent });
    } else {
      // Parse the value
      parent[key] = parseValue(value);
    }
  }

  return result;
}

function parseValue(value: string): any {
  // Remove quotes if present
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  return value;
}

function deepMerge<T extends Record<string, any>>(target: T, source: Record<string, any>): T {
  const result: Record<string, any> = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result as T;
}

export function loadConfig(): AppConfigFile {
  if (_cachedConfig) return _cachedConfig;

  const configPath = resolve(process.cwd(), 'config.yaml');

  if (!existsSync(configPath)) {
    _cachedConfig = DEFAULT_CONFIG;
    return _cachedConfig;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = parseYamlSimple(content);
    _cachedConfig = deepMerge(DEFAULT_CONFIG, parsed);
    return _cachedConfig!;
  } catch (err) {
    console.warn('Failed to load config.yaml, using defaults:', err);
    _cachedConfig = DEFAULT_CONFIG;
    return _cachedConfig;
  }
}

export function getConfig(): AppConfigFile {
  return loadConfig();
}

export function getDatabaseConfig(): DatabaseConfig {
  return loadConfig().database;
}

export function getScanConfig(): ScanConfig {
  return loadConfig().scan;
}

export function getAppConfig(): AppConfig {
  return loadConfig().app;
}

export function getThreatIntelConfig(): ThreatIntelConfig {
  return loadConfig().threatIntel;
}

// ─── Database URL Builder ────────────────────────────────────────────────────

export function buildDatabaseUrl(config?: DatabaseConfig): string {
  const dbConfig = config || getDatabaseConfig();

  switch (dbConfig.type) {
    case 'sqlite': {
      const path = resolve(process.cwd(), dbConfig.sqlite.path);
      return `file:${path}`;
    }

    case 'mysql': {
      const { host, port, user, password, database } = dbConfig.mysql;
      return `mysql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
    }

    case 'postgresql': {
      const { host, port, user, password, database, ssl } = dbConfig.postgresql;
      const sslParam = ssl !== 'disable' ? `?sslmode=${ssl}` : '';
      return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}${sslParam}`;
    }

    default:
      throw new Error(`Unsupported database type: ${dbConfig.type}`);
  }
}

// ─── Prisma Provider Mapping ─────────────────────────────────────────────────

export function getPrismaProvider(dbType: string): string {
  switch (dbType) {
    case 'sqlite': return 'sqlite';
    case 'mysql': return 'mysql';
    case 'postgresql': return 'postgresql';
    default: throw new Error(`Unsupported database type: ${dbType}`);
  }
}

// ─── Runtime Config API ──────────────────────────────────────────────────────

/**
 * Get the current effective DATABASE_URL
 * Priority: 1. Environment variable DATABASE_URL  2. config.yaml
 */
export function getEffectiveDatabaseUrl(): string {
  // If DATABASE_URL is explicitly set in env, use it
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  // Otherwise, build from config
  return buildDatabaseUrl();
}

/**
 * Get the effective Prisma provider name
 */
export function getEffectiveProvider(): string {
  const dbConfig = getDatabaseConfig();
  // If DATABASE_URL is set in env, try to detect provider
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    if (url.startsWith('file:')) return 'sqlite';
    if (url.startsWith('mysql://')) return 'mysql';
    if (url.startsWith('postgresql://') || url.startsWith('postgres://')) return 'postgresql';
  }
  return getPrismaProvider(dbConfig.type);
}
