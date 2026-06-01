'use client';

import { useEffect, useState, useCallback } from 'react';
import { useScanStore, TaskHistoryItem, LogEntry } from '@/lib/scan-store';
import { getTaskList, deleteScan, getScanResults, type ApiLogEntry } from '@/lib/scan-api';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  History,
  Trash2,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  BarChart3,
} from 'lucide-react';

interface TaskHistoryPanelProps {
  /** If true, compact mode with max-h-[120px] */
  compact?: boolean;
  /** Callback when user clicks "结果" on a task */
  onViewResults?: (taskId: string) => void;
  /** Callback when user clicks "日志" on a task */
  onViewLogs?: (taskId: string) => void;
  /** Currently expanded/selected task ID */
  expandedTaskId?: string | null;
}

export function TaskHistoryPanel({ compact = false, onViewResults, onViewLogs, expandedTaskId }: TaskHistoryPanelProps) {
  const { taskHistory, setTaskHistory, isScanning, scanStatus } = useScanStore();
  const { requireAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  // Log dialog state
  const [logDialogTaskId, setLogDialogTaskId] = useState<string | null>(null);
  const [taskLogs, setTaskLogs] = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTaskList();
      setTaskHistory(data.tasks || []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [setTaskHistory]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks, isScanning, scanStatus]);

  const handleDelete = useCallback(async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Require auth for deletion
    if (!requireAuth(() => {})) return;
    setDeletingTaskId(taskId);
    try {
      await deleteScan(taskId);
      setTaskHistory(taskHistory.filter(t => t.taskId !== taskId));
    } catch (err) {
      console.error('Failed to delete task:', err);
    } finally {
      setDeletingTaskId(null);
    }
  }, [taskHistory, setTaskHistory]);

  const handleViewLogs = useCallback(async (taskId: string) => {
    if (onViewLogs) {
      onViewLogs(taskId);
      return;
    }
    // Default behavior: open dialog
    setLogDialogTaskId(taskId);
    setLoadingLogs(true);
    try {
      const data = await getScanResults(taskId);
      const logs: LogEntry[] = (data.logs || []).map((l: ApiLogEntry, i: number) => ({
        id: i,
        level: l.level || 'info',
        message: l.message,
        detail: l.detail,
        timestamp: new Date(l.timestamp || Date.now()),
      }));
      setTaskLogs(logs);
    } catch (err) {
      console.error('Failed to load logs:', err);
      setTaskLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, [onViewLogs]);

  const handleViewResults = useCallback(async (taskId: string) => {
    if (onViewResults) {
      onViewResults(taskId);
    }
  }, [onViewResults]);

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="h-3 w-3 text-green-600" />;
      case 'running': return <Loader2 className="h-3 w-3 text-primary animate-spin" />;
      case 'stopped': return <XCircle className="h-3 w-3 text-yellow-600" />;
      case 'error': return <XCircle className="h-3 w-3 text-destructive" />;
      default: return <Clock className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'completed': return '完成';
      case 'running': return '运行中';
      case 'stopped': return '停止';
      case 'error': return '错误';
      default: return status;
    }
  };

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Compact header */}
        <div className="py-1.5 px-3 border-b flex items-center gap-2 shrink-0">
          <History className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium">历史任务 ({taskHistory.length})</span>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[10px] gap-0.5"
              onClick={fetchTasks}
              disabled={loading}
            >
              <RefreshCw className={`h-2.5 w-2.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </div>

        {/* Task list */}
        <div className={`overflow-y-auto custom-scrollbar ${compact ? 'max-h-[96px]' : 'flex-1 min-h-0'}`}>
          {taskHistory.length === 0 ? (
            <div className="text-center text-muted-foreground py-3 text-xs">
              暂无历史任务
            </div>
          ) : (
            <div className="px-2 py-1 space-y-0.5">
              {taskHistory.map((task) => (
                <div
                  key={task.taskId}
                  className={`flex items-center gap-2 rounded px-2 py-1 hover:bg-accent/50 text-[10px] ${
                    expandedTaskId === task.taskId ? 'bg-accent/30 ring-1 ring-primary/20' : ''
                  }`}
                >
                  <div className="shrink-0 flex items-center gap-1">
                    {statusIcon(task.status)}
                    <span>{statusLabel(task.status)}</span>
                  </div>
                  <span className="font-mono text-muted-foreground truncate flex-1" title={task.taskId}>
                    {task.taskId.length > 20 ? `...${task.taskId.slice(-18)}` : task.taskId}
                  </span>
                  <span className="text-muted-foreground shrink-0">{formatTime(task.createdAt)}</span>
                  <span className="shrink-0">{task.urlCount}URL</span>
                  {task.darkLinks > 0 && (
                    <Badge variant="destructive" className="text-[9px] px-1 py-0">{task.darkLinks}暗链</Badge>
                  )}
                  <div className="shrink-0 flex gap-0.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[9px] gap-0.5 px-1"
                      onClick={() => handleViewLogs(task.taskId)}
                      title="查看日志"
                    >
                      <Terminal className="h-2.5 w-2.5" />
                      日志
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[9px] gap-0.5 px-1"
                      onClick={() => handleViewResults(task.taskId)}
                      title="查看结果"
                    >
                      <BarChart3 className="h-2.5 w-2.5" />
                      结果
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                      onClick={(e) => handleDelete(task.taskId, e)}
                      disabled={deletingTaskId === task.taskId}
                      title="删除"
                      aria-label="删除"
                    >
                      {deletingTaskId === task.taskId ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-2.5 w-2.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Log Dialog */}
      <Dialog open={logDialogTaskId !== null} onOpenChange={(open) => { if (!open) setLogDialogTaskId(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-sm flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              任务日志
              <span className="font-mono text-muted-foreground text-xs">
                {logDialogTaskId ? (logDialogTaskId.length > 24 ? `...${logDialogTaskId.slice(-22)}` : logDialogTaskId) : ''}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {loadingLogs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">加载日志...</span>
              </div>
            ) : taskLogs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-xs">
                暂无日志
              </div>
            ) : (
              <div className="font-mono text-[10px] leading-4 space-y-0.5 p-1">
                {taskLogs.map((log, i) => {
                  const timeStr = log.timestamp instanceof Date
                    ? log.timestamp.toLocaleTimeString('zh-CN', { hour12: false })
                    : new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });

                  const levelColors: Record<string, string> = {
                    info: 'text-foreground',
                    warn: 'text-yellow-700 dark:text-yellow-400',
                    error: 'text-red-700 dark:text-red-400',
                    debug: 'text-muted-foreground',
                  };

                  return (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="text-[9px] font-bold uppercase text-muted-foreground shrink-0 w-[32px]">
                        {log.level}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums text-[9px]">
                        {timeStr}
                      </span>
                      <span className={`flex-1 min-w-0 ${levelColors[log.level] || ''}`}>
                        {log.message}
                        {log.detail && <span className="text-muted-foreground"> — {log.detail}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
