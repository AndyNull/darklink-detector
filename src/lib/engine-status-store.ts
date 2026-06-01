import { create } from 'zustand';

type EngineOnlineStatus = 'online' | 'offline' | 'checking';

interface EngineStatusStore {
  scanEngineStatus: EngineOnlineStatus;
  dataSyncStatus: EngineOnlineStatus;
  // Detailed engine info from HTTP API
  scanEngineDetails: { uptime?: number; activeTasks?: number } | null;
  dataSyncDetails: { uptime?: number; connectedClients?: number } | null;
  // Actions
  setScanEngineStatus: (status: EngineOnlineStatus) => void;
  setDataSyncStatus: (status: EngineOnlineStatus) => void;
  setScanEngineDetails: (details: { uptime?: number; activeTasks?: number } | null) => void;
  setDataSyncDetails: (details: { uptime?: number; connectedClients?: number } | null) => void;
  refreshStatus: () => Promise<void>;
  refreshDetails: () => Promise<void>;
  // Auto-polling management
  startAutoPolling: () => () => void;
}

// Singleton polling state - shared across all subscribers
let pollingIntervalId: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;
let lastPollTime = 0;
const MIN_POLL_INTERVAL = 5000; // Minimum 5s between polls to prevent burst requests

function scheduleNextPoll(getStore: () => EngineStatusStore) {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }

  if (subscriberCount <= 0) return;

  const store = getStore();
  const anyOffline = store.scanEngineStatus === 'offline' || store.dataSyncStatus === 'offline';
  const anyChecking = store.scanEngineStatus === 'checking' || store.dataSyncStatus === 'checking';
  const pollInterval = (anyOffline || anyChecking) ? 30000 : 60000;

  pollingIntervalId = setInterval(() => {
    const now = Date.now();
    if (now - lastPollTime >= MIN_POLL_INTERVAL) {
      lastPollTime = now;
      getStore().refreshStatus().catch(() => {});
    }
  }, pollInterval);
}

export const useEngineStatusStore = create<EngineStatusStore>((set, get) => ({
  scanEngineStatus: 'checking',
  dataSyncStatus: 'checking',
  scanEngineDetails: null,
  dataSyncDetails: null,
  setScanEngineStatus: (status) => set({ scanEngineStatus: status }),
  setDataSyncStatus: (status) => set({ dataSyncStatus: status }),
  setScanEngineDetails: (details) => set({ scanEngineDetails: details }),
  setDataSyncDetails: (details) => set({ dataSyncDetails: details }),

  /**
   * Refresh online/offline status via HTTP API.
   * Used as fallback when WebSocket is not available.
   */
  refreshStatus: async () => {
    try {
      const res = await fetch('/api/engine/status');
      if (res.ok) {
        const data = await res.json();
        set({
          scanEngineStatus: data.scanEngine?.status === 'online' ? 'online' : 'offline',
          dataSyncStatus: data.dataSyncService?.status === 'online' ? 'online' : 'offline',
          scanEngineDetails: data.scanEngine
            ? { uptime: data.scanEngine.uptime, activeTasks: data.scanEngine.activeTasks }
            : null,
          dataSyncDetails: data.dataSyncService
            ? { uptime: data.dataSyncService.uptime, connectedClients: data.dataSyncService.connectedClients }
            : null,
        });

        // Re-schedule polling with appropriate interval based on current status
        scheduleNextPoll(get);
      }
    } catch {
      // Silently fail — keep current status
    }
  },

  /**
   * Refresh only the detailed info (uptime, activeTasks, etc.) via HTTP API.
   * Lighter than refreshStatus — only updates details, not online/offline status.
   */
  refreshDetails: async () => {
    try {
      const res = await fetch('/api/engine/status');
      if (res.ok) {
        const data = await res.json();
        set({
          scanEngineDetails: data.scanEngine
            ? { uptime: data.scanEngine.uptime, activeTasks: data.scanEngine.activeTasks }
            : null,
          dataSyncDetails: data.dataSyncService
            ? { uptime: data.dataSyncService.uptime, connectedClients: data.dataSyncService.connectedClients }
            : null,
        });
      }
    } catch {
      // Silently fail
    }
  },

  /**
   * Start auto-polling for engine status. Returns an unsubscribe function.
   * Uses a singleton pattern so multiple components can share one polling timer.
   */
  startAutoPolling: () => {
    subscriberCount++;

    // Initial refresh
    const now = Date.now();
    if (now - lastPollTime >= MIN_POLL_INTERVAL) {
      lastPollTime = now;
      get().refreshStatus().catch(() => {});
    }

    // Start polling if this is the first subscriber
    if (subscriberCount === 1) {
      scheduleNextPoll(get);
    }

    // Handle visibility change
    const handleVisibility = () => {
      if (document.hidden) {
        if (pollingIntervalId) {
          clearInterval(pollingIntervalId);
          pollingIntervalId = null;
        }
      } else {
        const now2 = Date.now();
        if (now2 - lastPollTime >= MIN_POLL_INTERVAL) {
          lastPollTime = now2;
          get().refreshStatus().catch(() => {});
        }
        scheduleNextPoll(get);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    // Return unsubscribe function
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      subscriberCount--;
      if (subscriberCount <= 0) {
        subscriberCount = 0;
        if (pollingIntervalId) {
          clearInterval(pollingIntervalId);
          pollingIntervalId = null;
        }
      }
    };
  },
}));
