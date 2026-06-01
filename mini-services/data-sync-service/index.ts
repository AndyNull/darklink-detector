import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Server } from 'socket.io';
import { Database } from 'bun:sqlite';
import path from 'path';

const PORT = parseInt(process.env.DATA_SYNC_PORT || '3004', 10);
// 支持环境变量覆盖数据库路径（Docker 部署时使用）
const __dirname = import.meta.dirname;
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../db/custom.db');
const POLL_INTERVAL = 30_000; // 30 seconds
const SYNC_TASKS_FAST_POLL = 5_000; // 5 seconds for active sync tasks

// ─── Database ────────────────────────────────────────────────────────────────

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    try {
      db = new Database(DB_PATH, { readonly: true });
      console.log(`[DB] Connected to SQLite: ${DB_PATH}`);
    } catch (err) {
      console.error(`[DB] Failed to connect to SQLite: ${DB_PATH}`, err);
      throw err;
    }
  }
  return db;
}

// ─── Cached state ────────────────────────────────────────────────────────────

interface SourceStat {
  sourceId: string;
  enabled: number;
  entryCount: number;
  domainCount: number;
  ipCount: number;
  totalCount: number;
}

let cachedSourceStats: SourceStat[] = [];
let cachedSyncTasks: any[] = [];
let cachedSchedule: any = null;
let cachedMaliciousStats = { domainCount: 0, ipCount: 0 };

// Malicious entries cache — keyed by "type:page:pageSize:search" (search truncated to 100 chars)
const MAX_CACHE_ENTRIES = 1000;
let cachedMaliciousEntries: Map<string, { data: any; timestamp: number }> = new Map();
const MALICIOUS_ENTRIES_CACHE_TTL = 15_000; // 15 seconds

// Hashes for change detection
let sourceStatsHash = '';
let syncTasksHash = '';
let scheduleHash = '';
let maliciousStatsHash = '';

// Track last known row counts for MaliciousDomain/MaliciousIP to detect changes
let lastDomainCount = 0;
let lastIpCount = 0;

function hashData(data: any): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(Date.now());
  }
}

// ─── Data Queries ────────────────────────────────────────────────────────────

function queryThreatIntelSources(): SourceStat[] {
  try {
    const d = getDb();

    // Get entry counts per source from ThreatIntelEntry table
    const entryCounts = d.query(`
      SELECT sourceId, COUNT(*) as entryCount
      FROM ThreatIntelEntry
      GROUP BY sourceId
    `).all() as { sourceId: string; entryCount: number }[];

    // Get source enabled state from ThreatIntelSource table
    const sourceStates = d.query(`
      SELECT sourceId, enabled, entryCount
      FROM ThreatIntelSource
    `).all() as { sourceId: string; enabled: number; entryCount: number }[];

    // Get domain counts per source from MaliciousDomain table
    const domainBySource = d.query(`
      SELECT source, COUNT(*) as count
      FROM MaliciousDomain
      GROUP BY source
    `).all() as { source: string; count: number }[];

    // Get IP counts per source from MaliciousIP table
    const ipBySource = d.query(`
      SELECT source, COUNT(*) as count
      FROM MaliciousIP
      GROUP BY source
    `).all() as { source: string; count: number }[];

    // Build maps
    const entryMap = new Map(entryCounts.map(e => [e.sourceId, e.entryCount]));
    const stateMap = new Map(sourceStates.map(s => [s.sourceId, s]));
    const domainMap = new Map(domainBySource.map(s => [s.source, s.count]));
    const ipMap = new Map(ipBySource.map(s => [s.source, s.count]));

    // Build combined results from all sources
    const allSourceIds = new Set([
      ...entryMap.keys(),
      ...stateMap.keys(),
      ...domainMap.keys(),
      ...ipMap.keys(),
    ]);

    const results: SourceStat[] = [];

    for (const sourceId of allSourceIds) {
      const state = stateMap.get(sourceId);
      const threatEntryCount = entryMap.get(sourceId) || 0;
      const domainCount = domainMap.get(sourceId) || 0;
      const ipCount = ipMap.get(sourceId) || 0;
      // Total = malicious domain + malicious IP (these are the actual usable entries)
      const totalCount = domainCount + ipCount;
      // entryCount = ThreatIntelEntry count (from raw sync data)
      const entryCount = threatEntryCount || state?.entryCount || totalCount;

      results.push({
        sourceId,
        enabled: state?.enabled ?? 1,
        entryCount,
        domainCount,
        ipCount,
        totalCount,
      });
    }

    return results;
  } catch (err) {
    console.error('[DB] Error querying threat intel sources:', err);
    return cachedSourceStats;
  }
}

