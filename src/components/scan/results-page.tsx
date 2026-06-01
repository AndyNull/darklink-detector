'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useScanStore, LogEntry } from '@/lib/scan-store';
import { getTaskList, deleteScan, getScanResults, type ApiLogEntry } from '@/lib/scan-api';
import { ResultsPanel } from '@/components/scan/results-panel';
import { UrlDetailsPanel } from '@/components/scan/url-details-panel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  History,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  BarChart3,
  Globe,
  ScanSearch,
  ArrowLeft,
  AlertTriangle,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/lib/auth-context';

// ─── Log text highlighting ─────────────────────────────────────────────
// Result log lines: highlight conclusion text in 碧蓝色, but keep URLs in default color

const RESULT_INDICATORS = [
  '深度扫描完成', 'QR码检测完成', '扫描完成',
  'HTML解析完成', '外部JS分析完成', '外部CSS分析完成',
  '发现外部资源', '发现\d+个图片URL', 'QR码检测:',
  '发现\d+个QR码', 'data URI中发现', 'HTTP图片中发现',
];
const RESULT_REGEX = new RegExp(RESULT_INDICATORS.join('|'));

function isResultLog(msg: string): boolean {
  return RESULT_REGEX.test(msg);
}

// Split text around URLs: URL parts stay default, non-URL parts get sky-blue
function renderResultText(text: string, colorClass: string): React.ReactNode[] {
  const urlPattern = /https?:\/\/[^\s,，)\]]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = urlPattern.exec(text)) !== null) {
    // Text before URL → colored
    if (m.index > last) {
      parts.push(<span key={`t-${m.index}`} className={colorClass}>{text.slice(last, m.index)}</span>);
    }
    // URL itself → default color
    parts.push(<span key={`u-${m.index}`}>{m[0]}</span>);
    last = urlPattern.lastIndex;
  }
  // Remaining text after last URL → colored
  if (last < text.length) {
    parts.push(<span key={`e-${last}`} className={colorClass}>{text.slice(last)}</span>);
  }
  // No URLs at all → fully colored
  if (parts.length === 0) {
    parts.push(<span key="full" className={colorClass}>{text}</span>);
  }
  return parts;
}

