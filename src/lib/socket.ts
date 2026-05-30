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

    socket.on('connect', () => {
      errorCount = 0;
      console.log('Socket connected:', socket?.id);
      notifyStatus('connected');
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        console.warn('Socket disconnected by server — will not auto-reconnect');
      }
      notifyStatus('disconnected');
    });

    socket.on('connect_error', (error) => {
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
