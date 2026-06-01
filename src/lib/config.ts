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
  /** Maximum number of URLs scanned concurrently */
  defaultConcurrency: number;
  /** Default timeout in SECONDS (will be converted to ms internally by {@link getScanConfigMs}) */
  defaultTimeout: number;
  /** Maximum number of external JS resources to fetch per page */
  maxExternalJs: number;
  /** Maximum number of external CSS resources to fetch per page */
  maxExternalCss: number;
  /** Number of hours to retain completed scan tasks before cleanup */
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
    version: '1.12.0',
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

// ─── Config Validation ─────────────────────────────────────────────────────

const VALID_DB_TYPES = new Set(['sqlite', 'mysql', 'postgresql']);

/**
 * Validate an AppConfigFile and return a corrected copy with invalid values
 * replaced by their defaults. Logs warnings for each invalid value found.
 */
export function validateConfig(config: AppConfigFile): AppConfigFile {
  const corrected = deepMerge({}, config) as AppConfigFile;
  let hasChanges = false;

  // Validate scan.defaultTimeout (1–300 seconds)
  if (typeof corrected.scan.defaultTimeout !== 'number' || corrected.scan.defaultTimeout < 1 || corrected.scan.defaultTimeout > 300) {
    console.warn(
      `[Config] scan.defaultTimeout=${corrected.scan.defaultTimeout} is invalid (must be 1–300), using default ${DEFAULT_CONFIG.scan.defaultTimeout}`
    );
    corrected.scan.defaultTimeout = DEFAULT_CONFIG.scan.defaultTimeout;
    hasChanges = true;
  }

  // Validate scan.taskRetentionHours (>= 1)
  if (typeof corrected.scan.taskRetentionHours !== 'number' || corrected.scan.taskRetentionHours < 1) {
    console.warn(
      `[Config] scan.taskRetentionHours=${corrected.scan.taskRetentionHours} is invalid (must be >= 1), using default ${DEFAULT_CONFIG.scan.taskRetentionHours}`
    );
    corrected.scan.taskRetentionHours = DEFAULT_CONFIG.scan.taskRetentionHours;
    hasChanges = true;
  }

  // Validate database.type
  if (!VALID_DB_TYPES.has(corrected.database.type)) {
    console.warn(
      `[Config] database.type="${corrected.database.type}" is invalid (must be one of ${[...VALID_DB_TYPES].join(', ')}), using default "${DEFAULT_CONFIG.database.type}"`
    );
    corrected.database.type = DEFAULT_CONFIG.database.type;
    hasChanges = true;
  }

  // Validate mysql.poolSize (1–50) when applicable
  if (typeof corrected.database.mysql.poolSize !== 'number' || corrected.database.mysql.poolSize < 1 || corrected.database.mysql.poolSize > 50) {
    console.warn(
      `[Config] database.mysql.poolSize=${corrected.database.mysql.poolSize} is invalid (must be 1–50), using default ${DEFAULT_CONFIG.database.mysql.poolSize}`
    );
    corrected.database.mysql.poolSize = DEFAULT_CONFIG.database.mysql.poolSize;
    hasChanges = true;
  }

  // Validate postgresql.poolSize (1–50) when applicable
  if (typeof corrected.database.postgresql.poolSize !== 'number' || corrected.database.postgresql.poolSize < 1 || corrected.database.postgresql.poolSize > 50) {
    console.warn(
      `[Config] database.postgresql.poolSize=${corrected.database.postgresql.poolSize} is invalid (must be 1–50), using default ${DEFAULT_CONFIG.database.postgresql.poolSize}`
    );
    corrected.database.postgresql.poolSize = DEFAULT_CONFIG.database.postgresql.poolSize;
    hasChanges = true;
  }

  if (hasChanges) {
    console.warn('[Config] Some invalid values were corrected — see warnings above');
  }

  return corrected;
}

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
    const merged = deepMerge(DEFAULT_CONFIG, parsed);
    _cachedConfig = validateConfig(merged);
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

/**
 * Get the scan config with timeout converted to MILLISECONDS.
 *
 * The config file stores `defaultTimeout` in **seconds** for human readability,
 * but the scan engine expects milliseconds. This helper performs the conversion
 * so callers don't have to remember to multiply by 1000.
 *
 * @returns A copy of ScanConfig with `defaultTimeout` in milliseconds
 */
export function getScanConfigMs(): ScanConfig & { defaultTimeout: number } {
  const config = loadConfig().scan;
  return {
    ...config,
    defaultTimeout: config.defaultTimeout * 1000,
  };
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
