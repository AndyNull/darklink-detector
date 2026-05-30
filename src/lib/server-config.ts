/**
 * Server-side configuration file reader/writer
 * Only used in API routes (server-side)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';

const CONFIG_DIR = path.join(process.cwd(), 'config');

// --- Rate Limiting ---

const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 10; // 10 attempts per window

export function checkRateLimit(ip: string): { allowed: boolean; remainingMs: number } {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record) {
    loginAttempts.set(ip, { count: 1, lastAttempt: now });
    return { allowed: true, remainingMs: 0 };
  }

  // Reset if window has passed
  if (now - record.lastAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.set(ip, { count: 1, lastAttempt: now });
    return { allowed: true, remainingMs: 0 };
  }

  record.count++;
  record.lastAttempt = now;

  if (record.count > RATE_LIMIT_MAX) {
    const remainingMs = RATE_LIMIT_WINDOW - (now - record.lastAttempt);
    return { allowed: false, remainingMs };
  }

  return { allowed: true, remainingMs: 0 };
}

export function resetRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

// --- Password Change Rate Limiting ---

const passwordChangeAttempts = new Map<string, { count: number; lastAttempt: number }>();
const PASSWORD_RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const PASSWORD_RATE_LIMIT_MAX = 5; // 5 attempts per window

export function checkPasswordChangeRateLimit(ip: string): { allowed: boolean; remainingMs: number } {
  const now = Date.now();
  const record = passwordChangeAttempts.get(ip);

  if (!record) {
    passwordChangeAttempts.set(ip, { count: 1, lastAttempt: now });
    return { allowed: true, remainingMs: 0 };
  }

  // Reset if window has passed
  if (now - record.lastAttempt > PASSWORD_RATE_LIMIT_WINDOW) {
    passwordChangeAttempts.set(ip, { count: 1, lastAttempt: now });
    return { allowed: true, remainingMs: 0 };
  }

  record.count++;
  record.lastAttempt = now;

  if (record.count > PASSWORD_RATE_LIMIT_MAX) {
    const remainingMs = PASSWORD_RATE_LIMIT_WINDOW - (now - record.lastAttempt);
    return { allowed: false, remainingMs };
  }

  return { allowed: true, remainingMs: 0 };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (now - record.lastAttempt > RATE_LIMIT_WINDOW) {
      loginAttempts.delete(ip);
    }
  }
  for (const [ip, record] of passwordChangeAttempts.entries()) {
    if (now - record.lastAttempt > PASSWORD_RATE_LIMIT_WINDOW) {
      passwordChangeAttempts.delete(ip);
    }
  }
}, 60 * 1000); // Clean every minute

// --- Database Config ---

export interface SqliteConfig {
  path: string;
}

export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export interface PostgresqlConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

export interface DatabaseConfig {
  type: 'sqlite' | 'mysql' | 'postgresql';
  sqlite: SqliteConfig;
  mysql: MysqlConfig;
  postgresql: PostgresqlConfig;
}

const DEFAULT_DB_CONFIG: DatabaseConfig = {
  type: 'sqlite',
  sqlite: { path: './db/data.db' },
  mysql: { host: 'localhost', port: 3306, database: 'darklink', username: 'root', password: '' },
  postgresql: { host: 'localhost', port: 5432, database: 'darklink', username: 'postgres', password: '', ssl: false },
};

export function getDatabaseConfig(): DatabaseConfig {
  try {
    const filePath = path.join(CONFIG_DIR, 'database.json');
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_DB_CONFIG, ...parsed };
    }
  } catch {
    // ignore
  }
  return DEFAULT_DB_CONFIG;
}

export function setDatabaseConfig(config: DatabaseConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const filePath = path.join(CONFIG_DIR, 'database.json');
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

// --- Auth Config ---

interface AuthUser {
  username: string;
  passwordHash: string;
}

interface AuthConfig {
  users: AuthUser[];
}

const DEFAULT_AUTH_CONFIG: AuthConfig = {
  users: [
    {
      username: 'admin',
      // bcrypt hash of 'admin123' (default password, please change after first login)
      passwordHash: '$2b$12$jVgFdgNLBU34Ge9szNlbfuMrS3hf3Nd3gxFkNk68EthZtjlW.H5r2',
    },
  ],
};

// Bcrypt cost factor - higher is more secure but slower
const BCRYPT_ROUNDS = 12;

// Legacy pepper for backward-compatible SHA256 hash verification
// Only used to verify old SHA256 hashes that haven't been upgraded yet
const LEGACY_PASSWORD_PEPPER = process.env.AUTH_PEPPER || 'darklink-detector-pepper-2024';

function getAuthConfig(): AuthConfig {
  try {
    const filePath = path.join(CONFIG_DIR, 'auth.json');
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_AUTH_CONFIG, ...parsed };
    }
  } catch {
    // ignore
  }
  return DEFAULT_AUTH_CONFIG;
}

function setAuthConfig(config: AuthConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    const filePath = path.join(CONFIG_DIR, 'auth.json');
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

/**
 * Hash a password using bcrypt.
 * Bcrypt handles salting internally, so no separate pepper is needed.
 */
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a stored hash.
 * Supports both bcrypt hashes (new) and legacy SHA256+pepper hashes (old).
 * Returns an object indicating success and whether the hash should be upgraded.
 */
