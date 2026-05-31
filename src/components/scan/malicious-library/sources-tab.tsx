'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Search, Shield, CheckCircle2, Loader2, Key, Clock, ExternalLink } from 'lucide-react';
import { getAuthHeaders, useAuth } from '@/lib/auth-context';
import { useDataSyncStore } from '@/lib/data-sync-store';
import { fetchThreatIntelSources, invalidateThreatIntelCache } from '@/lib/api-client';
import { SourceInfo, QUERY_ONLY_SOURCES } from './types';

export function ThreatIntelSourcesTab({ domainTotal, ipTotal, onRefresh }: {
  domainTotal: number;
  ipTotal: number;
  onRefresh: () => void;
}) {
  const { isAuthenticated, requireAuth } = useAuth();
  const dataSync = useDataSyncStore();
  const { maliciousStats } = dataSync;

  const [allSources, setAllSources] = useState<SourceInfo[]>([]);
  const [apiSummary, setApiSummary] = useState<{ totalDomains: number; totalIps: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncTaskId, setSyncTaskId] = useState<string | null>(null);
  const [collectingSource, setCollectingSource] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Filter out query-only sources — they don't contribute bulk data to the malicious library
  // Also sort: "manual" and "scan" sources go to the bottom of the list
  const sources = useMemo(() => {
    const filtered = allSources.filter(s => !QUERY_ONLY_SOURCES.has(s.id) && !s.queryOnly);
    // Sort: manual/scan to the bottom, rest in original order
    const systemSources = ['manual', 'scan'];
    return [...filtered.filter(s => !systemSources.includes(s.id)), ...filtered.filter(s => systemSources.includes(s.id))];
  }, [allSources]);

  // Use api-client's cached fetch for threat intel sources
  const fetchSources = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      const data = await fetchThreatIntelSources(forceRefresh);
      setAllSources((data.sources || []) as SourceInfo[]);
      setApiSummary(data.summary || null);
    } catch (err) {
      console.error('Failed to fetch threat intel sources:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources, domainTotal, ipTotal]);

  // Poll for sync task completion
  useEffect(() => {
    if (!syncTaskId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/threat-intel/update?taskId=${syncTaskId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'completed') {
          setSyncing(false);
          setSyncTaskId(null);
          setLastUpdate(`同步完成: ${new Date().toLocaleString()}`);
          onRefresh();
          // Invalidate cache and re-fetch with fresh data
          invalidateThreatIntelCache();
          fetchSources(true);
        } else if (data.status === 'failed') {
          setSyncing(false);
          setSyncTaskId(null);
          setLastUpdate(`同步失败: ${data.error || '未知错误'}`);
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [syncTaskId, onRefresh, fetchSources]);

  const handleSync = async () => {
    // Sync requires authentication
    if (!isAuthenticated) {
      requireAuth(() => {});
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch('/api/threat-intel/update', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLastUpdate(`同步失败: ${data.error || '已有同步任务运行中'}`);
        setSyncing(false);
        return;
      }
      const data = await res.json();
      setSyncTaskId(data.taskId);
      setLastUpdate('同步中...');
    } catch (err) {
      setLastUpdate('同步失败: 网络错误');
      setSyncing(false);
    }
  };

  const handleCollectSource = async (sourceId: string) => {
    // Collecting requires authentication
    if (!isAuthenticated) {
      requireAuth(() => {});
      return;
    }
    setCollectingSource(sourceId);
    try {
      const res = await fetch('/api/threat-intel/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ source: sourceId }),
      });
      if (res.ok) {
        const data = await res.json();
        setLastUpdate(`源 ${sourceId} 收集任务已提交，详细进度请在"设置→数据同步"中查看`);
        // Poll for completion
        if (data.taskId) {
          setSyncTaskId(data.taskId);
        }
      } else {
        setLastUpdate(`收集失败`);
      }
    } catch {
      setLastUpdate('收集失败: 网络错误');
    } finally {
      setCollectingSource(null);
    }
  };

  const handleSaveApiKey = async (sourceId: string) => {
    const key = apiKeyInput[sourceId];
    if (!key) return;
    // Saving API key requires authentication
    if (!isAuthenticated) {
      requireAuth(() => {});
      return;
    }
    setSavingKey(sourceId);
    try {
      // Use the correct endpoint: /api/threat-intel-sources (not /api/threat-intel/sources)
      await fetch('/api/threat-intel-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ action: 'save-api-key', sourceId, apiKey: key }),
      });
      setApiKeyInput(prev => {
        const next = { ...prev };
        delete next[sourceId];
        return next;
      });
      // Invalidate cache and force refresh after API key save
      invalidateThreatIntelCache();
      fetchSources(true);
    } catch {
      // ignore
    } finally {
      setSavingKey(null);
    }
  };

  // ──── Source stats (use allSources for accurate totals including query-only + orphan sources) ────
  const manualCount = allSources.reduce((acc, s) => acc + (s.id === 'manual' ? s.totalCount : 0), 0);
  const scanCount = allSources.reduce((acc, s) => acc + (s.id === 'scan' ? s.totalCount : 0), 0);
  const intelCount = allSources.reduce((acc, s) => acc + (s.id !== 'manual' && s.id !== 'scan' ? s.totalCount : 0), 0);

  // Compute totals from allSources for consistency (avoids mismatch with WS/REST totals)
  const sourceTotalDomains = allSources.reduce((acc, s) => acc + s.domainCount, 0);
  const sourceTotalIps = allSources.reduce((acc, s) => acc + s.ipCount, 0);
  const sourceTotalCount = allSources.reduce((acc, s) => acc + s.totalCount, 0);

  // Use API summary total as the primary source (most accurate), fall back to allSources sum, then WS/REST
  const displayTotal = apiSummary?.total ?? sourceTotalCount;
  const displayDomainTotal = apiSummary?.totalDomains ?? sourceTotalDomains;
  const displayIpTotal = apiSummary?.totalIps ?? sourceTotalIps;

  const sourceTypeLabels: Record<string, string> = {
    domain: '域名',
    ip: 'IP',
    both: '域名+IP',
  };

  const sourceTypeColors: Record<string, string> = {
    domain: 'bg-blue-500/10 text-blue-600',
    ip: 'bg-orange-500/10 text-orange-600',
    both: 'bg-purple-500/10 text-purple-600',
  };

  const statusColors: Record<string, string> = {
    idle: 'text-muted-foreground',
    running: 'text-primary',
    completed: 'text-green-600',
    error: 'text-destructive',
  };
  const statusLabels: Record<string, string> = {
    idle: '空闲',
    running: '采集中',
    completed: '完成',
    error: '错误',
  };

  return (
    <div className="space-y-3">
      {/* Summary card */}
      <div className="rounded-lg border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium">数据概览</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-primary/5 border p-2 text-center">
            <div className="text-lg font-bold tabular-nums">{displayTotal}</div>
            <div className="text-[10px] text-muted-foreground">总记录</div>
          </div>
          <div className="rounded-md bg-blue-500/5 border p-2 text-center">
            <div className="text-lg font-bold tabular-nums text-blue-600">{displayDomainTotal}</div>
            <div className="text-[10px] text-muted-foreground">恶意域名</div>
          </div>
          <div className="rounded-md bg-orange-500/5 border p-2 text-center">
            <div className="text-lg font-bold tabular-nums text-orange-600">{displayIpTotal}</div>
            <div className="text-[10px] text-muted-foreground">恶意IP</div>
          </div>
        </div>
        {/* Source breakdown */}
        <div className="flex items-center gap-3 mt-2 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-0.5"><Plus className="h-2.5 w-2.5" />手动: {manualCount}</span>
          <span className="flex items-center gap-0.5"><Search className="h-2.5 w-2.5" />扫描: {scanCount}</span>
          <span className="flex items-center gap-0.5"><Shield className="h-2.5 w-2.5" />情报: {intelCount}</span>
        </div>
        {lastUpdate && (
          <div className="text-[10px] text-green-600 mt-1.5 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {lastUpdate}
          </div>
        )}
      </div>

      {/* Update command hint */}
      <div className="rounded-md border bg-muted/30 p-2.5">
        <div className="text-[10px] font-medium mb-1">💡 完整更新命令</div>
        <code className="text-[10px] font-mono bg-background px-2 py-1 rounded border block">
          bun scripts/seed-threat-intel.ts
        </code>
        <div className="text-[9px] text-muted-foreground mt-1">
          支持参数: --quick (快速模式) / --dry-run (试运行不写入)
        </div>
      </div>

      {/* Source list */}
      <div className="text-[10px] font-medium text-muted-foreground mb-1">可批量同步的情报源</div>
      <div className="text-[9px] text-muted-foreground/70 mb-1.5">
        仅展示可批量同步的情报源。仅查询类源（微步/VirusTotal/AbuseIPDB）因调用频率限制不适合批量抓取，请在「设置 → 情报源」中查询。
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          <span className="text-xs">加载中...</span>
        </div>
      ) : (
        <div className="space-y-1">
          {sources.map((source) => (
            <div
              key={source.id}
              className="rounded-md border px-2.5 py-2 flex items-center gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium">{source.name}</span>
                  <Badge
                    variant="outline"
                    className={`text-[8px] px-1 py-0 ${sourceTypeColors[source.type] || ''}`}
                  >
                    {sourceTypeLabels[source.type] || source.type}
                  </Badge>
                  {/* Status badge */}
                  {source.status && source.status !== 'idle' && (
                    <Badge variant="outline" className={`text-[8px] px-1 py-0 ${statusColors[source.status] || ''}`}>
                      {statusLabels[source.status] || source.status}
                    </Badge>
                  )}
                  {/* API key indicator */}
                  {source.needsApiKey && (
                    <Badge variant="outline" className={`text-[8px] px-1 py-0 ${source.apiKeyConfigured ? 'border-green-500/50 text-green-600' : 'border-yellow-500/50 text-yellow-600'}`}>
                      <Key className="h-2 w-2 mr-0.5" />
                      {source.apiKeyConfigured ? '已配置' : '未配置'}
                    </Badge>
                  )}
                </div>
                <div className="text-[9px] text-muted-foreground mt-0.5">{source.description}</div>
                {/* Last update time */}
                {source.lastUpdated && (
                  <div className="text-[8px] text-muted-foreground flex items-center gap-0.5 mt-0.5">
                    <Clock className="h-2 w-2" />
                    更新: {new Date(source.lastUpdated).toLocaleString('zh-CN')}
                  </div>
                )}
                {/* API key input — only shown when authenticated */}
                {isAuthenticated && source.needsApiKey && !source.apiKeyConfigured && (
                  <div className="flex items-center gap-1 mt-1">
                    <Input
                      placeholder="输入API Key..."
                      value={apiKeyInput[source.id] || ''}
                      onChange={(e) => setApiKeyInput(prev => ({ ...prev, [source.id]: e.target.value }))}
                      className="h-5 text-[9px] flex-1"
                      type="password"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-5 text-[9px] px-1.5 shrink-0"
                      onClick={() => handleSaveApiKey(source.id)}
                      disabled={savingKey === source.id || !apiKeyInput[source.id]}
                    >
                      {savingKey === source.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : '保存'}
                    </Button>
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs font-bold tabular-nums">{source.totalCount}</div>
                <div className="text-[8px] text-muted-foreground">
                  {source.domainCount > 0 && `${source.domainCount}域`}
                  {source.domainCount > 0 && source.ipCount > 0 && '/'}
                  {source.ipCount > 0 && `${source.ipCount}IP`}
                </div>
              </div>
              {source.url && (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
