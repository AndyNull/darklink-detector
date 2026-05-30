'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Wifi,
  WifiOff,
  Loader2,
  Play,
  Power,
  RotateCw,
  Server,
  Microchip,
  Database,
  HelpCircle,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getAuthHeaders } from '@/lib/auth-context';
import { useEngineStatusStore } from '@/lib/engine-status-store';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EngineServiceStatus {
  status: 'online' | 'offline';
  port: number;
  uptime?: number;
  activeTasks?: number;
  connectedClients?: number;
}

interface EngineStatus {
  scanEngine: EngineServiceStatus;
  dataSyncService: EngineServiceStatus;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds?: number): string {
  if (seconds === undefined || seconds === null) return '--';
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}时${mins}分`;
}

// ─── Service Card Component ──────────────────────────────────────────────────

function ServiceCard({
  label,
  icon: Icon,
  status,
  port,
  uptime,
  extra,
  onStart,
  onStop,
  loading,
}: {
  label: string;
  icon: React.ElementType;
  status: 'online' | 'offline' | 'checking';
  port: number;
  uptime?: number;
  extra?: string;
  onStart: () => void;
  onStop: () => void;
  loading: boolean;
}) {
  const isOnline = status === 'online';
  const isChecking = status === 'checking';
  const [stopDialogOpen, setStopDialogOpen] = useState(false);

  const handleStopClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setStopDialogOpen(true);
  };

  const handleConfirmStop = () => {
    setStopDialogOpen(false);
    onStop();
  };

  return (
    <div className={`rounded border transition-colors ${
      isOnline ? 'border-green-500/30 bg-green-500/5' :
      isChecking ? 'border-yellow-500/30 bg-yellow-500/5' :
      'border-red-500/30 bg-red-500/5'
    }`}>
      {/* Header with status and stop button inline */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${isOnline ? 'text-green-600' : isChecking ? 'text-yellow-500' : 'text-red-500'}`} />
          <span className="text-[11px] font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Status badge */}
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
            isOnline ? 'bg-green-500/10 text-green-600' :
            isChecking ? 'bg-yellow-500/10 text-yellow-500' :
            'bg-red-500/10 text-red-500'
          }`}>
            {isOnline ? (
              <><Wifi className="h-2.5 w-2.5" /> 在线</>
            ) : isChecking ? (
              <><Loader2 className="h-2.5 w-2.5 animate-spin" /> 检测中</>
            ) : (
              <><WifiOff className="h-2.5 w-2.5" /> 离线</>
            )}
          </span>
          {/* Stop button - red outlined, next to status badge, only when online */}
          {isOnline && (
            <button
              onClick={handleStopClick}
              disabled={loading}
              className="inline-flex items-center justify-center h-5 px-1.5 rounded text-[9px] font-medium border border-red-500/40 text-red-600/80 bg-transparent hover:bg-red-500/10 hover:text-red-600 active:bg-red-500/25 active:text-red-700 transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title="停止服务"
            >
              {loading ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Power className="h-2.5 w-2.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">端口</span>
          <span className="font-mono">{port}</span>
        </div>
        {isOnline && uptime !== undefined && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">运行时间</span>
            <span>{formatUptime(uptime)}</span>
          </div>
        )}
        {extra && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">{extra.split(':')[0]}</span>
            <span>{extra.split(':').slice(1).join(':')}</span>
          </div>
        )}
        {/* Hint for offline services */}
        {!isOnline && !isChecking && (
          <div className="pt-1">
            <Button
              size="sm"
              className="h-6 text-[10px] px-2 gap-1 bg-green-600 hover:bg-green-700 text-white border-0 w-full"
              onClick={onStart}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              启动
            </Button>
          </div>
        )}
      </div>

      {/* Stop confirmation dialog */}
      <AlertDialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <AlertDialogContent className="max-w-[340px]">
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center h-8 w-8 rounded-full bg-red-500/10">
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </div>
              <AlertDialogTitle className="text-base">确认停止服务</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm pl-10">
              确定要停止 <strong>{label}</strong> 吗？停止后相关功能将不可用，直到手动重新启动。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmStop}
              className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white border-0"
            >
              确认停止
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Engine Section ─────────────────────────────────────────────────────

export function EngineSection() {
  const { requireAuth } = useAuth();
  const scanEngineStatus = useEngineStatusStore((s) => s.scanEngineStatus);
  const dataSyncStatus = useEngineStatusStore((s) => s.dataSyncStatus);
  const scanEngineDetails = useEngineStatusStore((s) => s.scanEngineDetails);
  const dataSyncDetails = useEngineStatusStore((s) => s.dataSyncDetails);
  const refreshDetails = useEngineStatusStore((s) => s.refreshDetails);
  const refreshStatus = useEngineStatusStore((s) => s.refreshStatus);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [globalLoading, setGlobalLoading] = useState(false);

  // Refresh full status on mount, then lightweight details every 60 seconds
  // (online/offline status is also kept up to date via WebSocket in useEngineStatus hook)
  useEffect(() => {
    refreshStatus().catch(() => {});
    const interval = setInterval(() => {
      refreshDetails().catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [refreshStatus, refreshDetails]);

  const handleStart = async (service: 'scan-engine' | 'data-sync-service') => {
    if (!requireAuth(() => {})) return;

    setLoading(prev => ({ ...prev, [service]: true }));
    try {
      const res = await fetch('/api/engine/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ service }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        toast.success(`${data.service === 'scan-engine' ? '扫描引擎' : '数据同步服务'}启动成功 (PID: ${data.pid})`);
        // Use refreshStatus() to update online/offline status immediately after starting
        setTimeout(() => refreshStatus(), 1500);
        // Second check after a bit more time to ensure service is fully up
        setTimeout(() => refreshStatus(), 4000);
      } else {
        toast.error(data.error || '启动失败');
      }
    } catch (err) {
      toast.error('启动请求失败');
    } finally {
      setLoading(prev => ({ ...prev, [service]: false }));
    }
  };

  const handleStop = async (service: 'scan-engine' | 'data-sync-service') => {
    if (!requireAuth(() => {})) return;

    setLoading(prev => ({ ...prev, [service]: true }));
    try {
      const res = await fetch('/api/engine/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ service }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        toast.success(`${data.service === 'scan-engine' ? '扫描引擎' : '数据同步服务'}已停止`);
        // Use refreshStatus() to update online/offline status immediately after stopping
        setTimeout(() => refreshStatus(), 1000);
      } else {
        toast.error(data.error || '停止失败');
      }
    } catch (err) {
      toast.error('停止请求失败');
    } finally {
      setLoading(prev => ({ ...prev, [service]: false }));
    }
  };

  const handleStartAll = async () => {
    if (!requireAuth(() => {})) return;

    setLoading(prev => ({ ...prev, all: true }));
    try {
      const res = await fetch('/api/engine/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ service: 'all' }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        toast.success('所有服务已启动');
        // Use refreshStatus() to update online/offline status after starting all
        setTimeout(() => refreshStatus(), 1500);
        setTimeout(() => refreshStatus(), 4000);
      } else {
        toast.error(data.error || '启动失败');
      }
    } catch (err) {
      toast.error('启动请求失败');
    } finally {
      setLoading(prev => ({ ...prev, all: false }));
    }
  };

  const handleRefresh = async () => {
    setGlobalLoading(true);
    try {
      // Use refreshStatus() to update both status AND details on manual refresh
      await refreshStatus();
    } finally {
      setGlobalLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Description */}
      <div className="text-[11px] text-muted-foreground space-y-1.5">
        <p>
          引擎是系统的核心服务进程，负责执行扫描任务和数据同步。当引擎离线时，相关功能将不可用。
        </p>
        <div className="rounded border border-border/50 bg-muted/30 px-2.5 py-1.5 space-y-1">
          <div className="flex items-start gap-1.5">
            <HelpCircle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
            <span className="text-[10px]">
              <strong>扫描引擎</strong>：执行暗链检测扫描任务的核心服务（内部端口 3003）
            </span>
          </div>
          <div className="flex items-start gap-1.5">
            <HelpCircle className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
            <span className="text-[10px]">
              <strong>数据同步服务</strong>：负责威胁情报数据的同步和推送（内部端口 3004）
            </span>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] px-2.5 gap-1"
          onClick={handleRefresh}
          disabled={globalLoading}
        >
          <RotateCw className={`h-3 w-3 ${globalLoading ? 'animate-spin' : ''}`} />
          刷新状态
        </Button>
        <Button
          variant="default"
          size="sm"
          className="h-7 text-[10px] px-2.5 gap-1"
          onClick={handleStartAll}
          disabled={loading.all || (scanEngineStatus === 'online' && dataSyncStatus === 'online')}
        >
          {loading.all ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          全部启动
        </Button>
      </div>

      {/* Service Cards */}
      <div className="space-y-2">
        <ServiceCard
          label="扫描引擎"
          icon={Microchip}
          status={scanEngineStatus}
          port={3003}
          uptime={scanEngineDetails?.uptime}
          extra={scanEngineDetails?.activeTasks !== undefined ? `活跃任务:${scanEngineDetails.activeTasks}` : undefined}
          onStart={() => handleStart('scan-engine')}
          onStop={() => handleStop('scan-engine')}
          loading={loading['scan-engine'] ?? false}
        />
        <ServiceCard
          label="数据同步服务"
          icon={Database}
          status={dataSyncStatus}
          port={3004}
          uptime={dataSyncDetails?.uptime}
          extra={dataSyncDetails?.connectedClients !== undefined ? `连接数:${dataSyncDetails.connectedClients}` : undefined}
          onStart={() => handleStart('data-sync-service')}
          onStop={() => handleStop('data-sync-service')}
          loading={loading['data-sync-service'] ?? false}
        />
      </div>

      {/* Warning */}
      {scanEngineStatus === 'offline' && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex items-start gap-2">
          <Server className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-[10px] text-amber-600 space-y-0.5">
            <p className="font-medium">扫描引擎离线</p>
            <p>扫描功能不可用。请点击上方"启动"按钮启动扫描引擎，或联系管理员。</p>
          </div>
        </div>
      )}
    </div>
  );
}