export function verifyPassword(password: string, storedHash: string): { valid: boolean; needsUpgrade: boolean } {
  // Try bcrypt first (bcrypt hashes start with $2a$, $2b$, or $2y$)
  if (storedHash.startsWith('$2')) {
    const valid = bcrypt.compareSync(password, storedHash);
    return { valid, needsUpgrade: false };
  }

  // Legacy SHA256+pepper hash (64 hex characters)
  if (/^[a-f0-9]{64}$/.test(storedHash)) {
    const legacyHash = crypto.createHash('sha256').update(password + LEGACY_PASSWORD_PEPPER).digest('hex');
    try {
      const hashBuf = Buffer.from(legacyHash, 'hex');
      const storedBuf = Buffer.from(storedHash, 'hex');
      if (hashBuf.length !== storedBuf.length) return { valid: false, needsUpgrade: false };
      const valid = crypto.timingSafeEqual(hashBuf, storedBuf);
      return { valid, needsUpgrade: valid }; // If valid, needs upgrade to bcrypt
    } catch {
      return { valid: false, needsUpgrade: false };
    }
  }

  // Unknown hash format
  return { valid: false, needsUpgrade: false };
}

/**
 * Check if a user is still using the default password.
 * Compares the stored password hash against the known default hash.
 */
export function isDefaultPassword(username: string): boolean {
  const DEFAULT_PASSWORD_HASH = '$2b$12$jVgFdgNLBU34Ge9szNlbfuMrS3hf3Nd3gxFkNk68EthZtjlW.H5r2';
  const config = getAuthConfig();
  const user = config.users.find(u => u.username === username);
  if (!user) return false;
  return user.passwordHash === DEFAULT_PASSWORD_HASH;
}

export function validateLogin(username: string, password: string): boolean {
  const config = getAuthConfig();
  const userIndex = config.users.findIndex(u => u.username === username);
  if (userIndex === -1) return false;

  const { valid, needsUpgrade } = verifyPassword(password, config.users[userIndex].passwordHash);
  if (!valid) return false;

  // Auto-upgrade legacy SHA256 hashes to bcrypt on successful login
  if (needsUpgrade) {
    config.users[userIndex].passwordHash = hashPassword(password);
    setAuthConfig(config);
  }

  return true;
}

// --- RSA Key Pair for Asymmetric Encryption ---

// Generate an RSA key pair for encrypting sensitive data (passwords, etc.)
// The public key is shared with the frontend; the private key stays server-side.
// Keys are cached on the global object to survive Next.js HMR module re-instantiation,
// ensuring all API routes use the same key pair.

const globalForRSA = globalThis as unknown as {
  __rsaPublicKey: string | undefined;
  __rsaPrivateKey: string | undefined;
};

