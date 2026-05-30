import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Server } from 'socket.io';
import { executeScan, stopTask, isTaskRunning } from './scan-engine';
import type { ScanRequest, ScanResultData, ScanProgress, LogEntry } from './types';

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
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

      console.log(`[REST] Scan task started: ${taskId}, URLs: ${request.urls.length}`);
      taskResults.set(taskId, []);
      taskLogs.set(taskId, []);

      // Execute scan asynchronously
      const onProgress = (progress: ScanProgress) => {
        taskProgress.set(taskId, progress);
        try { io.emit('scan:progress', progress); } catch {}
      };

      const onResult = (result: ScanResultData) => {
        taskResults.set(taskId, [...(taskResults.get(taskId) || []), result]);
        try {
          const serialized = JSON.parse(safeStringify({ taskId, result }));
          io.emit('scan:result', serialized);
        } catch (emitErr) {
          console.error('[REST] Failed to emit result via socket:', emitErr);
        }
      };

      const onLog = (log: LogEntry) => {
        taskLogs.set(taskId, [...(taskLogs.get(taskId) || []), log]);
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
    origin: '*',
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
      taskResults.set(taskId, [...(taskResults.get(taskId) || []), result]);
      try {
        const s = JSON.parse(safeStringify({ taskId, result }));
        io.emit('scan:result', s);
      } catch {}
    };

    const onLog = (log: LogEntry) => {
      taskLogs.set(taskId, [...(taskLogs.get(taskId) || []), log]);
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