export function ResultsPage({ onNavigateToScan, isMobile: isMobileProp }: { onNavigateToScan?: () => void; isMobile?: boolean }) {
  const hookIsMobile = useIsMobile();
  const isMobile = isMobileProp ?? hookIsMobile;
  const { requireAuth, isAuthenticated } = useAuth();

  const {
    taskHistory,
    setTaskHistory,
    loadTaskResults,
    isScanning,
    scanStatus,
  } = useScanStore();

  const [loading, setLoading] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [logDialogTaskId, setLogDialogTaskId] = useState<string | null>(null);
  const [taskLogs, setTaskLogs] = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const handleDelete = useCallback(async (taskId: string) => {
    if (!requireAuth(() => {})) return;
    setDeletingTaskId(taskId);
    setConfirmDeleteId(null);
    try {
      await deleteScan(taskId);
      setTaskHistory(taskHistory.filter(t => t.taskId !== taskId));
      if (expandedTaskId === taskId) {
        setExpandedTaskId(null);
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    } finally {
      setDeletingTaskId(null);
    }
  }, [taskHistory, setTaskHistory, expandedTaskId]);

  const handleViewResults = useCallback(async (taskId: string) => {
    await loadTaskResults(taskId);
    setExpandedTaskId(taskId);
  }, [loadTaskResults]);

  const handleViewLogs = useCallback(async (taskId: string) => {
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
  }, []);

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

  const statusIcon = (status: string, size = 'h-3 w-3') => {
    switch (status) {
      case 'completed': return <CheckCircle2 className={`${size} text-green-600 shrink-0`} />;
      case 'running': return <Loader2 className={`${size} text-primary animate-spin shrink-0`} />;
      case 'stopped': return <XCircle className={`${size} text-yellow-600 shrink-0`} />;
      case 'error': return <XCircle className={`${size} text-destructive shrink-0`} />;
      default: return <History className={`${size} text-muted-foreground shrink-0`} />;
    }
  };

  const truncateUrl = (url: string, maxLen: number) => {
    if (url.length <= maxLen) return url;
    return url.substring(0, maxLen - 3) + '...';
  };

  // ─── Task Card Component ───
  const TaskCard = ({ task }: { task: typeof taskHistory[0] }) => (
    <div
      className={`group rounded-md border transition-all duration-150 ease-out cursor-pointer px-2.5 py-2 ${
        expandedTaskId === task.taskId
          ? 'bg-accent/40 ring-1 ring-primary/30 border-primary/30'
          : 'hover:bg-accent/40 hover:-translate-y-px hover:shadow-sm active:bg-accent/60 active:translate-y-0 border-transparent'
      }`}
      onClick={() => handleViewResults(task.taskId)}
    >
      {/* Row 1: Status icon + firstUrl + time */}
      <div className="flex items-center gap-1.5 min-w-0">
        {statusIcon(task.status)}
        <span className="text-[11px] font-mono truncate flex-1 min-w-0" title={task.firstUrl || task.taskId}>
          {task.firstUrl ? truncateUrl(task.firstUrl, 35) : task.taskId.slice(0, 12) + '...'}
        </span>
        <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">{formatTime(task.createdAt)}</span>
      </div>

      {/* Row 2: Stats + actions */}
      <div className="flex items-center gap-1 mt-1 min-w-0">
        <span className="text-[9px] text-muted-foreground shrink-0">{task.urlCount}URL</span>
        {task.darkLinks > 0 && (
          <Badge variant="destructive" className="text-[9px] px-1 py-0 shrink-0">{task.darkLinks}暗链</Badge>
        )}
        {task.qrCodes > 0 && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{task.qrCodes}QR</Badge>
        )}
        <div className="ml-auto flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" className="h-5 text-[9px] gap-0.5 px-1 shrink-0" onClick={() => handleViewLogs(task.taskId)} title="查看日志">
            <Terminal className="h-2.5 w-2.5" />
          </Button>
          <Button variant={expandedTaskId === task.taskId ? 'default' : 'ghost'} size="sm" className="h-5 text-[9px] gap-0.5 px-1 shrink-0" onClick={() => handleViewResults(task.taskId)} title="查看结果">
            <BarChart3 className="h-2.5 w-2.5" />
          </Button>
          {isAuthenticated && (
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive shrink-0" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(task.taskId); }} disabled={deletingTaskId === task.taskId} title="删除" aria-label="删除">
              {deletingTaskId === task.taskId ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  // ─── Log Dialog ───
  const LogDialog = (
    <Dialog open={logDialogTaskId !== null} onOpenChange={(open) => { if (!open) setLogDialogTaskId(null); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-[60vw] max-h-[80vh] flex flex-col p-3 gap-2 sm:p-6 sm:gap-4">
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
            <div className={`font-mono text-[11px] leading-4 space-y-0.5 px-0.5 py-0.5 ${isMobile ? 'text-[10px] leading-3.5 space-y-0.5' : ''}`}>
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

                const isResult = isResultLog(log.message);
                const resultColor = 'text-sky-600 dark:text-sky-400 font-semibold';
                const defaultColor = levelColors[log.level] || '';

                return (
                  <div key={i} className={`flex ${isMobile ? 'gap-1' : 'gap-1.5'}`}>
                    {/* Level badge column */}
                    {isMobile ? (
                      <span className={`shrink-0 w-[0.9rem] min-h-[1.75rem] inline-flex items-center justify-center text-[9px] font-bold uppercase rounded-sm ${
                        log.level === 'error' ? 'bg-red-500/15 text-red-600 dark:text-red-400' :
                        log.level === 'warn' ? 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400' :
                        log.level === 'debug' ? 'bg-muted text-muted-foreground' :
                        'bg-primary/10 text-foreground'
                      }`}>
                        {log.level.charAt(0).toUpperCase()}
                      </span>
                    ) : (
                      <div className="shrink-0 w-[2.5rem]">
                        <span className={`inline-flex items-center justify-center w-full text-[10px] font-bold uppercase py-0.5 rounded ${
                          log.level === 'error' ? 'bg-red-500/10 text-red-600 dark:text-red-400' :
                          log.level === 'warn' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' :
                          log.level === 'debug' ? 'bg-muted text-muted-foreground' :
                          'bg-primary/10 text-foreground'
                        }`}>
                          {log.level}
                        </span>
                      </div>
                    )}
                    {/* Content: Time + Message */}
                    <div className="min-w-0 flex-1">
                      <span className={`text-muted-foreground tabular-nums ${isMobile ? 'text-[9px]' : 'text-[10px]'}`}>
                        {timeStr}
                      </span>
                      <div className={defaultColor}>
                        {isResult ? renderResultText(log.message, resultColor) : log.message}
                      </div>
                      {log.detail && (
                        <div className={`${isResult ? resultColor : 'text-muted-foreground'} ${isMobile ? 'text-[9px]' : 'text-[10px]'}`}>
                          → {isResult ? renderResultText(log.detail, resultColor) : log.detail}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  // ─── Delete Confirmation Dialog ───
  const DeleteConfirmDialog = (
    <Dialog open={confirmDeleteId !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
      <DialogContent className="sm:max-w-[320px] p-4 gap-3">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            确认删除
          </DialogTitle>
          <DialogDescription className="text-[10px]">
            删除后数据将无法恢复，确定要删除该扫描任务吗？
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-1.5 pt-0">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setConfirmDeleteId(null)}
            disabled={deletingTaskId !== null}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="text-xs"
            onClick={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
            disabled={deletingTaskId !== null}
          >
            {deletingTaskId && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ─── Mobile Layout ───
  if (isMobile) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {expandedTaskId ? (
          // Mobile: viewing results
          <>
            <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 px-2"
                onClick={() => setExpandedTaskId(null)}
              >
                <ArrowLeft className="h-3 w-3" />
                返回历史
              </Button>
              <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                {taskHistory.find(t => t.taskId === expandedTaskId)?.firstUrl || expandedTaskId.slice(0, 12)}
              </span>
            </div>
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 border-b flex flex-col overflow-hidden">
                <ResultsPanel />
              </div>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <UrlDetailsPanel />
              </div>
            </div>
          </>
        ) : (
          // Mobile: history list (full width)
          <>
            <div className="h-10 px-3 border-b flex items-center gap-1.5 shrink-0">
              <History className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium">历史任务 ({taskHistory.length})</span>
              <div className="ml-auto shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={fetchTasks}
                  disabled={loading}
                  title="刷新"
                  aria-label="刷新"
                >
                  <RefreshCw className={`h-2.5 w-2.5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 space-y-1">
              {loading && taskHistory.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-xs">加载中...</span>
                </div>
              ) : taskHistory.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <History className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-xs font-medium">暂无历史任务</p>
                  <p className="text-[10px] mt-1">完成扫描后任务将出现在这里</p>
                  {onNavigateToScan && (
                    <Button variant="outline" size="sm" className="mt-3 text-[10px] gap-1" onClick={onNavigateToScan}>
                      <ScanSearch className="h-3 w-3" />
                      前往扫描
                    </Button>
                  )}
                </div>
              ) : (
                taskHistory.map((task) => (
                  <TaskCard key={task.taskId} task={task} />
                ))
              )}
            </div>
          </>
        )}

        {LogDialog}
        {DeleteConfirmDialog}
      </div>
    );
  }

  // ─── PC Layout ───
  return (
    <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
      {/* Left column: compact history sidebar (~260px) */}
      <div className="flex flex-col border-r shrink-0 overflow-hidden" style={{ width: 260 }}>
        {/* Header */}
        <div className="h-10 px-2 border-b flex items-center gap-1.5 shrink-0">
          <History className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium truncate">历史任务 ({taskHistory.length})</span>
          <div className="ml-auto shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={fetchTasks}
              disabled={loading}
              title="刷新"
              aria-label="刷新"
            >
              <RefreshCw className={`h-2.5 w-2.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Task list - scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {taskHistory.length === 0 ? (
            <div className="text-center text-muted-foreground py-4 text-[10px] px-2">
              <History className="h-5 w-5 mx-auto mb-1 opacity-20" />
              <p>暂无历史任务</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {taskHistory.map((task) => (
                <TaskCard key={task.taskId} task={task} />
              ))}
            </div>
          )}
        </div>

        {/* Navigate to scan button at bottom when empty */}
        {taskHistory.length === 0 && onNavigateToScan && (
          <div className="p-2 border-t">
            <Button variant="outline" size="sm" className="w-full h-7 text-[10px] gap-1" onClick={onNavigateToScan}>
              <ScanSearch className="h-3 w-3" />
              前往扫描
            </Button>
          </div>
        )}
      </div>

      {/* Right side: Results + Domain list (resizable panels) */}
      {expandedTaskId ? (
        <PanelGroup direction="vertical" className="flex-1 min-h-0">
          <Panel defaultSize={50} minSize={20}>
            <div className="h-full border-b flex flex-col overflow-hidden">
              <ResultsPanel />
            </div>
          </Panel>
          <PanelResizeHandle className="h-1.5 bg-border/50 hover:bg-primary/30 transition-colors cursor-row-resize flex items-center justify-center group">
            <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30 group-hover:bg-primary/50 transition-colors" />
          </PanelResizeHandle>
          <Panel defaultSize={50} minSize={20}>
            <UrlDetailsPanel />
          </Panel>
        </PanelGroup>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground bg-muted/10">
          <div className="text-center">
            <Globe className="h-10 w-10 mx-auto mb-3 opacity-15" />
            <p className="text-sm font-medium">选择一个历史任务</p>
            <p className="text-[11px] mt-1">点击任务卡片查看扫描结果和域名详情</p>
          </div>
        </div>
      )}

      {/* Log Dialog */}
      {LogDialog}
      {DeleteConfirmDialog}
    </div>
  );
}