function querySyncTasks(): any[] {
  try {
    const d = getDb();
    const tasks = d.query(`
      SELECT id, name, sources, status, progress, totalSources, completedSources,
             failedSources, results, error, createdAt, startedAt, completedAt, createdBy
      FROM SyncTask
      ORDER BY createdAt DESC
      LIMIT 50
    `).all() as any[];
    return tasks.map((t: any) => ({
      ...t,
      progress: typeof t.progress === 'string' ? parseFloat(t.progress) : t.progress,
    }));
  } catch (err) {
    console.error('[DB] Error querying sync tasks:', err);
    return cachedSyncTasks;
  }
}

function querySchedule(): any {
  try {
    const d = getDb();
    const schedule = d.query(`SELECT * FROM UpdateSchedule LIMIT 1`).get() as any;
    if (!schedule) {
      return { enabled: false, frequency: 'daily', lastRunAt: null, nextRunAt: null, status: 'idle' };
    }
    return {
      enabled: schedule.enabled ?? false,
      frequency: schedule.frequency || 'daily',
      lastRunAt: schedule.lastRunAt,
      nextRunAt: schedule.nextRunAt,
      status: schedule.status || 'idle',
    };
  } catch (err) {
    console.error('[DB] Error querying schedule:', err);
    return cachedSchedule;
  }
}

function queryMaliciousStats(): { domainCount: number; ipCount: number } {
  try {
    const d = getDb();
    const domainRow = d.query(`SELECT COUNT(*) as count FROM MaliciousDomain`).get() as { count: number } | null;
    const ipRow = d.query(`SELECT COUNT(*) as count FROM MaliciousIP`).get() as { count: number } | null;
    return {
      domainCount: domainRow?.count || 0,
      ipCount: ipRow?.count || 0,
    };
  } catch (err) {
    console.error('[DB] Error querying malicious stats:', err);
    return cachedMaliciousStats;
  }
}

/**
 * Evict oldest cache entries when the cache exceeds MAX_CACHE_ENTRIES.
 * Uses LRU eviction: removes the oldest 10% of entries (first inserted).
 */
function evictCacheIfNeeded(): void {
  if (cachedMaliciousEntries.size < MAX_CACHE_ENTRIES) return;
  const evictCount = Math.floor(MAX_CACHE_ENTRIES * 0.1);
  let evicted = 0;
  for (const key of cachedMaliciousEntries.keys()) {
    if (evicted >= evictCount) break;
    cachedMaliciousEntries.delete(key);
    evicted++;
  }
}

/**
 * Query paginated malicious entries (domain or IP).
 * Results are cached for MALICIOUS_ENTRIES_CACHE_TTL to avoid hitting the DB on every request.
 */