function initRSAKeyPair(): void {
  if (globalForRSA.__rsaPublicKey && globalForRSA.__rsaPrivateKey) {
    rsaPublicKey = globalForRSA.__rsaPublicKey;
    rsaPrivateKey = globalForRSA.__rsaPrivateKey;
    return;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  rsaPublicKey = publicKey;
  rsaPrivateKey = privateKey;
  globalForRSA.__rsaPublicKey = publicKey;
  globalForRSA.__rsaPrivateKey = privateKey;
}

let rsaPublicKey: string;
let rsaPrivateKey: string;

initRSAKeyPair();

/**
 * Get the current RSA public key (for frontend encryption).
 */
export function getRSAPublicKey(): string {
  return rsaPublicKey;
}

/**
 * Decrypt data that was encrypted with the RSA public key.
 * Uses RSA-OAEP with SHA-256 for secure decryption.
 * Returns null if decryption fails.
 */
export function rsaDecrypt(encryptedBase64: string): string | null {
  try {
    const buffer = Buffer.from(encryptedBase64, 'base64');
    const decrypted = crypto.privateDecrypt(
      {
        key: rsaPrivateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      buffer,
    );
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

// --- Session Persistence ---

const SESSIONS_FILE = path.join(CONFIG_DIR, 'sessions.json');
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days absolute max
const SESSION_IDLE_TIMEOUT = 7 * 24 * 60 * 60 * 1000; // 7 days idle timeout (sliding)
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

interface SessionData {
  username: string;
  createdAt: number;
  lastAccessedAt: number;
  _lastSavedAt?: number; // internal: tracks when session was last persisted to disk
}

const activeSessions = new Map<string, SessionData>();

/**
 * Atomically write JSON data to a file to avoid corruption.
 * Writes to a temp file first, then renames.
 */
function atomicWriteJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempFile = filePath + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempFile, filePath);
}

/**
 * Load sessions from the persistent file, cleaning up expired ones.
 */
function loadSessions(): void {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) {
      return;
    }
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return;
    }
    const now = Date.now();
    for (const [token, data] of Object.entries(parsed)) {
      if (
        typeof data === 'object' && data !== null &&
        typeof (data as SessionData).username === 'string' &&
        typeof (data as SessionData).createdAt === 'number'
      ) {
        const session = data as SessionData;
        // Skip expired sessions during load (check both absolute max and idle timeout)
        if (now - session.createdAt > SESSION_MAX_AGE || now - session.lastAccessedAt > SESSION_IDLE_TIMEOUT) {
          continue;
        }
        // Ensure lastAccessedAt exists (backward compat with old format)
        if (typeof session.lastAccessedAt !== 'number') {
          session.lastAccessedAt = session.createdAt;
        }
        activeSessions.set(token, session);
      }
    }
    // Save cleaned-up sessions back to disk
    saveSessions();
  } catch {
    // Malformed sessions.json - fall back to empty sessions
    activeSessions.clear();
  }
}

/**
 * Save all active sessions to the persistent file.
 */
function saveSessions(): void {
  try {
    const obj: Record<string, SessionData> = {};
    for (const [token, data] of activeSessions.entries()) {
      obj[token] = data;
    }
    atomicWriteJSON(SESSIONS_FILE, obj);
  } catch {
    // ignore write errors
  }
}

/**
 * Remove all expired sessions from memory and disk.
 */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  let changed = false;
  for (const [token, session] of activeSessions.entries()) {
    if (now - session.createdAt > SESSION_MAX_AGE || now - session.lastAccessedAt > SESSION_IDLE_TIMEOUT) {
      activeSessions.delete(token);
      changed = true;
    }
  }
  if (changed) {
    saveSessions();
  }
}

// Load sessions on module initialization
loadSessions();

/**
 * Reload sessions from disk, merging with existing in-memory sessions.
 * Used when a token is not found in memory (may have been created by another process).
 * In-memory sessions take precedence over on-disk sessions for the same token.
 */
