'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Globe,
  Key,
  Shield,
  Loader2,
  RefreshCw,
  Clock,
  Info,
} from 'lucide-react';
import {
  getSystemConfig,
  setSystemConfig,
  getLastSyncTime,
  setLastSyncTime,
  UPDATE_FREQUENCY_OPTIONS,
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
} from './types';
import { loadApiKey, getSourceStatus } from './helpers';
import { SourceCard } from './source-card';
import { ApiKeyField } from './api-key-field';

export function DataSyncSection() {
  const { requireAuth, isAuthenticated } = useAuth();
  const dataSync = useDataSyncStore();
  const { schedule: wsSchedule, threatIntelSources: wsSources, connected: wsConnected } = dataSync;

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

  // Track if we already fell back to API to avoid redundant calls
  const apiFallbackUsed = useRef(false);

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

  // Use WebSocket schedule data when available, otherwise fall back to API
  useEffect(() => {
    if (wsSchedule && wsConnected) {
      setSchedule(wsSchedule);
      setAutoUpdate(wsSchedule.enabled);
      setUpdateFrequency(wsSchedule.frequency);
      setLoading(false);
    }
  }, [wsSchedule, wsConnected]);

  // Merge WebSocket source stats with STATIC_SOURCES
  useEffect(() => {
    if (wsSources.length > 0 && wsConnected) {
      const sourceMap = new Map(wsSources.map(s => [s.sourceId, s]));
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

      // Update enabled state from WebSocket data
      const synced: Record<string, boolean> = {};
      STATIC_SOURCES.forEach(s => {
        const live = sourceMap.get(s.id);
        synced[s.id] = live ? !!live.enabled : s.status !== 'deprecated';
      });
      setEnabledSources(synced);
      setLoading(false);
    }
  }, [wsSources, wsConnected]);

  // Request refresh when data is stale
  useEffect(() => {
    if (wsConnected && dataSync.isStale('threat-intel')) {
      dataSync.requestRefresh('threat-intel');
    }
    if (wsConnected && dataSync.isStale('schedule')) {
      dataSync.requestRefresh('schedule');
    }
  }, [wsConnected, dataSync]);

  // Fetch live source data via API (fallback)
  const fetchSources = useCallback(async () => {
    // If WebSocket is connected and has data, skip API call
    if (wsConnected && wsSources.length > 0) return;

    setLoading(true);
    try {
      const [statsRes, sourcesRes] = await Promise.all([
        fetch('/api/threat-intel/sources'),
        fetch('/api/threat-intel-sources'),
      ]);
      const data = statsRes.ok ? await statsRes.json() : { sources: [] };
      const sourcesData = sourcesRes.ok ? await sourcesRes.json() : { sources: [] };
      const liveSources: SourceInfo[] = data.sources || [];
      const liveMap = Object.fromEntries(liveSources.map((s: SourceInfo) => [s.id, s]));
      // Build enabled map from database state
      const dbSources: { sourceId: string; enabled: boolean; entryCount: number }[] = sourcesData.sources || [];
      const dbEnabledMap = Object.fromEntries(dbSources.map((s: any) => [s.sourceId, s.enabled]));
      const merged = STATIC_SOURCES.map(staticSrc => {
        const live = liveMap[staticSrc.id];
        if (live) {
          return { ...staticSrc, domainCount: live.domainCount, ipCount: live.ipCount, totalCount: live.totalCount };
        }
        return staticSrc;
      });
      setSources(merged);
      // Sync enabled state from database (only for sources that exist in DB)
      if (Object.keys(dbEnabledMap).length > 0) {
        const synced: Record<string, boolean> = {};
        STATIC_SOURCES.forEach(s => {
          if (s.id in dbEnabledMap) {
            synced[s.id] = dbEnabledMap[s.id];
          } else {
            synced[s.id] = s.status !== 'deprecated';
          }
        });
        setEnabledSources(synced);
      }
    } catch {
      // Fallback to static data
    } finally {
      setLoading(false);
    }
  }, [wsConnected, wsSources]);

  // Fetch schedule from backend (fallback)
  const fetchSchedule = useCallback(async () => {
    // If WebSocket is connected and has schedule data, skip API call
    if (wsConnected && wsSchedule) return;

    try {
      const res = await fetch('/api/threat-intel/schedule');
      if (res.ok) {
        const data = await res.json();
        setSchedule(data.schedule);
        if (data.schedule.enabled !== undefined) {
          setAutoUpdate(data.schedule.enabled);
        }
        if (data.schedule.frequency) {
          setUpdateFrequency(data.schedule.frequency);
        }
      }
    } catch {
      // ignore
    }
  }, [wsConnected, wsSchedule]);

  // Fallback to API when WebSocket not connected
  useEffect(() => {
    if (!wsConnected && !apiFallbackUsed.current) {
      apiFallbackUsed.current = true;
      fetchSources();
      fetchSchedule();
    }
  }, [wsConnected, fetchSources, fetchSchedule]);

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
      const res = await fetch('/api/threat-intel/update', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: [id] }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.taskId || data.syncTaskId) {
          toast.info(`源 ${id} 同步任务已提交`);
          const pollId = data.syncTaskId || data.taskId;
          const pollParam = data.syncTaskId ? 'syncTaskId' : 'taskId';
          const poll = setInterval(async () => {
            try {
              const statusRes = await fetch(`/api/threat-intel/update?${pollParam}=${pollId}`);
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                if (statusData.status === 'completed' || statusData.status === 'failed') {
                  clearInterval(poll);
                  setSyncingSources(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                  fetchSources();
                  if (statusData.status === 'completed') {
                    toast.success(`源 ${id} 同步完成`);
                  } else {
                    toast.error(`源 ${id} 同步失败`);
                  }
                }
              }
            } catch {
              // ignore
            }
          }, 3000);
          return;
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
      const res = await fetch('/api/threat-intel/update', {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: enabledSourceIds.length > 0 ? enabledSourceIds : undefined }),
      });
      if (res.ok) {
        const syncing = new Set(sources.filter(s => enabledSources[s.id]).map(s => s.id));
        setSyncingSources(syncing);
        toast.info('全部同步任务已提交');
        const data = await res.json();
        if (data.taskId || data.syncTaskId) {
          const pollId = data.syncTaskId || data.taskId;
          const pollParam = data.syncTaskId ? 'syncTaskId' : 'taskId';
          const poll = setInterval(async () => {
            try {
              const statusRes = await fetch(`/api/threat-intel/update?${pollParam}=${pollId}`);
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                if (statusData.status === 'completed' || statusData.status === 'failed') {
                  clearInterval(poll);
                  setSyncingSources(new Set());
                  fetchSources();
                  if (statusData.status === 'completed') {
                    toast.success('全部同步完成');
                  } else {
                    toast.error('全部同步失败');
                  }
                }
              }
            } catch {
              // ignore
            }
          }, 3000);
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
      // Refresh schedule via WebSocket or API
      if (wsConnected) {
        dataSync.requestRefresh('schedule');
      } else {
        fetchSchedule();
      }
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
      // Refresh schedule via WebSocket or API
      if (wsConnected) {
        dataSync.requestRefresh('schedule');
      } else {
        fetchSchedule();
      }
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
      // Refresh schedule via WebSocket or API
      if (wsConnected) {
        dataSync.requestRefresh('schedule');
        dataSync.requestRefresh('threat-intel');
      } else {
        fetchSchedule();
      }
      toast.success('手动同步已触发');
    } catch {
      toast.error('手动同步失败');
    } finally {
      setSaving(false);
    }
  };

  const formatTime = (isoStr: string | null) => {
    if (!isoStr) return '从未';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch {
      return isoStr;
    }
  };

  const statusLabels: Record<string, { text: string; color: string }> = {
    idle: { text: '空闲', color: 'text-muted-foreground' },
    running: { text: '运行中', color: 'text-blue-600' },
    completed: { text: '已完成', color: 'text-green-600' },
    failed: { text: '失败', color: 'text-red-500' },
  };

  // Group sources
  const freeSources = sources.filter(s => !API_KEY_SOURCES.has(s.id) && !QUERY_ONLY_SOURCES.has(s.id) && s.status !== 'deprecated');
  const deprecatedSources = sources.filter(s => s.status === 'deprecated');
  const apiKeySources = sources.filter(s => API_KEY_SOURCES.has(s.id) && !QUERY_ONLY_SOURCES.has(s.id));
  const queryOnlySources = sources.filter(s => QUERY_ONLY_SOURCES.has(s.id));

  // Only count as enabled if explicitly set to true in the enabledSources map
  // During loading (before DB data arrives), don't count unknown sources as enabled
  const totalEnabled = sources.filter(s => enabledSources[s.id] === true).length;
  const totalActive = sources.filter(s => getSourceStatus(s, !!apiKeys[s.id], s.totalCount, enabledSources[s.id] === true) === 'active').length;

  return (
    <div className="space-y-4">
      {/* === 情报源列表 === */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">情报源列表</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground">
            已启用 <span className="font-medium text-foreground">{totalEnabled}</span> / {sources.length} 个情报源，
            活跃 <span className="font-medium text-green-600">{totalActive}</span> 个
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-[10px] h-6 gap-1 px-2 cursor-pointer transition-colors"
            onClick={handleSyncAll}
            disabled={syncingSources.size > 0}
          >
            {syncingSources.size > 0 ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            全部同步
          </Button>
        </div>

        {loading && sources.every(s => s.totalCount === 0) ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            <span className="text-xs">加载情报源...</span>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground px-1 flex items-center gap-1">
                <Globe className="h-3 w-3" />
                免费/公开情报源 ({freeSources.length})
              </div>
              {freeSources.map(source => (
                <SourceCard
                  key={source.id}
                  source={source}
                  enabled={enabledSources[source.id] ?? true}
                  onToggle={handleToggleSource}
                  onSync={handleSyncSource}
                  syncing={syncingSources.has(source.id)}
                  apiKeyStatus={apiKeys[source.id] ? 'configured' : 'none'}
                />
              ))}
            </div>

            <div className="space-y-1">
              <div className="text-[10px] font-medium text-muted-foreground px-1 flex items-center gap-1">
                <Key className="h-3 w-3" />
                需API Key (批量+查询) ({apiKeySources.length})
              </div>
              {apiKeySources.map(source => (
                <SourceCard
                  key={source.id}
                  source={source}
                  enabled={enabledSources[source.id] ?? true}
                  onToggle={handleToggleSource}
                  onSync={handleSyncSource}
                  syncing={syncingSources.has(source.id)}
                  apiKeyStatus={apiKeys[source.id] ? 'configured' : 'none'}
                />
              ))}
            </div>

            <div className="space-y-1">
              <div className="text-[10px] font-medium text-blue-600/80 px-1 flex items-center gap-1">
                <Shield className="h-3 w-3" />
                仅查询模式 (有调用频率限制) ({queryOnlySources.length})
              </div>
              {queryOnlySources.map(source => (
                <SourceCard
                  key={source.id}
                  source={source}
                  enabled={enabledSources[source.id] ?? true}
                  onToggle={handleToggleSource}
                  onSync={handleSyncSource}
                  syncing={syncingSources.has(source.id)}
                  apiKeyStatus={apiKeys[source.id] ? 'configured' : 'none'}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* === 同步设置 === */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">同步设置</span>
        </div>

        {/* Auto Update */}
        <div className="rounded border px-3 py-2 space-y-2">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] font-medium">自动更新</span>
            <span className="text-[9px] text-muted-foreground ml-1">定时同步威胁情报源数据</span>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={autoUpdate}
              onCheckedChange={handleToggleAutoUpdate}
              className="scale-75 origin-left cursor-pointer"
            />
            <span className="text-[10px] text-muted-foreground">
              {autoUpdate ? '已启用' : '已关闭'}
            </span>
          </div>
        </div>

        {/* Update Frequency */}
        <div className="rounded border px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] font-medium">更新频率</span>
          </div>
          <Select value={updateFrequency} onValueChange={handleFrequencyChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="选择更新频率" />
            </SelectTrigger>
            <SelectContent>
              {UPDATE_FREQUENCY_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Schedule Status */}
        <div className="rounded border px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Info className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] font-medium">调度状态</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">调度器状态</span>
              <span className={statusLabels[schedule?.status || 'idle']?.color || 'text-muted-foreground'}>
                {statusLabels[schedule?.status || 'idle']?.text || '未知'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">上次更新时间</span>
              <span className="tabular-nums">{formatTime(schedule?.lastRunAt || lastSyncTime)}</span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">下次计划更新</span>
              <span className="tabular-nums">
                {schedule?.nextRunAt && autoUpdate ? formatTime(schedule.nextRunAt) : '-'}
              </span>
            </div>
          </div>
        </div>

        {/* Manual Sync */}
        <div className="rounded border px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] font-medium">手动同步</span>
            <span className="text-[9px] text-muted-foreground ml-1">立即更新威胁情报数据</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[10px] gap-1 w-full"
            onClick={handleManualSync}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            立即同步
          </Button>
        </div>
      </div>

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
