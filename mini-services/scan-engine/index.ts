import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Server } from 'socket.io';
import { executeScan, stopTask, isTaskRunning } from './scan-engine';
import type { ScanRequest, ScanResultData, ScanProgress, LogEntry, UrlConfig } from './types';

// ─── SSRF Protection ──────────────────────────────────────────────────────────
// Replicated from src/lib/security.ts since the mini-service cannot import
// from the main app. Validates URLs before passing them to executeScan().

const PRIVATE_IP_RANGES = [
  { start: 10 * 256 ** 3, end: 10 * 256 ** 3 + 255 * 256 ** 2 + 255 * 256 + 255 },  // 10.0.0.0/8
  { start: 172 * 256 ** 3 + 16 * 256 ** 2, end: 172 * 256 ** 3 + 31 * 256 ** 2 + 255 * 256 + 255 }, // 172.16.0.0/12
  { start: 192 * 256 ** 3 + 168 * 256 ** 2, end: 192 * 256 ** 3 + 168 * 256 ** 2 + 255 * 256 + 255 }, // 192.168.0.0/16
  { start: 127 * 256 ** 3, end: 127 * 256 ** 3 + 255 * 256 ** 2 + 255 * 256 + 255 }, // 127.0.0.0/8
  { start: 169 * 256 ** 3 + 254 * 256 ** 2, end: 169 * 256 ** 3 + 254 * 256 ** 2 + 255 * 256 + 255 }, // 169.254.0.0/16
  { start: 0, end: 255 * 256 ** 2 + 255 * 256 + 255 }, // 0.0.0.0/8
];

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIP(ip: string): boolean {
  const num = ipToNumber(ip);
  return PRIVATE_IP_RANGES.some(range => num >= range.start && num <= range.end);
}

function isValidIP(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (part.length > 1 && part.startsWith('0')) return false;
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return false;
    if (part !== String(num)) return false;
  }
  return true;
}

function isPrivateIPv6(ip: string): boolean {
  const groups = expandIPv6(ip);
  // ::1 — loopback
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
      groups[4] === 0 && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) {
    return true;
  }
  // fc00::/7 — unique-local
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 — link-local
  if (groups[0] === 0xfe80 && (groups[1] & 0xc000) === 0x0000) return true;
  return false;
}

function expandIPv6(ip: string): number[] {
  const v4MappedMatch = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedMatch) {
    const octets = v4MappedMatch[1].split('.').map(Number);
    return [0, 0, 0, 0, 0, 0xffff, (octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
  }
  const halves = ip.split('::');
  const result: number[] = new Array(8).fill(0);
  if (halves.length === 1) {
    const parts = ip.split(':').map(p => (p ? parseInt(p, 16) : 0));
    for (let i = 0; i < Math.min(parts.length, 8); i++) result[i] = parts[i];
  } else {
    const left = halves[0] ? halves[0].split(':').map(p => parseInt(p, 16)) : [];
    const right = halves[1] ? halves[1].split(':').map(p => parseInt(p, 16)) : [];
    for (let i = 0; i < left.length; i++) result[i] = left[i];
    const rightStart = 8 - right.length;
    for (let i = 0; i < right.length; i++) result[rightStart + i] = right[i];
  }
  return result;
}

function validateScanUrl(url: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    // Only allow HTTP/HTTPS
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, reason: `Non-HTTP protocol: ${parsed.protocol}` };
    }
    // Block URLs with userinfo (SSRF via http://evil@target.com)
    if (parsed.username || parsed.password) {
      return { valid: false, reason: 'URL contains userinfo credentials' };
    }
    const hostname = parsed.hostname;
    // Block localhost
    if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
      return { valid: false, reason: 'Localhost blocked' };
    }
    // Block *.localhost subdomains
    if (hostname.endsWith('.localhost')) {
      return { valid: false, reason: 'Localhost subdomain is not allowed' };
    }
    // Check if hostname is an IP
    if (isValidIP(hostname)) {
      if (isPrivateIP(hostname)) {
        return { valid: false, reason: `Private IP blocked: ${hostname}` };
      }
    }
    // Check IPv6 private ranges
    if (hostname.includes(':')) {
      if (isPrivateIPv6(hostname)) {
        return { valid: false, reason: `Private IPv6 blocked: ${hostname}` };
      }
      // Handle IPv4-mapped IPv6
      const v4MappedMatch = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
      if (v4MappedMatch && isPrivateIP(v4MappedMatch[1])) {
        return { valid: false, reason: `Private IP (IPv4-mapped) blocked: ${v4MappedMatch[1]}` };
      }
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }
}

