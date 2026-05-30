'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  RefreshCw,
  Download,
  Pause,
  Play,
  X,
  Trash2,
} from 'lucide-react';
import { useAuth, getAuthHeaders } from '@/lib/auth-context';
import { toast } from 'sonner';
import { useDataSyncStore } from '@/lib/data-sync-store';
import { SyncTaskInfo, SYNC_STATUS_CONFIG } from './types';

// Smooth progress bar component that interpolates between values
function SmoothProgressBar({ value, status, failedSources, completedSources }: {
  value: number;
  status: string;
  failedSources: number;
  completedSources: number;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValueRef = useRef(value);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;

    // If the value jumped significantly (like 0 → 50 or 50 → 100),
    // animate it smoothly over ~700ms
    if (Math.abs(value - prev) > 1) {
      const startTime = performance.now();
      const duration = 700; // ms
      const startVal = displayValue;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = startVal + (value - startVal) * eased;
        setDisplayValue(current);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };

      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = requestAnimationFrame(animate);
    } else {
      setDisplayValue(value);
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [value]);

  const barColor = status === 'completed' ? 'bg-green-500'
    : failedSources > completedSources ? 'bg-red-500'
    : 'bg-primary';

  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full ${barColor}`}
        style={{
          width: `${Math.max(0, Math.min(100, displayValue))}%`,
          transition: displayValue > 0 ? 'none' : undefined,
        }}
      />
    </div>
  );
}

export function SyncProgressSection() {
  const { requireAuth, isAuthenticated } = useAuth();
  const dataSync = useDataSyncStore();
  const { syncTasks } = dataSync;

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Initialize data-sync store on first render
  useEffect(() => {
    if (!dataSync.initialized) {
      dataSync.init();
    }
  }, [dataSync]);

  // Compute corrected tasks: treat recently-created 'pending' tasks as 'running'
  // to prevent the brief "paused" flash between creation and the first poll
  const tasks = syncTasks.map(t => {
    if (t.status === 'pending') {
      const age = Date.now() - new Date(t.createdAt).getTime();
      if (age < 30_000) { // Within 30 seconds of creation, treat pending as running
        return { ...t, status: 'running', message: t.message || '准备开始采集...' };
      }
    }
    return t;
  }) as SyncTaskInfo[];

  // Mark as loaded once we have any data
  useEffect(() => {
    if (syncTasks.length >= 0) {
      setLoading(false);
    }
  }, [syncTasks.length]);

  const fetchTasks = useCallback(async () => {
    await dataSync.refreshSyncTasks();
  }, [dataSync]);

  const handleAction = async (taskId: string, action: 'pause' | 'resume' | 'cancel' | 'delete') => {
    if (!requireAuth(() => {})) return;
    setActionLoading(taskId + action);
    try {
      if (action === 'delete') {
        const res = await fetch(`/api/sync-tasks/${taskId}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (res.ok) {
          toast.success('任务已删除');
          fetchTasks();
        } else {
          const data = await res.json();
          toast.error(data.error || '删除失败');
        }
      } else {
        const res = await fetch(`/api/sync-tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ action }),
        });
        if (res.ok) {
          const actionLabels: Record<string, string> = { pause: '暂停', resume: '恢复', cancel: '取消' };
          toast.success(`任务已${actionLabels[action]}`);
          fetchTasks();
        } else {
          const data = await res.json();
          toast.error(data.error || '操作失败');
        }
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setActionLoading(null);
    }
  };

  const formatTime = (isoStr: string | null) => {
    if (!isoStr) return '-';
    try {
      return new Date(isoStr).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { return isoStr; }
  };

  const parseSources = (sourcesStr: string): string[] => {
    try { return JSON.parse(sourcesStr); } catch { return []; }
  };

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Download className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium">同步任务进度</span>
          {tasks.length > 0 && (
            <Badge variant="outline" className="text-[8px] px-1 py-0">
              {tasks.filter(t => t.status === 'running').length} 运行中
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-[10px] h-6 gap-1 px-2"
          onClick={() => fetchTasks()}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          刷新
        </Button>
      </div>

      {loading && tasks.length === 0 ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          <span className="text-xs">加载任务...</span>
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <Download className="h-6 w-6 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">暂无同步任务</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            在"情报源配置"中点击同步后，任务进度将在此处显示
          </p>
        </div>
      ) : (
        <div className="space-y-2 flex-1 min-h-0 overflow-y-auto">
          {tasks.map(task => {
            const cfg = SYNC_STATUS_CONFIG[task.status] || SYNC_STATUS_CONFIG.pending;
            const StatusIcon = cfg.icon;
            const sourceList = parseSources(task.sources);
            const isActive = task.status === 'running' || task.status === 'pending';
            const isPaused = task.status === 'paused';

            return (
              <div key={task.id} className={`rounded border px-3 py-2 space-y-1.5 ${isActive ? 'border-primary/20 bg-primary/[0.02]' : ''}`}>
                {/* Header: name + status + actions */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <StatusIcon className={`h-3 w-3 shrink-0 ${cfg.color} ${task.status === 'running' ? 'animate-spin' : ''}`} />
                  <span className="text-[11px] font-medium truncate flex-1">{task.name}</span>
                  <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 ${cfg.bg} ${cfg.color} border-0`}>
                    {cfg.label}
                  </Badge>
                  {/* Action buttons */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    {isActive && (
                      <Button
                        variant="ghost" size="sm" className="h-6 w-6 p-0 cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
                        onClick={() => handleAction(task.id, 'pause')}
                        disabled={!!actionLoading}
                        title="暂停"
                      >
                        {actionLoading === task.id + 'pause' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                      </Button>
                    )}
                    {isPaused && (
                      <Button
                        variant="ghost" size="sm" className="h-6 w-6 p-0 cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
                        onClick={() => handleAction(task.id, 'resume')}
                        disabled={!!actionLoading}
                        title="恢复"
                      >
                        {actionLoading === task.id + 'resume' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      </Button>
                    )}
                    {(isActive || isPaused) && (
                      <Button
                        variant="ghost" size="sm" className="h-6 w-6 p-0 cursor-pointer transition-colors text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => handleAction(task.id, 'cancel')}
                        disabled={!!actionLoading}
                        title="取消"
                      >
                        {actionLoading === task.id + 'cancel' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                      </Button>
                    )}
                    {!isActive && (
                      <Button
                        variant="ghost" size="sm" className="h-6 w-6 p-0 cursor-pointer transition-colors text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => handleAction(task.id, 'delete')}
                        disabled={!!actionLoading}
                        title="删除"
                      >
                        {actionLoading === task.id + 'delete' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {(isActive || task.status === 'completed') && (
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                      <span>{task.completedSources}/{task.totalSources} 源完成{task.failedSources > 0 ? `, ${task.failedSources} 失败` : ''}</span>
                      <span className="tabular-nums">{Math.round(task.progress)}%</span>
                    </div>
                    <SmoothProgressBar
                      value={task.progress}
                      status={task.status}
                      failedSources={task.failedSources}
                      completedSources={task.completedSources}
                    />
                  </div>
                )}

                {/* Real-time progress message */}
                {task.message && isActive && (
                  <div className="text-[9px] text-primary/70 truncate animate-pulse" title={task.message}>
                    {task.message}
                  </div>
                )}
                {/* Completion message for finished tasks */}
                {task.message && !isActive && task.status === 'completed' && (
                  <div className="text-[9px] text-green-600/70 truncate" title={task.message}>
                    {task.message}
                  </div>
                )}

                {/* Source results - show new counts */}
                {task.results ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {(() => {
                      try {
                        const results = JSON.parse(task.results);
                        return results.map((r: any, idx: number) => {
                          // domains/ips = network IOC additions (MaliciousDomain/MaliciousIP tables)
                          // entries = ThreatIntelEntry additions (same data in a different table — DO NOT double-count)
                          // Show domains + ips as the primary count to avoid inflated numbers
                          const newDomains = r.domains || 0;
                          const newIps = r.ips || 0;
                          const totalNew = newDomains + newIps;
                          return (
                            <span key={idx} className="inline-flex items-center gap-0.5">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 bg-muted/50">
                                {r.sourceId}
                              </Badge>
                              {r.skipped && totalNew === 0 ? (
                                <span className="text-[10px] text-muted-foreground">无数据</span>
                              ) : r.error ? (
                                <span className="text-[10px] text-red-500 truncate max-w-[120px]" title={r.error}>失败</span>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] px-1.5 py-0 shrink-0 border-0 tabular-nums ${
                                    totalNew > 0
                                      ? 'bg-green-500/10 text-green-600'
                                      : 'text-muted-foreground bg-muted/30'
                                  }`}
                                >
                                  新增{totalNew}
                                </Badge>
                              )}
                            </span>
                          );
                        });
                      } catch {
                        return null;
                      }
                    })()}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 flex-wrap">
                    {sourceList.slice(0, 8).map(s => (
                      <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        {s}
                      </Badge>
                    ))}
                    {sourceList.length > 8 && (
                      <span className="text-[10px] text-muted-foreground">+{sourceList.length - 8}</span>
                    )}
                  </div>
                )}

                {/* Time info */}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
                  <span>创建: {formatTime(task.createdAt)}</span>
                  {task.completedAt && <span>完成: {formatTime(task.completedAt)}</span>}
                </div>

                {/* Error message */}
                {task.error && (
                  <div className="text-[9px] text-red-500 truncate" title={task.error}>
                    错误: {task.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