function queryMaliciousEntries(
  type: 'domain' | 'ip',
  page: number = 1,
  pageSize: number = 50,
  search: string = '',
): { items: any[]; total: number; page: number; pageSize: number } {
  const truncatedSearch = search.slice(0, 100);
  const cacheKey = `${type}:${page}:${pageSize}:${truncatedSearch}`;

  // Check cache
  const cached = cachedMaliciousEntries.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < MALICIOUS_ENTRIES_CACHE_TTL) {
    return cached.data;
  }

  try {
    const d = getDb();
    const offset = (page - 1) * pageSize;

    if (type === 'ip') {
      let countRow: { count: number } | null;
      let items: any[];

      if (search) {
        const searchPattern = `%${search}%`;
        countRow = d.query(
          'SELECT COUNT(*) as count FROM MaliciousIP WHERE ip LIKE ? OR reason LIKE ? OR category LIKE ?',
          [searchPattern, searchPattern, searchPattern]
        ).get() as { count: number } | null;
        items = d.query(
          'SELECT id, ip, reason, source, severity, category, country, createdAt, updatedAt FROM MaliciousIP WHERE ip LIKE ? OR reason LIKE ? OR category LIKE ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
          [searchPattern, searchPattern, searchPattern, pageSize, offset]
        ).all() as any[];
      } else {
        countRow = d.query('SELECT COUNT(*) as count FROM MaliciousIP WHERE 1=1').get() as { count: number } | null;
        items = d.query(
          'SELECT id, ip, reason, source, severity, category, country, createdAt, updatedAt FROM MaliciousIP WHERE 1=1 ORDER BY createdAt DESC LIMIT ? OFFSET ?',
          [pageSize, offset]
        ).all() as any[];
      }

      const total = countRow?.count || 0;

      const result = { items, total, page, pageSize };
      evictCacheIfNeeded();
      cachedMaliciousEntries.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    } else {
      let countRow: { count: number } | null;
      let items: any[];

      if (search) {
        const searchPattern = `%${search}%`;
        countRow = d.query(
          'SELECT COUNT(*) as count FROM MaliciousDomain WHERE domain LIKE ? OR reason LIKE ? OR category LIKE ?',
          [searchPattern, searchPattern, searchPattern]
        ).get() as { count: number } | null;
        items = d.query(
          'SELECT id, domain, reason, source, severity, category, createdAt, updatedAt FROM MaliciousDomain WHERE domain LIKE ? OR reason LIKE ? OR category LIKE ? ORDER BY createdAt DESC LIMIT ? OFFSET ?',
          [searchPattern, searchPattern, searchPattern, pageSize, offset]
        ).all() as any[];
      } else {
        countRow = d.query('SELECT COUNT(*) as count FROM MaliciousDomain WHERE 1=1').get() as { count: number } | null;
        items = d.query(
          'SELECT id, domain, reason, source, severity, category, createdAt, updatedAt FROM MaliciousDomain WHERE 1=1 ORDER BY createdAt DESC LIMIT ? OFFSET ?',
          [pageSize, offset]
        ).all() as any[];
      }

      const total = countRow?.count || 0;

      const result = { items, total, page, pageSize };
      evictCacheIfNeeded();
      cachedMaliciousEntries.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    }
  } catch (err) {
    console.error('[DB] Error querying malicious entries:', err);
    const cached2 = cachedMaliciousEntries.get(cacheKey);
    if (cached2) return cached2.data;
    return { items: [], total: 0, page, pageSize };
  }
}

// ─── Change Detection & Push ─────────────────────────────────────────────────