function validateScanUrlConfigs(urlConfigs: UrlConfig[]): { valid: UrlConfig[]; invalid: { url: string; reason: string }[] } {
  const valid: UrlConfig[] = [];
  const invalid: { url: string; reason: string }[] = [];
  for (const uc of urlConfigs) {
    const result = validateScanUrl(uc.url);
    if (result.valid) {
      valid.push(uc);
    } else {
      invalid.push({ url: uc.url, reason: result.reason || 'Unknown error' });
    }
  }
  return { valid, invalid };
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Track task results in memory
const taskResults = new Map<string, ScanResultData[]>();
const taskProgress = new Map<string, ScanProgress>();
const taskLogs = new Map<string, LogEntry[]>();

// Periodic cleanup of expired tasks
const TASK_TTL = 3600_000; // 1 hour
const CLEANUP_INTERVAL = 15 * 60 * 1000; // 15 minutes

setInterval(() => {
  const now = Date.now();
  for (const [id, progress] of taskProgress) {
    if (progress.completedAt && now - progress.completedAt > TASK_TTL) {
      taskResults.delete(id);
      taskProgress.delete(id);
      taskLogs.delete(id);
      console.log(`Cleaned up expired task: ${id}`);
    }
  }
}, CLEANUP_INTERVAL);

const PORT = 3003;

// Create HTTP server with REST API support
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
      activeTasks: taskResults.size,
      uptime: Math.floor(process.uptime()),
    }));
    return;
  }

  // REST API: Start a scan
  if (url === '/api/scan' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { taskId, request } = JSON.parse(body);

      if (!taskId || !request || !request.urls) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing taskId or request' }));
        return;
      }

      // SSRF validation: validate all scan URLs before proceeding
      const urlValidation = validateScanUrlConfigs(request.urls);
      if (urlValidation.invalid.length > 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Invalid URLs detected',
          invalidUrls: urlValidation.invalid,
        }));
        return;
      }

      // Use only validated URLs
      request.urls = urlValidation.valid;

      console.log(`[REST] Scan task started: ${taskId}, URLs: ${request.urls.length}`);
      taskResults.set(taskId, []);
      taskLogs.set(taskId, []);

      // Execute scan asynchronously
      const onProgress = (progress: ScanProgress) => {
        taskProgress.set(taskId, progress);
        try { io.emit('scan:progress', progress); } catch {}
      };

      const onResult = (result: ScanResultData) => {
        const existing = taskResults.get(taskId) || [];
        existing.push(result);
        taskResults.set(taskId, existing);
        try {
          const serialized = JSON.parse(safeStringify({ taskId, result }));
          io.emit('scan:result', serialized);
        } catch (emitErr) {
          console.error('[REST] Failed to emit result via socket:', emitErr);
        }
      };

      const onLog = (log: LogEntry) => {
        const existing = taskLogs.get(taskId) || [];
        existing.push(log);
        taskLogs.set(taskId, existing);
        try {
          const serialized = JSON.parse(safeStringify({ taskId, ...log }));
          io.emit('scan:log', serialized);
        } catch (emitErr) {
          console.error('[REST] Failed to emit log via socket:', emitErr);
        }
      };

      executeScan(taskId, request, onProgress, onResult, onLog).catch((err) => {
        console.error(`[REST] Scan task error: ${taskId}`, err);
      });

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId, status: 'started' }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  // REST API: Stop a scan
  if (url.startsWith('/api/scan/stop/') && req.method === 'POST') {
    const taskId = url.split('/').pop();
    if (taskId) {
      const stopped = stopTask(taskId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId, stopped }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing taskId' }));
    }
    return;
  }

  // REST API: Get scan results
  if (url.startsWith('/api/scan/results/') && req.method === 'GET') {
    const taskId = url.split('/').pop();
    if (taskId) {
      try {
        const results = taskResults.get(taskId) || [];
        const progress = taskProgress.get(taskId);
        const logs = taskLogs.get(taskId) || [];
        
        // Serialize with error handling for large results
        const responseData = safeStringify({ taskId, results, progress, logs });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(responseData);
      } catch (err) {
        console.error('[REST] Error serializing results:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to serialize results' }));
      }
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing taskId' }));
    }
    return;
  }

  // REST API: Poll scan status (lightweight)
  if (url.startsWith('/api/scan/status/') && req.method === 'GET') {
    const taskId = url.split('/').pop();
    if (taskId) {
      const progress = taskProgress.get(taskId);
      const results = taskResults.get(taskId) || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        taskId,
        progress: progress || { taskId, totalUrls: 0, completedUrls: 0, progress: 0, status: 'pending' },
        resultCount: results.length,
        isRunning: isTaskRunning(taskId),
      }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing taskId' }));
    }
    return;
  }

  // 404 for everything else (but don't interfere with socket.io)
  if (!url.startsWith('/socket.io')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Helper: Safe JSON serialization that handles Date objects and other non-serializable values
function safeStringify(obj: any): string {
  return JSON.stringify(obj, (key, value) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  });
}

