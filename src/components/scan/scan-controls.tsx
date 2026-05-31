'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useScanStore } from '@/lib/scan-store';
import { startScan, stopScan, pollScanUntilComplete, discoverSublinks } from '@/lib/scan-api';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Play,
  Square,
  RotateCcw,
  Settings2,
  Plus,
  X,
  Network,
  Layers,
} from 'lucide-react';
import { useEngineStatusStore } from '@/lib/engine-status-store';
import { toast } from 'sonner';

/**
 * Compact inline scan controls - renders as a single row:
 * [⚙全局] | [▶开始扫描] [↺重置]
 *
 * All settings (sublink, concurrency, timeout, headers, body) are in the global popover.
 */
export function CompactScanControls({ onReset }: { onReset?: () => void }) {
  const isMobile = useIsMobile();
  const {
    urls,
    concurrency,
    timeout,
    globalHeaders,
    globalBody,
    setConcurrency,
    setTimeout: setStoreTimeout,
    setGlobalHeaders,
    setGlobalBody,
    taskId,
    scanStatus,
    isScanning,
    setIsScanning,
    setTaskId,
    setScanStatus,
    setProgress,
    addResult,
    addLog,
    addUrl,
    resetScan,
    setAutoNavigateToResults,
    sublinkEnabled,
    sublinkDepth,
    sublinkStatus,
    setSublinkEnabled,
    setSublinkDepth,
    setSublinkStatus,
    setSublinkProgress,
    resetSublinkScan,
  } = useScanStore();

  const pollRef = useRef<{ stop: () => void } | null>(null);
  const engineStatus = useEngineStatusStore((s) => s.scanEngineStatus);

  // AbortController for sublink discovery (allows cancellation)
  const sublinkAbortRef = useRef<AbortController | null>(null);

  const handleStartScan = useCallback(async () => {
    const enabledUrls = urls.filter(u => u.enabled);
    if (enabledUrls.length === 0) return;

    // If sublink scanning is enabled, discover sublinks first
    if (sublinkEnabled) {
      try {
        setSublinkStatus('discovering');

        // Create abort controller for sublink discovery
        const sublinkAbort = new AbortController();
        sublinkAbortRef.current = sublinkAbort;

        const initialSourcesProgress: Array<{
          url: string;
          hostname: string;
          sublinkCount: number;
          status: 'pending' | 'discovering' | 'done' | 'error';
        }> = enabledUrls.map(u => ({
          url: u.url,
          hostname: '',
          sublinkCount: 0,
          status: 'pending' as const,
        }));

        setSublinkProgress({
          sourceUrl: '',
          discovered: 0,
          scanned: 0,
          total: 0,
          sublinks: [],
          sourcesProgress: initialSourcesProgress,
          discoveryStartTime: Date.now(),
        });

        const discoveredSet = new Set<string>();
        // Pre-populate with existing URLs to prevent adding duplicates
        for (const u of urls) {
          try {
            // Normalize URL for dedup (remove trailing slash, fragment)
            const normalized = u.url.replace(/\/+$/, '').split('#')[0];
            discoveredSet.add(normalized);
          } catch {
            discoveredSet.add(u.url);
          }
        }
        const sourcesProgress = [...initialSourcesProgress];

        // Parallel sublink discovery with concurrency control (max 3 concurrent)
        const SUBLINK_CONCURRENCY = 3;
        const executing = new Set<Promise<void>>();

        // Track discovery timing for ETA estimation
        const discoveryTimings: number[] = [];

        const discoverOne = async (index: number) => {
          if (sublinkAbort.signal.aborted) return;

          const sourceUrl = enabledUrls[index].url;
          sourcesProgress[index] = { ...sourcesProgress[index], status: 'discovering' };
          setSublinkProgress(prev => prev ? {
            ...prev,
            sourceUrl,
            sourcesProgress: [...sourcesProgress],
          } : null);

          const MAX_DISCOVERY_RETRIES = 2;
          let lastError: Error | null = null;
          const discoverStart = Date.now();

          // Exponential backoff delays: normal (2s, 4s) and rate-limit (5s, 10s)
          const NORMAL_BACKOFF_MS = [2000, 4000];
          const RATE_LIMIT_BACKOFF_MS = [5000, 10000];

          const isRateLimitError = (err: Error) => {
            const msg = err.message.toLowerCase();
            return msg.includes('429') || msg.includes('rate') || msg.includes('too many');
          };

          for (let attempt = 0; attempt <= MAX_DISCOVERY_RETRIES; attempt++) {
            try {
              // Pass the sublink depth from settings
              const result = await discoverSublinks(sourceUrl, 200, sublinkDepth);

              if (sublinkAbort.signal.aborted) return;

              sourcesProgress[index] = {
                url: sourceUrl,
                hostname: result.hostname,
                sublinkCount: result.count,
                status: 'done',
              };
              // Add discovered sublinks using Set for O(1) dedup
              let newCount = 0;
              for (const sublink of result.sublinks) {
                if (!discoveredSet.has(sublink)) {
                  discoveredSet.add(sublink);
                  addUrl(sublink, 'GET');
                  newCount++;
                }
              }
              lastError = null;
              // Record successful discovery timing for ETA
              discoveryTimings.push(Date.now() - discoverStart);
              break; // success
            } catch (err) {
              lastError = err as Error;
              if (attempt < MAX_DISCOVERY_RETRIES && !sublinkAbort.signal.aborted) {
                const isRateLimited = isRateLimitError(lastError);
                const backoffMs = isRateLimited
                  ? RATE_LIMIT_BACKOFF_MS[attempt] ?? 10000
                  : NORMAL_BACKOFF_MS[attempt] ?? 4000;
                addLog({
                  level: 'info',
                  message: isRateLimited
                    ? `子链发现遇到限流，${backoffMs / 1000}s后重试... (${sourceUrl})`
                    : `子链发现重试中，${backoffMs / 1000}s后重试... (${sourceUrl})`,
                  timestamp: new Date(),
                });
                await new Promise(r => setTimeout(r, backoffMs));
              }
            }
          }

          if (lastError) {
            if (sublinkAbort.signal.aborted) return;

            sourcesProgress[index] = {
              url: sourceUrl,
              hostname: new URL(sourceUrl).hostname,
              sublinkCount: 0,
              status: 'error',
            };
            addLog({ level: 'warn', message: `子链发现失败 (${sourceUrl}): ${lastError.message}`, timestamp: new Date() });
          }

          // Calculate ETA for discovery phase
          const doneSources = sourcesProgress.filter(s => s.status === 'done' || s.status === 'error').length;
          const remainingSources = sourcesProgress.length - doneSources;
          let eta: number | undefined;
          if (discoveryTimings.length > 0 && remainingSources > 0) {
            const avgTime = discoveryTimings.reduce((a, b) => a + b, 0) / discoveryTimings.length;
            eta = Math.round(avgTime * remainingSources);
          }

          setSublinkProgress(prev => prev ? {
            ...prev,
            discovered: discoveredSet.size,
            sublinks: [...discoveredSet],
            sourcesProgress: [...sourcesProgress],
            eta,
          } : null);
        };

        for (let i = 0; i < enabledUrls.length; i++) {
          if (sublinkAbort.signal.aborted) break;

          // Add a small delay between starting discovery of different URLs
          // to avoid overwhelming the server
          if (i > 0) {
            await new Promise(r => setTimeout(r, 500));
          }

          const p = discoverOne(i);
          executing.add(p);
          p.finally(() => executing.delete(p));

          if (executing.size >= SUBLINK_CONCURRENCY) {
            await Promise.race(executing);
          }
        }
        await Promise.allSettled([...executing]);

        sublinkAbortRef.current = null;

        if (sublinkAbort.signal.aborted) {
          addLog({ level: 'info', message: '子链发现已被取消', timestamp: new Date() });
          return;
        }

        const allDiscoveredSublinks = [...discoveredSet];
        const existingCount = urls.length; // original URL count before discovery
        const newCount = allDiscoveredSublinks.length - existingCount;
        setSublinkStatus('discovered');
        addLog({ level: 'info', message: `子链发现完成: 共发现 ${allDiscoveredSublinks.length} 个同域名子链 (新增 ${newCount > 0 ? newCount : 0} 个), 挖掘深度: ${sublinkDepth}层`, timestamp: new Date() });
        // Clear ETA since discovery is done
        setSublinkProgress(prev => prev ? { ...prev, eta: undefined } : null);

        if (allDiscoveredSublinks.length === 0) {
          addLog({ level: 'warn', message: '未发现任何同域名子链，将仅扫描原始URL', timestamp: new Date() });
        }
      } catch (err) {
        addLog({ level: 'error', message: `子链发现过程出错: ${(err as Error).message}`, timestamp: new Date() });
        setSublinkStatus('error');
      }
    }

    // Start the actual scan (with or without discovered sublinks)
    // Re-read enabledUrls since sublinks may have been added
    const currentUrls = useScanStore.getState().urls.filter(u => u.enabled);
    if (currentUrls.length === 0) return;

    // Do NOT clear results/logs - new scan results should append to existing ones.
    // Only reset the scan state for the new task.
    const newTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    setTaskId(newTaskId);
    setIsScanning(true);
    setScanStatus('running');
    useScanStore.setState({ scanStartTime: Date.now() });

    // Update sublink progress to scanning phase
    if (sublinkEnabled) {
      setSublinkStatus('scanning');
      setSublinkProgress(prev => prev ? {
        ...prev,
        total: currentUrls.length,
        scanned: 0,
      } : null);
    }

    // Read disabled rules from localStorage
    let disabledRules: string[] = [];
    try {
      const saved = localStorage.getItem('darklink-detection-rules');
      if (saved) {
        const rules: Record<string, boolean> = JSON.parse(saved);
        disabledRules = Object.entries(rules)
          .filter(([, enabled]) => !enabled)
          .map(([key]) => key);
      }
    } catch {}

    try {
      await startScan(newTaskId, {
        urls: currentUrls.map(u => ({
          url: u.url,
          method: u.method,
          headers: { ...globalHeaders, ...u.headers },
          body: u.body || globalBody || undefined,
        })),
        concurrency,
        timeout,
        disabledRules,
      });

      addLog({ level: 'info', message: `扫描任务已提交: ${newTaskId}`, timestamp: new Date() });

      const poller = pollScanUntilComplete(
        newTaskId,
        (progress) => {
          setProgress(progress);

          // Update sublink scanning progress with ETA
          if (sublinkEnabled) {
            const scanEta = progress.estimatedTimeRemaining;
            setSublinkProgress(prev => prev ? {
              ...prev,
              scanned: progress.completedUrls,
              currentUrl: progress.currentUrl,
              eta: scanEta,
            } : null);
          }

          if (progress.status === 'completed' || progress.status === 'stopped') {
            setIsScanning(false);
            setScanStatus(progress.status);
            setAutoNavigateToResults(true);
            if (sublinkEnabled) {
              setSublinkStatus('complete');
            }
            if (progress.status === 'completed') {
              toast.success('扫描完成', { description: `已完成 ${progress.completedUrls || 0}/${progress.totalUrls || 0} 个URL的扫描` });
            }
          }
        },
        (result) => {
          addResult(result);
        },
        (log) => {
          addLog({
            level: log.level || 'info',
            message: log.message,
            detail: log.detail,
            timestamp: new Date(log.timestamp || Date.now()),
          });
        },
        1000,
      );
      pollRef.current = poller;
    } catch (err) {
      addLog({ level: 'error', message: `启动扫描失败: ${(err as Error).message}`, timestamp: new Date() });
      setIsScanning(false);
      setScanStatus('error');
      if (sublinkEnabled) {
        setSublinkStatus('error');
      }
    }
  }, [urls, concurrency, timeout, globalHeaders, globalBody, sublinkEnabled, sublinkDepth, setTaskId, setIsScanning, setScanStatus, setProgress, addResult, addLog, addUrl, setAutoNavigateToResults, setSublinkStatus, setSublinkProgress, setSublinkDepth]);

  const handleStopScan = useCallback(async () => {
    // Cancel sublink discovery if in progress
    if (sublinkAbortRef.current) {
      sublinkAbortRef.current.abort();
      sublinkAbortRef.current = null;
    }

    if (taskId) {
      try {
        await stopScan(taskId);
      } catch {}
      if (pollRef.current) {
        pollRef.current.stop();
        pollRef.current = null;
      }
      setIsScanning(false);
      setScanStatus('stopped');
      toast.info('扫描已停止');
    } else {
      // No scan task yet — just cancel discovery
      setIsScanning(false);
      setScanStatus('idle');
      setSublinkStatus('idle');
    }
  }, [taskId, setIsScanning, setScanStatus, setSublinkStatus]);

  const handleReset = useCallback(() => {
    if (isScanning) return;
    if (pollRef.current) {
      pollRef.current.stop();
      pollRef.current = null;
    }
    // resetScan already sets urls: [], so no need to call clearUrls() separately
    resetScan();
    resetSublinkScan();
    onReset?.();
  }, [isScanning, resetScan, resetSublinkScan, onReset]);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        pollRef.current.stop();
      }
    };
  }, []);

  const timeoutSeconds = timeout / 1000;

  // Count enabled URLs for button disabled state
  const enabledUrlCount = urls.filter(u => u.enabled).length;

  // Count active settings for badge
  const settingsBadge = (sublinkEnabled ? 1 : 0) + (concurrency !== 10 ? 1 : 0) + (timeout !== 15000 ? 1 : 0) + Object.keys(globalHeaders).length + (globalBody.trim() ? 1 : 0);

  return (
    <div className={`flex items-center ${isMobile ? 'gap-1 flex-wrap' : 'gap-2 flex-wrap'}`}>
      {/* Global Settings popover - contains ALL settings */}
      <GlobalSettingsPopover
        sublinkEnabled={sublinkEnabled}
        sublinkDepth={sublinkDepth}
        concurrency={concurrency}
        timeout={timeout}
        globalHeaders={globalHeaders}
        globalBody={globalBody}
        onSublinkEnabledChange={setSublinkEnabled}
        onSublinkDepthChange={setSublinkDepth}
        onConcurrencyChange={setConcurrency}
        onTimeoutChange={setStoreTimeout}
        onHeadersChange={setGlobalHeaders}
        onBodyChange={setGlobalBody}
        disabled={isScanning}
        badge={settingsBadge}
      />

      {/* Start/Stop button */}
      {!isScanning ? (
        <Button
          onClick={handleStartScan}
          disabled={enabledUrlCount === 0 || engineStatus === 'offline'}
          className={`h-7 gap-1 text-[10px] ${isMobile ? 'px-2' : 'px-2'} shrink-0`}
          size="sm"
        >
          <Play className="h-3 w-3" />
          {isMobile ? '开始' : '开始扫描'}
        </Button>
      ) : (
        <Button
          onClick={handleStopScan}
          variant="destructive"
          className={`h-7 gap-1 text-[10px] ${isMobile ? 'px-2' : 'px-2'} shrink-0`}
          size="sm"
        >
          <Square className="h-3 w-3" />
          停止
        </Button>
      )}

      {/* Reset button (only when not scanning) */}
      {!isScanning && (
        <Button variant="outline" size="sm" onClick={handleReset} className="h-7 gap-1 text-[10px] px-1.5 shrink-0">
          <RotateCcw className="h-3 w-3" />
          {!isMobile && '重置'}
        </Button>
      )}
    </div>
  );
}