function reloadSessionsFromDisk(): void {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
    const now = Date.now();
    for (const [token, data] of Object.entries(parsed)) {
      if (
        typeof data === 'object' && data !== null &&
        typeof (data as SessionData).username === 'string' &&
        typeof (data as SessionData).createdAt === 'number'
      ) {
        const session = data as SessionData;
        // Skip expired (check both absolute max and idle timeout)
        if (now - session.createdAt > SESSION_MAX_AGE || now - session.lastAccessedAt > SESSION_IDLE_TIMEOUT) continue;
        if (typeof session.lastAccessedAt !== 'number') {
          session.lastAccessedAt = session.createdAt;
        }
        // Only add if not already in memory (in-memory takes precedence)
        if (!activeSessions.has(token)) {
          activeSessions.set(token, session);
        }
      }
    }
  } catch {
    // ignore read errors
  }
}

// Periodic cleanup of expired sessions
setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL);

export function createSession(username: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  activeSessions.set(token, { username, createdAt: now, lastAccessedAt: now });
  saveSessions();
  return token;
}

export function validateSession(token: string): string | null {
  let session = activeSessions.get(token);

  // If not found in memory, reload from disk (may have been created by another process)
  if (!session) {
    reloadSessionsFromDisk();
    session = activeSessions.get(token);
  }

  if (!session) return null;

  const now = Date.now();

  // Check absolute max age
  if (now - session.createdAt > SESSION_MAX_AGE) {
    activeSessions.delete(token);
    saveSessions();
    return null;
  }

  // Check idle timeout (sliding window based on lastAccessedAt)
  if (now - session.lastAccessedAt > SESSION_IDLE_TIMEOUT) {
    activeSessions.delete(token);
    saveSessions();
    return null;
  }

  // Refresh lastAccessedAt to extend session lifetime (sliding window)
  session.lastAccessedAt = now;
  // Debounced save: only save to disk every 5 minutes to reduce I/O
  if (now - (session._lastSavedAt || session.createdAt) > 5 * 60 * 1000) {
    session._lastSavedAt = now;
    saveSessions();
  }

  return session.username;
}

export function destroySession(token: string): void {
  if (!activeSessions.has(token)) {
    reloadSessionsFromDisk();
  }
  activeSessions.delete(token);
  saveSessions();
}

export function changePassword(username: string, oldPassword: string, newPassword: string): boolean {
  const config = getAuthConfig();
  const userIndex = config.users.findIndex(u => u.username === username);
  if (userIndex === -1) return false;

  const { valid } = verifyPassword(oldPassword, config.users[userIndex].passwordHash);
  if (!valid) return false;

  config.users[userIndex].passwordHash = hashPassword(newPassword);
  setAuthConfig(config);
  return true;
}

export function changeUsernameInConfig(oldUsername: string, newUsername: string): boolean {
  const config = getAuthConfig();
  const userIndex = config.users.findIndex(u => u.username === oldUsername);
  if (userIndex === -1) return false;

  // Check if the new username is already taken
  if (config.users.some(u => u.username === newUsername)) return false;

  config.users[userIndex].username = newUsername;
  setAuthConfig(config);
  return true;
}

// --- Input Validation ---

export function validatePasswordStrength(password: string): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (password.length < 6) errors.push('密码长度不能少于6个字符');
  if (password.length < 8) warnings.push('建议密码长度至少为8个字符');
  if (password.length > 128) errors.push('密码长度不能超过128个字符');
  if (!/[a-zA-Z]/.test(password)) errors.push('密码必须包含至少一个字母');
  if (!/[0-9]/.test(password)) errors.push('密码必须包含至少一个数字');
  if (!/[^a-zA-Z0-9]/.test(password)) warnings.push('建议添加特殊字符以增强密码强度');
  return { valid: errors.length === 0, errors, warnings };
}

export function validateUsername(username: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!username || username.trim().length === 0) errors.push('用户名不能为空');
  if (username.length > 50) errors.push('用户名长度不能超过50个字符');
  if (username.length < 2) errors.push('用户名长度不能少于2个字符');
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) errors.push('用户名只能包含字母、数字、下划线和中文');
  return { valid: errors.length === 0, errors };
}

