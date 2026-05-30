'use client';

/**
 * Data Sync Store — REST API polling version
 *
 * Replaces the previous Socket.io-based implementation with smart REST API polling.
 * This eliminates the need for Socket.io polling through the API proxy, which was
 * causing:
 * 1. Excessive HTTP requests (Socket.io polling every 1-5 seconds)
 * 2. Unreliable connections (tasks flashing and disappearing)
 * 3. Network request explosion
 *
 * Polling intervals:
 * - Active sync tasks (running/pending): 5 seconds
 * - Idle (no active tasks): 60 seconds
 * - Source stats: 120 seconds
 * - Schedule: 120 seconds
 */

import { create } from 'zustand';
import { getAuthHeaders } from '@/lib/auth-context';

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface ThreatIntelSourceStat {
  sourceId: string;
  enabled: boolean;
  entryCount: number;
  domainCount: number;
  ipCount: number;
  totalCount: number;
}

export interface SyncTaskInfo {
  id: string;
  name: string;
  sources: string;
  status: string;
  progress: number;
  totalSources: number;
  completedSources: number;
  failedSources: number;
  results: string | null;
  message: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
}

export interface ScheduleInfo {
  enabled: boolean;
  frequency: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: string;
}

export interface MaliciousStats {
  domainCount: number;
  ipCount: number;
  lastUpdated: number;
}

// ─── Polling Intervals ─────────────────────────────────────────────────────────

const ACTIVE_POLL_INTERVAL = 5_000;   // 5s when sync tasks are active
const IDLE_POLL_INTERVAL = 60_000;    // 60s when idle
const STATS_POLL_INTERVAL = 120_000;  // 120s for source stats & schedule
const STATS_FAST_INTERVAL = 30_000;   // 30s for stats when tasks just completed

// ─── Store Interface ───────────────────────────────────────────────────────────

interface DataSyncStore {
  // Data
  threatIntelSources: ThreatIntelSourceStat[];
  syncTasks: SyncTaskInfo[];
  schedule: ScheduleInfo | null;
  maliciousStats: MaliciousStats;

  // Loading states
  loadingTasks: boolean;
  loadingSources: boolean;

  // Last updated timestamps
  lastUpdated: {
    threatIntelSources: number;
    syncTasks: number;
    schedule: number;
    maliciousStats: number;
  };

  // Initialization
  initialized: boolean;

  // Actions
  init: () => void;
  destroy: () => void;
  refreshSyncTasks: () => Promise<void>;
  refreshSources: () => Promise<void>;
  refreshSchedule: () => Promise<void>;
  refreshMaliciousStats: () => Promise<void>;
  refreshAll: () => Promise<void>;

  // Helpers
  hasActiveTasks: () => boolean;

  // Internal
  _pollTimer: ReturnType<typeof setInterval> | null;
  _statsTimer: ReturnType<typeof setInterval> | null;
  _startPolling: () => void;
  _stopPolling: () => void;
  _pollTick: () => void;
  _statsTick: () => void;
}

// ─── Visibility Handler (module-level for cleanup) ──────────────────────────