/** Global settings popover - unified settings panel for ALL scan configuration */
function GlobalSettingsPopover({
  sublinkEnabled,
  sublinkDepth,
  concurrency,
  timeout,
  globalHeaders,
  globalBody,
  onSublinkEnabledChange,
  onSublinkDepthChange,
  onConcurrencyChange,
  onTimeoutChange,
  onHeadersChange,
  onBodyChange,
  disabled,
  badge,
}: {
  sublinkEnabled: boolean;
  sublinkDepth: number;
  concurrency: number;
  timeout: number;
  globalHeaders: Record<string, string>;
  globalBody: string;
  onSublinkEnabledChange: (enabled: boolean) => void;
  onSublinkDepthChange: (depth: number) => void;
  onConcurrencyChange: (val: number) => void;
  onTimeoutChange: (val: number) => void;
  onHeadersChange: (headers: Record<string, string>) => void;
  onBodyChange: (body: string) => void;
  disabled?: boolean;
  badge: number;
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [open, setOpen] = useState(false);
  const timeoutSeconds = timeout / 1000;

  const addHeader = () => {
    if (newKey.trim()) {
      onHeadersChange({ ...globalHeaders, [newKey.trim()]: newValue.trim() });
      setNewKey('');
      setNewValue('');
    }
  };

  const removeHeader = (key: string) => {
    const copy = { ...globalHeaders };
    delete copy[key];
    onHeadersChange(copy);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-[10px] px-2 shrink-0"
          disabled={disabled}
        >
          <Settings2 className="h-3 w-3" />
          全局
          {badge > 0 && (
            <span className="ml-0.5 bg-primary text-primary-foreground rounded-full size-3.5 flex items-center justify-center text-[8px] font-bold leading-none">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-3 max-h-[70vh] overflow-y-auto" align="start">
        <div className="space-y-3">
          {/* ── Section 1: Sublink Mining ── */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Network className="h-3.5 w-3.5 text-primary" />
              <span className="text-[11px] font-semibold">子链挖掘</span>
            </div>

            {/* Sublink toggle + Depth (compact row when enabled) */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">启用子链挖掘</span>
              <Switch
                checked={sublinkEnabled}
                onCheckedChange={onSublinkEnabledChange}
                disabled={disabled}
                className="scale-75 origin-right"
              />
            </div>

            {/* Depth selector (only visible when sublink is enabled) */}
            {sublinkEnabled && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Layers className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground">挖掘深度</span>
                </div>
                <Select
                  value={String(sublinkDepth)}
                  onValueChange={(v) => onSublinkDepthChange(Number(v))}
                  disabled={disabled}
                >
                  <SelectTrigger size="sm" className="h-7 w-[72px] text-[11px] px-2 [&>svg]:size-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map(n => (
                      <SelectItem key={n} value={String(n)} className="text-[11px]">
                        {n}层{n >= 3 ? ' (深)' : n === 2 ? ' (推荐)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Depth explanation */}
            {sublinkEnabled && (
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                {sublinkDepth === 1 ? '仅从输入页面提取子链' :
                 sublinkDepth === 2 ? '从输入页面提取子链，再从子链页面提取更多链接（推荐）' :
                 `递归挖掘${sublinkDepth}层：每层子链页面都会被继续挖掘，层数越多耗时越长。`}
              </p>
            )}
          </div>

          <Separator />

          {/* ── Section 2: Scan Parameters (concurrency + timeout in one row) ── */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold">扫描参数</span>

            <div className="grid grid-cols-2 gap-2">
              {/* Concurrency */}
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">并发数</span>
                <Select
                  value={String(concurrency)}
                  onValueChange={(v) => onConcurrencyChange(Number(v))}
                  disabled={disabled}
                >
                  <SelectTrigger size="sm" className="h-7 w-full text-[11px] px-2 [&>svg]:size-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 5, 10, 15, 20, 25, 30, 40, 50].map(n => (
                      <SelectItem key={n} value={String(n)} className="text-[11px]">{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Timeout */}
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">超时时间</span>
                <Select
                  value={String(timeoutSeconds)}
                  onValueChange={(v) => onTimeoutChange(Number(v) * 1000)}
                  disabled={disabled}
                >
                  <SelectTrigger size="sm" className="h-7 w-full text-[11px] px-2 [&>svg]:size-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[3, 5, 10, 15, 20, 30, 45, 60].map(n => (
                      <SelectItem key={n} value={String(n)} className="text-[11px]">{n}s</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Section 3: Global Headers & Body ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold">请求设置</span>
              <span className="text-[10px] text-muted-foreground/60">应用于所有URL</span>
            </div>

            {/* Existing headers */}
            {Object.entries(globalHeaders).map(([key, value]) => (
              <div key={key} className="flex gap-1 items-center h-7">
                <Input className="h-7 text-[11px] font-mono flex-1 min-w-0" value={key} readOnly />
                <Input className="h-7 text-[11px] font-mono flex-1 min-w-0" value={value} readOnly />
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeHeader(key)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}

            {/* Add header row */}
            <div className="flex gap-1 items-center h-7">
              <Input
                placeholder="Header名"
                className="h-7 text-[11px] font-mono flex-1 min-w-0 placeholder:text-[10px]"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addHeader()}
              />
              <Input
                placeholder="值"
                className="h-7 text-[11px] font-mono flex-1 min-w-0 placeholder:text-[10px]"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addHeader()}
              />
              <Button variant="outline" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={addHeader} disabled={!newKey.trim()}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>

            {/* Global body */}
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground">全局请求体</span>
              <Textarea
                className="h-16 text-[11px] font-mono placeholder:text-[10px]"
                value={globalBody}
                onChange={(e) => onBodyChange(e.target.value)}
                placeholder="默认请求体（单URL body优先）..."
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Export engine status hook for the sidebar — uses centralized auto-polling
// from the engine-status-store singleton to avoid duplicate polling requests
export function useEngineStatus() {
  const scanEngineStatus = useEngineStatusStore((s) => s.scanEngineStatus);

  useEffect(() => {
    const unsubscribe = useEngineStatusStore.getState().startAutoPolling();
    return unsubscribe;
  }, []);

  return scanEngineStatus;
}
