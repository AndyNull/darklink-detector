'use client';

import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { Key, Loader2 } from 'lucide-react';
import {
  getSystemConfig,
  setSystemConfig,
  getLastSyncTime,
  setLastSyncTime,
} from '@/lib/system-config';
import { useAuth, getAuthHeaders } from '@/lib/auth-context';
import { toast } from 'sonner';
import { useDataSyncStore } from '@/lib/data-sync-store';
import {
  SourceInfo,
  ScheduleInfo,
  STATIC_SOURCES,
  API_KEY_CONFIGS,
  QUERY_ONLY_SOURCES,
  API_KEY_SOURCES,
} from '../types';
import { loadApiKey, getSourceStatus } from '../helpers';
import { ApiKeyField } from '../api-key-field';
import { SourceList } from './source-list';
import { ScheduleControls } from './schedule-controls';

export function DataSyncSection() {
  const { requireAuth, isAuthenticated } = useAuth();
  const dataSync = useDataSyncStore();
  const { schedule: storeSchedule, threatIntelSources: storeSources } = dataSync;

  const [sources, setSources] = useState<SourceInfo[]>(STATIC_SOURCES);
  const [enabledSources, setEnabledSources] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [syncingSources, setSyncingSources] = useState<Set<string>>(new Set());
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [updateFrequency, setUpdateFrequency] = useState('daily');
  const [lastSyncTime, setLastSyncTimeDisplay] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiKeyRefreshKey, setApiKeyRefreshKey] = useState(0);

  // Track if we already loaded initial data
  const hasLoadedRef = useRef(false);

  // Initialize data-sync store on first render
  useEffect(() => {
    if (!dataSync.initialized) {
      dataSync.init();
    }
  }, [dataSync]);

  // Initialize enabled state
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    STATIC_SOURCES.forEach(s => {
      initial[s.id] = s.status !== 'deprecated';
    });
    setEnabledSources(initial);
  }, []);

  // Load API keys
  useEffect(() => {
    const keys: Record<string, string> = {};
    API_KEY_SOURCES.forEach(id => {
      keys[id] = loadApiKey(id);
    });
    setApiKeys(keys);
  }, [apiKeyRefreshKey]);

  // Load system config
  useEffect(() => {
    const config = getSystemConfig();
    setAutoUpdate(config.autoUpdate);
    setUpdateFrequency(config.updateFrequency);
    setLastSyncTimeDisplay(getLastSyncTime());
  }, []);

  // Use store schedule data when available
  useEffect(() => {
    if (storeSchedule) {
      setSchedule(storeSchedule);
      setAutoUpdate(storeSchedule.enabled);
      setUpdateFrequency(storeSchedule.frequency);
    }
  }, [storeSchedule]);

  // Merge store source stats with STATIC_SOURCES
  useEffect(() => {
    if (storeSources.length > 0) {
      const sourceMap = new Map(storeSources.map(s => [s.sourceId, s]));
      const merged = STATIC_SOURCES.map(staticSrc => {
        const live = sourceMap.get(staticSrc.id);
        if (live) {
          return {
            ...staticSrc,
            totalCount: live.totalCount || live.entryCount,
            domainCount: live.domainCount,
            ipCount: live.ipCount,
          };
        }
        return staticSrc;
      });
      setSources(merged);

      // Update enabled state from store data
      const synced: Record<string, boolean> = {};
      STATIC_SOURCES.forEach(s => {
        const live = sourceMap.get(s.id);
        synced[s.id] = live ? live.enabled : s.status !== 'deprecated';
      });
      setEnabledSources(synced);
    }
  }, [storeSources]);

  // Fetch live source data via REST API
  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      await dataSync.refreshSources();
    } catch {
      // Fallback to static data
    } finally {
      setLoading(false);
    }
  }, [dataSync]);

  // Fetch schedule from REST API
  const fetchSchedule = useCallback(async () => {
    try {
      await dataSync.refreshSchedule();
    } catch {
      // ignore
    }
  }, [dataSync]);

  // Fetch sources on first load
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      fetchSources();
      fetchSchedule();
    }
  }, [fetchSources, fetchSchedule]);

  const handleToggleSource = async (id: string, enabled: boolean) => {
    setEnabledSources(prev => ({ ...prev, [id]: enabled }));
    // Persist to database
    try {
      await fetch('/api/threat-intel-sources', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', sourceId: id, enabled }),
      });
    } catch {
      // Silently fail - UI state already updated
    }
  };

  const handleSyncSource = async (id: string) => {
    if (!requireAuth(() => {})) return;
    if (QUERY_ONLY_SOURCES.has(id)) {
      toast.info('该情报源仅支持查询模式，不支持批量同步');
      return;
    }
    setSyncingSources(prev => new Set(prev).add(id));
    try {
      const res = await fetch('/api/sync-tasks', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: [id], name: `Sync ${id} ${new Date().toLocaleString('zh-CN')}` }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.info(`源 ${id} 同步任务已提交，详细进度请在"数据同步"中查看`);
        // Refresh sync tasks to show the new task
        dataSync.refreshSyncTasks();

        // Poll for task completion
        const pollId = data.taskId;
        if (pollId) {
          const poll = setInterval(async () => {
            try {
              // Refresh sync tasks to update progress
              await dataSync.refreshSyncTasks();

              // Check if task is done
              const taskRes = await fetch(`/api/sync-tasks/${pollId}`, { headers: getAuthHeaders() });
              if (taskRes.ok) {
                const taskData = await taskRes.json();
                const task = taskData.task;
                if (task && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')) {
                  clearInterval(poll);
                  setSyncingSources(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                  // Refresh all data after completion
                  dataSync.refreshAll();
                  if (task.status === 'completed') {
                    toast.success(`源 ${id} 同步完成`);
                  } else if (task.status === 'failed') {
                    toast.error(`源 ${id} 同步失败`);
                  } else {
                    toast.info(`源 ${id} 同步已取消`);
                  }
                }
              }
            } catch {
              // ignore
            }
          }, 3000);
        }
      } else {
        toast.error(`源 ${id} 同步请求失败`);
      }
    } catch {
      toast.error(`源 ${id} 同步网络错误`);
    }
    setSyncingSources(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleSyncAll = async () => {
    if (!requireAuth(() => {})) return;
    try {
      const enabledSourceIds = sources
        .filter(s => enabledSources[s.id] && !QUERY_ONLY_SOURCES.has(s.id) && s.status !== 'deprecated')
        .map(s => s.id);

      const res = await fetch('/api/sync-tasks', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources: enabledSourceIds.length > 0 ? enabledSourceIds : undefined,
          name: `全部同步 ${new Date().toLocaleString('zh-CN')}`,
        }),
      });

      if (res.ok) {
        const syncing = new Set(sources.filter(s => enabledSources[s.id]).map(s => s.id));
        setSyncingSources(syncing);
        toast.info('全部同步任务已提交，详细进度请在"数据同步"中查看');

        const data = await res.json();
        dataSync.refreshSyncTasks();

        const pollId = data.taskId;
        if (pollId) {
          const poll = setInterval(async () => {
            try {
              await dataSync.refreshSyncTasks();
              const taskRes = await fetch(`/api/sync-tasks/${pollId}`, { headers: getAuthHeaders() });
              if (taskRes.ok) {
                const taskData = await taskRes.json();
                const task = taskData.task;
                if (task && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')) {
                  clearInterval(poll);
                  setSyncingSources(new Set());
                  dataSync.refreshAll();
                  if (task.status === 'completed') {
                    toast.success('全部同步完成');
                  } else if (task.status === 'failed') {
                    toast.error('全部同步失败');
                  } else {
                    toast.info('全部同步已取消');
                  }
                }
              }
            } catch {
              // ignore
            }
          }, 3000);
          // Safety timeout: stop polling after 10 minutes
          setTimeout(() => clearInterval(poll), 600_000);
        }
      } else {
        toast.error('全部同步请求失败');
      }
    } catch {
      toast.error('全部同步网络错误');
      setSyncingSources(new Set());
    }
  };

  const handleToggleAutoUpdate = async (enabled: boolean) => {
    if (!requireAuth(() => {})) return;
    setAutoUpdate(enabled);
    setSystemConfig({ autoUpdate: enabled });
    toast.success(enabled ? '自动更新已启用' : '自动更新已关闭');
    try {
      await fetch('/api/threat-intel/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ enabled }),
      });
      dataSync.refreshSchedule();
    } catch {
      // ignore
    }
  };

  const handleFrequencyChange = async (freq: string) => {
    if (!requireAuth(() => {})) return;
    setUpdateFrequency(freq);
    setSystemConfig({ updateFrequency: freq });
    toast.success('更新频率已更改');
    try {
      await fetch('/api/threat-intel/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ frequency: freq }),
      });
      dataSync.refreshSchedule();
    } catch {
      // ignore
    }
  };

  const handleManualSync = async () => {
    if (!requireAuth(() => {})) return;
    setSaving(true);
    try {
      await fetch('/api/threat-intel/update', { method: 'POST', headers: getAuthHeaders() });
      const now = new Date().toISOString();
      setLastSyncTimeDisplay(now);
      setLastSyncTime(now);
      dataSync.refreshAll();
      toast.success('手动同步已触发');
    } catch {
      toast.error('手动同步失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* === 情报源列表 === */}
      <Suspense fallback={<div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin mr-1.5 text-muted-foreground" /><span className="text-xs text-muted-foreground">加载情报源...</span></div>}>
        <SourceList
          sources={sources}
          enabledSources={enabledSources}
          loading={loading}
          syncingSources={syncingSources}
          apiKeys={apiKeys}
          onToggleSource={handleToggleSource}
          onSyncSource={handleSyncSource}
          onSyncAll={handleSyncAll}
        />
      </Suspense>

      {/* === 同步设置 === */}
      <Suspense fallback={null}>
        <ScheduleControls
          autoUpdate={autoUpdate}
          updateFrequency={updateFrequency}
          schedule={schedule}
          lastSyncTime={lastSyncTime}
          saving={saving}
          onToggleAutoUpdate={handleToggleAutoUpdate}
          onFrequencyChange={handleFrequencyChange}
          onManualSync={handleManualSync}
        />
      </Suspense>

      {/* === API配置 === */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Key className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">API配置</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          配置第三方威胁情报API密钥，配置后可启用对应情报源的数据采集
        </div>
        {API_KEY_CONFIGS.map(config => (
          <ApiKeyField
            key={config.id + apiKeyRefreshKey}
            config={config}
            onSaved={() => setApiKeyRefreshKey(k => k + 1)}
          />
        ))}
      </div>
    </div>
  );
}