export function validateDatabaseConfigInput(config: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.type || !['sqlite', 'mysql', 'postgresql'].includes(config.type as string)) {
    errors.push('数据库类型无效');
  }

  // Validate SQLite path
  if (config.type === 'sqlite' && config.sqlite) {
    const sqlite = config.sqlite as Record<string, unknown>;
    if (typeof sqlite.path !== 'string' || sqlite.path.trim().length === 0) {
      errors.push('SQLite路径不能为空');
    } else if (sqlite.path.length > 255) {
      errors.push('SQLite路径长度不能超过255个字符');
    } else if (sqlite.path.includes('..')) {
      errors.push('SQLite路径不能包含路径遍历字符');
    }
  }

  // Validate MySQL config
  if (config.type === 'mysql' && config.mysql) {
    const mysql = config.mysql as Record<string, unknown>;
    if (typeof mysql.host !== 'string' || mysql.host.trim().length === 0) {
      errors.push('MySQL主机地址不能为空');
    } else if (mysql.host.length > 255) {
      errors.push('MySQL主机地址长度不能超过255个字符');
    }
    if (typeof mysql.port !== 'number' || mysql.port < 1 || mysql.port > 65535) {
      errors.push('MySQL端口号必须在1-65535之间');
    }
    if (typeof mysql.database !== 'string' || mysql.database.trim().length === 0) {
      errors.push('MySQL数据库名不能为空');
    } else if (mysql.database.length > 128) {
      errors.push('MySQL数据库名长度不能超过128个字符');
    }
    if (typeof mysql.username !== 'string' || mysql.username.trim().length === 0) {
      errors.push('MySQL用户名不能为空');
    }
  }

  // Validate PostgreSQL config
  if (config.type === 'postgresql' && config.postgresql) {
    const pg = config.postgresql as Record<string, unknown>;
    if (typeof pg.host !== 'string' || pg.host.trim().length === 0) {
      errors.push('PostgreSQL主机地址不能为空');
    } else if (pg.host.length > 255) {
      errors.push('PostgreSQL主机地址长度不能超过255个字符');
    }
    if (typeof pg.port !== 'number' || pg.port < 1 || pg.port > 65535) {
      errors.push('PostgreSQL端口号必须在1-65535之间');
    }
    if (typeof pg.database !== 'string' || pg.database.trim().length === 0) {
      errors.push('PostgreSQL数据库名不能为空');
    } else if (pg.database.length > 128) {
      errors.push('PostgreSQL数据库名长度不能超过128个字符');
    }
    if (typeof pg.username !== 'string' || pg.username.trim().length === 0) {
      errors.push('PostgreSQL用户名不能为空');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function maskDatabaseConfig(config: DatabaseConfig): Record<string, unknown> {
  return {
    ...config,
    mysql: { ...config.mysql, password: config.mysql.password ? '******' : '' },
    postgresql: { ...config.postgresql, password: config.postgresql.password ? '******' : '' },
  };
}

// --- Import Validation ---

export const MAX_IMPORT_RECORDS_PER_TABLE = 50000;

export function validateImportData(data: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.tables || typeof data.tables !== 'object') {
    errors.push('导入数据格式无效: 缺少tables字段');
    return { valid: false, errors };
  }

  if (!data.version || typeof data.version !== 'string') {
    errors.push('导入数据缺少版本信息');
    return { valid: false, errors };
  }

  const tables = data.tables as Record<string, unknown>;
  for (const [tableName, tableData] of Object.entries(tables)) {
    if (!Array.isArray(tableData)) {
      continue; // Skip non-array fields
    }
    if (tableData.length > MAX_IMPORT_RECORDS_PER_TABLE) {
      errors.push(`表 ${tableName} 记录数(${tableData.length})超过单表上限(${MAX_IMPORT_RECORDS_PER_TABLE})`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// --- Session Helper for API Routes ---

export function getSessionFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return validateSession(token);
}