let _visibilityHandler: (() => void) | null = null;

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useDataSyncStore = create<DataSyncStore>((set, get) => ({
  // Data
  threatIntelSources: [],
  syncTasks: [],
  schedule: null,
  maliciousStats: { domainCount: 0, ipCount: 0, lastUpdated: 0 },

  // Loading states
  loadingTasks: false,
  loadingSources: false,

  // Last updated
  lastUpdated: {
    threatIntelSources: 0,
    syncTasks: 0,
    schedule: 0,
    maliciousStats: 0,
  },

  // Init
  initialized: false,

  // Internal
  _pollTimer: null,
  _statsTimer: null,

  // ─── Actions ────────────────────────────────────────────────────────────────

  init: () => {
    const state = get();
    if (state.initialized) return;

    set({ initialized: true });

    // Initial data fetch
    get().refreshAll();

    // Start polling
    get()._startPolling();
  },

  destroy: () => {
    get()._stopPolling();
    set({
      initialized: false,
      threatIntelSources: [],
      syncTasks: [],
      schedule: null,
      maliciousStats: { domainCount: 0, ipCount: 0, lastUpdated: 0 },
      lastUpdated: {
        threatIntelSources: 0,
        syncTasks: 0,
        schedule: 0,
        maliciousStats: 0,
      },
    });
  },

  refreshSyncTasks: async () => {
    try {
      const res = await fetch('/api/sync-tasks');
      if (res.ok) {
        const data = await res.json();
        const tasks = (data.tasks || []).map((t: any) => ({
          ...t,
          progress: typeof t.progress === 'number' ? t.progress : parseFloat(t.progress) || 0,
        }));
        set({
          syncTasks: tasks,
          lastUpdated: { ...get().lastUpdated, syncTasks: Date.now() },
        });
      } else if (res.status === 401) {
        window.dispatchEvent(new CustomEvent('auth-session-expired'));
      }
    } catch {
      // Silently fail - will retry on next poll tick
    }
  },

  refreshSources: async () => {
    set({ loadingSources: true });
    try {
      // Fetch from both endpoints to get full data
      const [statsRes, dbSourcesRes] = await Promise.all([
        fetch('/api/threat-intel/sources').catch(() => null),
        fetch('/api/threat-intel-sources', { headers: getAuthHeaders() }).catch(() => null),
      ]);

      const statsData = statsRes?.ok ? await statsRes.json() : { sources: [] };
      const dbSourcesData = dbSourcesRes?.ok ? await dbSourcesRes.json() : { sources: [] };

      const liveSources: Array<{
        id: string; domainCount: number; ipCount: number; totalCount: number;
        enabled?: boolean; entryCount?: number;
      }> = statsData.sources || [];
      const dbSources: Array<{ sourceId: string; enabled: number | boolean; entryCount: number }> = dbSourcesData.sources || [];

      // Build a map from DB sources for enabled state
      const dbMap = new Map(dbSources.map((s: any) => [s.sourceId, s]));

      // Build combined source stats
      const combined: ThreatIntelSourceStat[] = liveSources.map((s) => {
        const dbEntry = dbMap.get(s.id);
        return {
          sourceId: s.id,
          enabled: dbEntry ? !!dbEntry.enabled : true,
          entryCount: dbEntry?.entryCount || s.totalCount || 0,
          domainCount: s.domainCount || 0,
          ipCount: s.ipCount || 0,
          totalCount: s.totalCount || 0,
        };
      });

      // Add any DB sources not in the live stats
      const liveIds = new Set(liveSources.map(s => s.id));
      for (const [sourceId, dbEntry] of dbMap) {
        if (!liveIds.has(sourceId)) {
          combined.push({
            sourceId,
            enabled: !!dbEntry.enabled,
            entryCount: dbEntry.entryCount || 0,
            domainCount: 0,
            ipCount: 0,
            totalCount: 0,
          });
        }
      }

      set({
        threatIntelSources: combined,
        loadingSources: false,
        lastUpdated: { ...get().lastUpdated, threatIntelSources: Date.now() },
      });
    } catch {
      set({ loadingSources: false });
    }
  },

  refreshSchedule: async () => {
    try {
      const res = await fetch('/api/threat-intel/schedule');
      if (res.ok) {
        const data = await res.json();
        set({
          schedule: data.schedule || null,
          lastUpdated: { ...get().lastUpdated, schedule: Date.now() },
        });
      }
    } catch {
      // Silently fail
    }
  },

  refreshMaliciousStats: async () => {
    try {
      const res = await fetch('/api/threat-intel/sources');
      if (res.ok) {
        const data = await res.json();
        const summary = data.summary || {};
        set({
          maliciousStats: {
            domainCount: summary.totalDomains || 0,
            ipCount: summary.totalIps || 0,
            lastUpdated: Date.now(),
          },
          lastUpdated: { ...get().lastUpdated, maliciousStats: Date.now() },
        });
      }
    } catch {
      // Silently fail
    }
  },

  refreshAll: async () => {
    await Promise.all([
      get().refreshSyncTasks(),
      get().refreshSources(),
      get().refreshSchedule(),
      get().refreshMaliciousStats(),
    ]);
  },

  hasActiveTasks: () => {
    return get().syncTasks.some(t => t.status === 'running' || t.status === 'pending');
  },

  // ─── Polling ────────────────────────────────────────────────────────────────

  _startPolling: () => {
    get()._stopPolling(); // Clear any existing timers

    // Main poll: sync tasks (fast when active, slow when idle)
    const scheduleNextPoll = () => {
      const hasActive = get().hasActiveTasks();
      const interval = hasActive ? ACTIVE_POLL_INTERVAL : IDLE_POLL_INTERVAL;
      const timer = setTimeout(() => {
        get()._pollTick();
        scheduleNextPoll();
      }, interval);
      set({ _pollTimer: timer as any });
    };

    // Stats poll: slower, for source stats and schedule
    const scheduleNextStatsPoll = () => {
      const timer = setTimeout(() => {
        get()._statsTick();
        scheduleNextStatsPoll();
      }, STATS_POLL_INTERVAL);
      set({ _statsTimer: timer as any });
    };

    // Visibility-based pausing: stop timers when tab is hidden, resume when visible
    const handleVisibility = () => {
      if (document.hidden) {
        // Pause: clear timers
        const { _pollTimer, _statsTimer } = get();
        if (_pollTimer) clearTimeout(_pollTimer);
        if (_statsTimer) clearTimeout(_statsTimer);
        set({ _pollTimer: null, _statsTimer: null });
      } else {
        // Resume: immediately poll and restart scheduling
        get()._pollTick();
        get()._statsTick();
        scheduleNextPoll();
        scheduleNextStatsPoll();
      }
    };

    // Store handler reference for cleanup
    _visibilityHandler = handleVisibility;
    document.addEventListener('visibilitychange', handleVisibility);

    scheduleNextPoll();
    scheduleNextStatsPoll();
  },

  _stopPolling: () => {
    const { _pollTimer, _statsTimer } = get();
    if (_pollTimer) {
      clearTimeout(_pollTimer);
      set({ _pollTimer: null });
    }
    if (_statsTimer) {
      clearTimeout(_statsTimer);
      set({ _statsTimer: null });
    }
    // Remove visibility listener
    if (_visibilityHandler) {
      document.removeEventListener('visibilitychange', _visibilityHandler);
      _visibilityHandler = null;
    }
  },

  _pollTick: async () => {
    await get().refreshSyncTasks();

    // Also refresh malicious stats if there are active tasks
    if (get().hasActiveTasks()) {
      get().refreshMaliciousStats();
    }
  },

  _statsTick: async () => {
    await Promise.all([
      get().refreshSources(),
      get().refreshSchedule(),
      get().refreshMaliciousStats(),
    ]);
  },
}));