// Helper to read request body
function readBody(req: IncomingMessage, maxSize: number = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxSize) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Attach Socket.io to the same HTTP server
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

  socket.on('scan:start', (data: { taskId: string; request: ScanRequest }) => {
    const { taskId, request } = data;

    // ── Input validation: clamp values to safe ranges ──────────────────────
    if (request.concurrency) {
      request.concurrency = Math.max(1, Math.min(50, request.concurrency));
    }
    if (request.timeout) {
      request.timeout = Math.max(1000, Math.min(60000, request.timeout));
    }
    if (!Array.isArray(request.urls) || request.urls.length === 0) {
      socket.emit('scan:error', { taskId, error: 'URL列表不能为空' });
      return;
    }

    // SSRF validation: validate all scan URLs before proceeding
    const urlValidation = validateScanUrlConfigs(request.urls);
    if (urlValidation.invalid.length > 0) {
      socket.emit('scan:error', {
        taskId,
        error: 'Invalid URLs detected',
        invalidUrls: urlValidation.invalid,
      });
      return;
    }

    // Use only validated URLs
    request.urls = urlValidation.valid;

    console.log(`[WS] Scan task started: ${taskId}, URLs: ${request.urls.length}`);

    taskResults.set(taskId, []);
    taskLogs.set(taskId, []);

    const onProgress = (progress: ScanProgress) => {
      taskProgress.set(taskId, progress);
      try {
        const s = JSON.parse(safeStringify(progress));
        io.emit('scan:progress', s);
      } catch {}
    };

    const onResult = (result: ScanResultData) => {
      const existing = taskResults.get(taskId) || [];
      existing.push(result);
      taskResults.set(taskId, existing);
      try {
        const s = JSON.parse(safeStringify({ taskId, result }));
        io.emit('scan:result', s);
      } catch {}
    };

    const onLog = (log: LogEntry) => {
      const existing = taskLogs.get(taskId) || [];
      existing.push(log);
      taskLogs.set(taskId, existing);
      try {
        const s = JSON.parse(safeStringify({ taskId, ...log }));
        io.emit('scan:log', s);
      } catch {}
    };

    executeScan(taskId, request, onProgress, onResult, onLog).catch((err) => {
      console.error(`[WS] Scan task error: ${taskId}`, err);
      try {
        io.emit('scan:error', { taskId, error: (err as Error).message || String(err) });
      } catch {}
    });
  });

  socket.on('scan:stop', (data: { taskId: string }) => {
    const stopped = stopTask(data.taskId);
    if (stopped) {
      try { io.emit('scan:stopped', { taskId: data.taskId }); } catch {}
    }
  });

  socket.on('scan:getProgress', (data: { taskId: string }) => {
    const progress = taskProgress.get(data.taskId);
    socket.emit('scan:progress', progress || { taskId: data.taskId, totalUrls: 0, completedUrls: 0, progress: 0, status: 'pending' });
  });

  socket.on('scan:getResults', (data: { taskId: string }) => {
    const results = taskResults.get(data.taskId) || [];
    socket.emit('scan:results', { taskId: data.taskId, results });
  });

  socket.on('scan:getLogs', (data: { taskId: string }) => {
    const logs = taskLogs.get(data.taskId) || [];
    socket.emit('scan:logs', { taskId: data.taskId, logs });
  });

  socket.on('health', (cb) => {
    if (typeof cb === 'function') {
      cb({ status: 'ok', activeTasks: taskResults.size });
    }
  });

  // Handle custom heartbeat ping from client
  socket.on('ping', () => {
    socket.emit('pong');
  });

  socket.on('disconnect', (reason) => {
    console.log(`[WS] Client disconnected: ${socket.id} (${reason})`);
  });

  socket.on('error', (error) => {
    console.error(`[WS] Socket error (${socket.id}):`, error.message);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Scan Engine running on port ${PORT} (HTTP + WebSocket)`);
  console.log(`Process PID: ${process.pid}`);
});

// Keep process alive - Bun may exit if event loop appears empty
setInterval(() => {}, 30000);

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