function checkAndPushChanges() {
  try {
  // Threat intel sources
  const newSourceStats = queryThreatIntelSources();
  const newSourceStatsHash = hashData(newSourceStats);
  if (newSourceStatsHash !== sourceStatsHash) {
    sourceStatsHash = newSourceStatsHash;
    cachedSourceStats = newSourceStats;
    io.emit('data:threat-intel-sources', newSourceStats);
  }

  // Sync tasks
  const newSyncTasks = querySyncTasks();
  const newSyncTasksHash = hashData(newSyncTasks);
  if (newSyncTasksHash !== syncTasksHash) {
    syncTasksHash = newSyncTasksHash;
    cachedSyncTasks = newSyncTasks;
    io.emit('data:sync-tasks', newSyncTasks);
  }

  // Schedule
  const newSchedule = querySchedule();
  const newScheduleHash = hashData(newSchedule);
  if (newScheduleHash !== scheduleHash) {
    scheduleHash = newScheduleHash;
    cachedSchedule = newSchedule;
    io.emit('data:schedule', newSchedule);
  }

  // Malicious stats
  const newMaliciousStats = queryMaliciousStats();
  const newMaliciousStatsHash = hashData(newMaliciousStats);
  if (newMaliciousStatsHash !== maliciousStatsHash) {
    maliciousStatsHash = newMaliciousStatsHash;
    cachedMaliciousStats = newMaliciousStats;
    io.emit('data:malicious-stats', { ...newMaliciousStats, lastUpdated: Date.now() });

    // Detect row count changes — invalidate entries cache and push update
    const domainCountChanged = newMaliciousStats.domainCount !== lastDomainCount;
    const ipCountChanged = newMaliciousStats.ipCount !== lastIpCount;
    if (domainCountChanged || ipCountChanged) {
      // Invalidate all malicious entries cache
      cachedMaliciousEntries.clear();
      lastDomainCount = newMaliciousStats.domainCount;
      lastIpCount = newMaliciousStats.ipCount;

      // Push a notification that entries have changed
      io.emit('data:malicious-entries-changed', {
        domainCount: newMaliciousStats.domainCount,
        ipCount: newMaliciousStats.ipCount,
        lastUpdated: Date.now(),
      });
    }
  }
  } catch (err) {
    console.error('[POLL] Error in checkAndPushChanges:', err);
  }
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

// ─── CORS Configuration ──────────────────────────────────────────────────────

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim()).filter(Boolean);

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // No CORS header = browser blocks the request from unauthorized origins
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS headers — restricted to allowed origins only
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || '/';

  // Health check
  if (url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      connectedClients: io.sockets.sockets.size,
    }));
    return;
  }

  // REST fallback for direct data access
  if (url === '/api/threat-intel-sources' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sources: queryThreatIntelSources() }));
    return;
  }

  if (url === '/api/sync-tasks' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tasks: querySyncTasks() }));
    return;
  }

  if (url === '/api/schedule' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ schedule: querySchedule() }));
    return;
  }

  if (url === '/api/malicious-stats' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...queryMaliciousStats(), lastUpdated: Date.now() }));
    return;
  }

  // REST endpoint for malicious entries
  if (url.startsWith('/api/malicious-entries') && req.method === 'GET') {
    try {
      const u = new URL(url, 'http://dummy');
      const type = (u.searchParams.get('type') || 'domain') as 'domain' | 'ip';
      const page = parseInt(u.searchParams.get('page') || '1');
      const pageSize = parseInt(u.searchParams.get('pageSize') || '50');
      const search = u.searchParams.get('search') || '';
      const result = queryMaliciousEntries(type, page, pageSize, search);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  if (!url.startsWith('/socket.io')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// ─── Socket.io Server ────────────────────────────────────────────────────────

const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true,
  connectTimeout: 10000,
});

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Send current cached data immediately on connection
  if (cachedSourceStats.length > 0) {
    socket.emit('data:threat-intel-sources', cachedSourceStats);
  }
  if (cachedSyncTasks.length > 0) {
    socket.emit('data:sync-tasks', cachedSyncTasks);
  }
  if (cachedSchedule) {
    socket.emit('data:schedule', cachedSchedule);
  }
  socket.emit('data:malicious-stats', { ...cachedMaliciousStats, lastUpdated: Date.now() });

  // Client subscribes to data channels
  socket.on('subscribe', (channels: string[]) => {
    console.log(`[WS] Client ${socket.id} subscribed to: ${channels.join(', ')}`);
  });

  // Client unsubscribes
  socket.on('unsubscribe', (channels: string[]) => {
    console.log(`[WS] Client ${socket.id} unsubscribed from: ${channels.join(', ')}`);
  });

  // Client requests immediate refresh
  socket.on('request:threat-intel-sources', () => {
    const data = queryThreatIntelSources();
    cachedSourceStats = data;
    sourceStatsHash = hashData(data);
    socket.emit('data:threat-intel-sources', data);
  });

  socket.on('request:sync-tasks', () => {
    const data = querySyncTasks();
    cachedSyncTasks = data;
    syncTasksHash = hashData(data);
    socket.emit('data:sync-tasks', data);
  });

  socket.on('request:schedule', () => {
    const data = querySchedule();
    cachedSchedule = data;
    scheduleHash = hashData(data);
    socket.emit('data:schedule', data);
  });

  socket.on('request:malicious-stats', () => {
    const data = queryMaliciousStats();
    cachedMaliciousStats = data;
    maliciousStatsHash = hashData(data);
    socket.emit('data:malicious-stats', { ...data, lastUpdated: Date.now() });
  });

  // ──── Malicious entries (on-demand, per-client) ────

  /**
   * Client requests malicious entries for a specific type/page/search.
   * Responds only to the requesting client (not broadcast).
   * The response event is `data:malicious-entries` with the request params echoed back.
   */
  socket.on('request:malicious-entries', (params: {
    type: 'domain' | 'ip';
    page?: number;
    pageSize?: number;
    search?: string;
  }) => {
    const { type = 'domain', page = 1, pageSize = 50, search = '' } = params || {};
    const result = queryMaliciousEntries(type, page, pageSize, search);
    socket.emit('data:malicious-entries', {
      ...result,
      type,      // Echo back the type for client-side routing
      search,    // Echo back search for matching
    });
  });

  // Health check
  socket.on('health', (cb) => {
    if (typeof cb === 'function') {
      cb({ status: 'ok', connectedClients: io.sockets.sockets.size });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[WS] Client disconnected: ${socket.id} (${reason})`);
  });

  socket.on('error', (error) => {
    console.error(`[WS] Socket error (${socket.id}):`, error.message);
  });
});

// ─── Startup ─────────────────────────────────────────────────────────────────

// Initial data load
try {
  getDb();
  cachedSourceStats = queryThreatIntelSources();
  cachedSyncTasks = querySyncTasks();
  cachedSchedule = querySchedule();
  cachedMaliciousStats = queryMaliciousStats();
  sourceStatsHash = hashData(cachedSourceStats);
  syncTasksHash = hashData(cachedSyncTasks);
  scheduleHash = hashData(cachedSchedule);
  maliciousStatsHash = hashData(cachedMaliciousStats);
  lastDomainCount = cachedMaliciousStats.domainCount;
  lastIpCount = cachedMaliciousStats.ipCount;
  console.log('[DB] Initial data loaded successfully');
} catch (err) {
  console.error('[DB] Failed to load initial data:', err);
}

// Start polling for changes
setInterval(checkAndPushChanges, POLL_INTERVAL);

// Fast polling for sync tasks when there are active (running/pending) tasks
// This ensures the UI sees task progress updates quickly
function checkSyncTasksFast() {
  try {
    const d = getDb();
    const hasActiveTasks = d.query(`
      SELECT COUNT(*) as count FROM SyncTask WHERE status IN ('running', 'pending')
    `).get() as { count: number } | null;

    if (hasActiveTasks && hasActiveTasks.count > 0) {
      // There are active tasks - check for changes immediately
      const newSyncTasks = querySyncTasks();
      const newSyncTasksHash = hashData(newSyncTasks);
      if (newSyncTasksHash !== syncTasksHash) {
        syncTasksHash = newSyncTasksHash;
        cachedSyncTasks = newSyncTasks;
        io.emit('data:sync-tasks', newSyncTasks);
      }
    }
  } catch (err) {
    // Silently ignore errors in fast poll
  }
}
setInterval(checkSyncTasksFast, SYNC_TASKS_FAST_POLL);

// Periodically clean up stale malicious entries cache entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cachedMaliciousEntries) {
    if (now - entry.timestamp > MALICIOUS_ENTRIES_CACHE_TTL * 2) {
      cachedMaliciousEntries.delete(key);
    }
  }
}, 60_000);

// Start server
httpServer.listen(PORT, () => {
  console.log(`Data Sync Service running on port ${PORT} (HTTP + WebSocket)`);
  console.log(`Process PID: ${process.pid}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Poll interval: ${POLL_INTERVAL / 1000}s (sync tasks: ${SYNC_TASKS_FAST_POLL / 1000}s when active)`);
});

// Keep process alive
setInterval(() => {}, 30000);

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
