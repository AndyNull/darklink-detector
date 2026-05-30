import { appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LogCategory = 'auth' | 'task' | 'system' | 'data';

export interface LogEntry {
  timestamp: string;
  action: string;
  actor: string;
  details: string;
  ip?: string;
  /** Structured metadata for machine-readable data (replaces passing objects as details) */
  metadata?: Record<string, unknown>;
  /** Entity type this log relates to (e.g. 'scan_task', 'malicious_domain', 'threat_intel_source') */
  entityType?: string;
  /** Entity ID this log relates to (e.g. task ID, domain ID) */
  entityId?: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const LOGS_DIR = join(process.cwd(), 'logs');

const VALID_CATEGORIES: Set<string> = new Set(['auth', 'task', 'system', 'data']);

// Maximum single log file size (10MB) — prevents unbounded growth
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024;

// ─── Initialize ─────────────────────────────────────────────────────────────

let logsDirEnsured = false;

async function ensureLogsDir(): Promise<void> {
  if (logsDirEnsured) return;
  try {
    if (!existsSync(LOGS_DIR)) {
      await mkdir(LOGS_DIR, { recursive: true });
    }
    logsDirEnsured = true;
  } catch (err) {
    console.error('[audit-logger] Failed to create logs directory:', err);
  }
}

// ─── Core logging function ──────────────────────────────────────────────────

/**
 * Log an action to the audit log.
 *
 * @param category   - One of 'auth', 'task', 'system', 'data'
 * @param action     - Short description of the action (e.g. 'login_success', 'task_created')
 * @param actor      - Who performed the action (username or 'system')
 * @param details    - Additional details about the action (string or object; objects are serialized)
 * @param ip         - Optional IP address of the requester
 * @param entityType - Optional entity type this log relates to
 * @param entityId   - Optional entity ID this log relates to
 */
export async function logAction(
  category: LogCategory,
  action: string,
  actor: string,
  details: string | Record<string, unknown>,
  ip?: string,
  entityType?: string,
  entityId?: string,
): Promise<void> {
  if (!VALID_CATEGORIES.has(category)) {
    console.warn(`[audit-logger] Invalid category: ${category}`);
    return;
  }

  // Handle details: if object, extract to metadata and generate string summary
  let detailsStr: string;
  let metadata: Record<string, unknown> | undefined;

  if (typeof details === 'string') {
    detailsStr = details;
  } else {
    // Object passed — store as metadata and generate a readable summary
    metadata = details;
    detailsStr = Object.entries(details)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(', ');
  }

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    action,
    actor: actor || 'system',
    details: detailsStr,
    ...(ip ? { ip } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
  };

  const line = JSON.stringify(entry) + '\n';

  try {
    await ensureLogsDir();
    const logFile = join(LOGS_DIR, `${category}.log`);

    // Simple size check: if file exceeds max size, rotate by truncating
    try {
      const { stat } = await import('fs/promises');
      if (existsSync(logFile)) {
        const stats = await stat(logFile);
        if (stats.size > MAX_LOG_FILE_SIZE) {
          // Rotate: rename old file and start fresh
          const { rename } = await import('fs/promises');
          const backupFile = join(LOGS_DIR, `${category}.log.old`);
          try {
            await rename(logFile, backupFile);
          } catch {
            // If rename fails (e.g. backup already exists), just truncate
            const { writeFile } = await import('fs/promises');
            await writeFile(logFile, '');
          }
        }
      }
    } catch {
      // Size check failed — just append anyway
    }

    await appendFile(logFile, line, 'utf-8');
  } catch (err) {
    console.error(`[audit-logger] Failed to write to ${category}.log:`, err);
  }
}

// ─── Convenience methods ────────────────────────────────────────────────────

export const auditLog = {
  auth: (action: string, actor: string, details: string | Record<string, unknown>, ip?: string, entityType?: string, entityId?: string) =>
    logAction('auth', action, actor, details, ip, entityType, entityId),

  task: (action: string, actor: string, details: string | Record<string, unknown>, ip?: string, entityType?: string, entityId?: string) =>
    logAction('task', action, actor, details, ip, entityType, entityId),

  system: (action: string, actor: string, details: string | Record<string, unknown>, ip?: string, entityType?: string, entityId?: string) =>
    logAction('system', action, actor, details, ip, entityType, entityId),

  data: (action: string, actor: string, details: string | Record<string, unknown>, ip?: string, entityType?: string, entityId?: string) =>
    logAction('data', action, actor, details, ip, entityType, entityId),
};

// ─── Log reading (for API endpoint) ─────────────────────────────────────────

export interface LogFilter {
  category?: LogCategory;
  startDate?: string; // ISO date string
  endDate?: string;   // ISO date string
  search?: string;    // Search within details/action
  limit?: number;     // Max entries to return (default 500, max 2000)
  offset?: number;    // Offset for pagination
  entityType?: string; // Filter by entity type
  entityId?: string;   // Filter by entity ID
}

export interface LogReadResult {
  entries: LogEntry[];
  total: number;
  category: string;
}

/**
 * Read log entries from log files with filtering.
 * Reads from the end of the file (most recent first) for efficiency.
 */
export async function readLogs(filter: LogFilter = {}): Promise<LogReadResult[]> {
  const { category, startDate, endDate, search, limit = 500, offset = 0, entityType, entityId } = filter;
  const maxLimit = Math.min(limit, 2000);

  await ensureLogsDir();

  const categories: LogCategory[] = category ? [category] : ['auth', 'task', 'system', 'data'];
  const results: LogReadResult[] = [];

  for (const cat of categories) {
    const logFile = join(LOGS_DIR, `${cat}.log`);

    if (!existsSync(logFile)) {
      results.push({ entries: [], total: 0, category: cat });
      continue;
    }

    try {
      const { readFile } = await import('fs/promises');
      const content = await readFile(logFile, 'utf-8');
      const lines = content.trim().split('\n').filter(l => l.trim());

      let entries: LogEntry[] = [];
      let total = 0;

      for (const line of lines) {
        try {
          const entry: LogEntry = JSON.parse(line);

          // Apply date filters
          if (startDate && entry.timestamp < startDate) continue;
          if (endDate && entry.timestamp > endDate) continue;

          // Apply entity filters
          if (entityType && entry.entityType !== entityType) continue;
          if (entityId && entry.entityId !== entityId) continue;

          // Apply search filter — search across all text fields including metadata
          if (search) {
            const searchLower = search.toLowerCase();
            const matchesSearch =
              entry.action.toLowerCase().includes(searchLower) ||
              entry.actor.toLowerCase().includes(searchLower) ||
              entry.details.toLowerCase().includes(searchLower) ||
              (entry.ip && entry.ip.toLowerCase().includes(searchLower)) ||
              (entry.metadata && JSON.stringify(entry.metadata).toLowerCase().includes(searchLower)) ||
              (entry.entityType && entry.entityType.toLowerCase().includes(searchLower)) ||
              (entry.entityId && entry.entityId.toLowerCase().includes(searchLower));
            if (!matchesSearch) continue;
          }

          total++;
          entries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }

      // Reverse to show most recent first, then apply pagination
      entries.reverse();
      const paginatedEntries = entries.slice(offset, offset + maxLimit);

      results.push({
        entries: paginatedEntries,
        total,
        category: cat,
      });
    } catch (err) {
      console.error(`[audit-logger] Failed to read ${cat}.log:`, err);
      results.push({ entries: [], total: 0, category: cat });
    }
  }

  return results;
}

/**
 * Get list of available log categories with file sizes
 */
export async function getLogCategories(): Promise<Array<{ category: string; size: number; exists: boolean }>> {
  await ensureLogsDir();

  const categories: LogCategory[] = ['auth', 'task', 'system', 'data'];
  const result = [];

  for (const cat of categories) {
    const logFile = join(LOGS_DIR, `${cat}.log`);
    try {
      if (existsSync(logFile)) {
        const { stat } = await import('fs/promises');
        const stats = await stat(logFile);
        result.push({ category: cat, size: stats.size, exists: true });
      } else {
        result.push({ category: cat, size: 0, exists: false });
      }
    } catch {
      result.push({ category: cat, size: 0, exists: false });
    }
  }

  return result;
}
