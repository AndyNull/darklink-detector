'use client';

import { io, Socket } from 'socket.io-client';

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

type StatusCallback = (status: ConnectionStatus) => void;

let socket: Socket | null = null;
const statusListeners = new Set<StatusCallback>();

function notifyStatus(status: ConnectionStatus) {
  statusListeners.forEach(cb => cb(status));
}

export function onConnectionStatusChange(cb: StatusCallback): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

export function getConnectionStatus(): ConnectionStatus {
  if (!socket) return 'disconnected';
  if (socket.connected) return 'connected';
  return 'disconnected';
}

export function getSocket(): Socket {
  if (!socket) {
    // 通过 Next.js API 路由代理到扫描引擎 (port 3003)
    // 路径 /api/socket-proxy/scan-engine/socket.io 会被代理到 http://localhost:3003/socket.io
    // 使用 polling 传输，确保通过 API 代理时连接稳定可靠
    socket = io('/', {
      path: '/api/socket-proxy/scan-engine/socket.io',
      transports: ['polling'],
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    let errorCount = 0;

    // ─── Heartbeat mechanism ──────────────────────────────────────────────────
    // Send a heartbeat ping every 25s to detect dead connections early.
    // If no pong is received within 10s, the connection is considered dead.
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

    function startHeartbeat() {
      stopHeartbeat();
      heartbeatInterval = setInterval(() => {
        if (socket?.connected) {
          // Set a timeout to detect missing pong
          heartbeatTimeout = setTimeout(() => {
            console.warn('[Socket] Heartbeat timeout — no pong received, connection may be dead');
            // Force reconnect if no pong received
            socket?.disconnect();
            socket?.connect();
          }, 10_000);
          socket.emit('ping');
        }
      }, 25_000);
    }

    function stopHeartbeat() {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
      }
    }

    socket.on('connect', () => {
      errorCount = 0;
      console.log('Socket connected:', socket?.id);
      notifyStatus('connected');
      startHeartbeat();
    });

    socket.on('pong', () => {
      // Connection is alive — clear the heartbeat timeout
      if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
      }
    });

    socket.on('disconnect', (reason) => {
      stopHeartbeat();
      if (reason === 'io server disconnect') {
        console.warn('[Socket] Server initiated disconnect, reconnecting in 2s...');
        setTimeout(() => {
          if (socket && !socket.connected) socket.connect();
        }, 2000);
      }
      notifyStatus('disconnected');
    });

    socket.on('connect_error', (error) => {
      stopHeartbeat();
      errorCount++;
      if (errorCount === 1) {
        console.warn('Socket connection error:', error.message, '— will retry automatically');
      }
      notifyStatus('disconnected');
    });

    socket.on('reconnecting', () => {
      notifyStatus('connecting');
    });

    notifyStatus('connecting');
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    notifyStatus('disconnected');
  }
}
