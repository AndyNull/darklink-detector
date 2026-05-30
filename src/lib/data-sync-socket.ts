'use client';

import { io, Socket } from 'socket.io-client';

type DataSyncConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type DataSyncStatusCallback = (status: DataSyncConnectionStatus) => void;

let socket: Socket | null = null;
const statusListeners = new Set<DataSyncStatusCallback>();

function notifyStatus(status: DataSyncConnectionStatus) {
  statusListeners.forEach(cb => cb(status));
}

export function onDataSyncStatusChange(cb: DataSyncStatusCallback): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

export function getDataSyncStatus(): DataSyncConnectionStatus {
  if (!socket) return 'disconnected';
  if (socket.connected) return 'connected';
  return 'disconnected';
}

export function getDataSyncSocket(): Socket {
  if (!socket) {
    // 通过 Next.js API 路由代理到数据同步服务 (port 3004)
    // 路径 /api/socket-proxy/data-sync/socket.io 会被代理到 http://localhost:3004/socket.io
    // 使用 polling 传输，确保通过 API 代理时连接稳定可靠
    socket = io('/', {
      path: '/api/socket-proxy/data-sync/socket.io',
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
      console.log('Data-sync socket connected:', socket?.id);
      notifyStatus('connected');
      // Subscribe to all data channels on connect (including malicious-entries)
      socket?.emit('subscribe', ['threat-intel', 'sync-tasks', 'schedule', 'malicious-stats', 'malicious-entries']);
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        console.warn('Data-sync socket disconnected by server');
      }
      notifyStatus('disconnected');
    });

    socket.on('connect_error', (error) => {
      errorCount++;
      if (errorCount === 1) {
        console.warn('Data-sync socket connection error:', error.message, '— will retry automatically');
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

export function disconnectDataSyncSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    notifyStatus('disconnected');
  }
}
