'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
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
  ScanSearch,
} from 'lucide-react';
import { TaskHistoryItem } from '@/lib/scan-store';
import { formatTime, truncateUrl } from './types';

// ─── Status icon helper ────────────────────────────────────────────────────

function statusIcon(status: string, size = 'h-3 w-3'): React.ReactNode {
  switch (status) {
    case 'completed': return <CheckCircle2 className={`${size} text-green-600 shrink-0`} />;
    case 'running': return <Loader2 className={`${size} text-primary animate-spin shrink-0`} />;
    case 'stopped': return <XCircle className={`${size} text-yellow-600 shrink-0`} />;
    case 'error': return <XCircle className={`${size} text-destructive shrink-0`} />;
    default: return <History className={`${size} text-muted-foreground shrink-0`} />;
  }
}

export interface SummarySectionProps {
  taskHistory: TaskHistoryItem[];
  expandedTaskId: string | null;
  deletingTaskId: string | null;
  loading: boolean;
  isMobile: boolean;
  isAuthenticated: boolean;
  onRefresh: () => void;
  onViewResults: (taskId: string) => void;
  onViewLogs: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onNavigateToScan?: () => void;
}

// ─── Task Card Component ───
function TaskCard({ task, expandedTaskId, deletingTaskId, isAuthenticated, onViewResults, onViewLogs, onDelete }: {
  task: TaskHistoryItem;
  expandedTaskId: string | null;
  deletingTaskId: string | null;
  isAuthenticated: boolean;
  onViewResults: (taskId: string) => void;
  onViewLogs: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}) {
  return (
    <div
      className={`group rounded-md border transition-all duration-150 ease-out cursor-pointer px-2.5 py-2 ${
        expandedTaskId === task.taskId
          ? 'bg-accent/40 ring-1 ring-primary/30 border-primary/30'
          : 'hover:bg-accent/40 hover:-translate-y-px hover:shadow-sm active:bg-accent/60 active:translate-y-0 border-transparent'
      }`}
      onClick={() => onViewResults(task.taskId)}
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
          <Button variant="ghost" size="sm" className="h-5 text-[9px] gap-0.5 px-1 shrink-0" onClick={() => onViewLogs(task.taskId)} title="查看日志">
            <Terminal className="h-2.5 w-2.5" />
          </Button>
          <Button variant={expandedTaskId === task.taskId ? 'default' : 'ghost'} size="sm" className="h-5 text-[9px] gap-0.5 px-1 shrink-0" onClick={() => onViewResults(task.taskId)} title="查看结果">
            <BarChart3 className="h-2.5 w-2.5" />
          </Button>
          {isAuthenticated && (
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive shrink-0" onClick={(e) => { e.stopPropagation(); onDelete(task.taskId); }} disabled={deletingTaskId === task.taskId} title="删除">
              {deletingTaskId === task.taskId ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SummarySection({
  taskHistory,
  expandedTaskId,
  deletingTaskId,
  loading,
  isMobile,
  isAuthenticated,
  onRefresh,
  onViewResults,
  onViewLogs,
  onDelete,
  onNavigateToScan,
}: SummarySectionProps) {
  // Mobile: full-width task list
  if (isMobile) {
    return (
      <>
        <div className="h-10 px-3 border-b flex items-center gap-1.5 shrink-0">
          <History className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium">历史任务 ({taskHistory.length})</span>
          <div className="ml-auto shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={onRefresh}
              disabled={loading}
              title="刷新"
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
              <TaskCard
                key={task.taskId}
                task={task}
                expandedTaskId={expandedTaskId}
                deletingTaskId={deletingTaskId}
                isAuthenticated={isAuthenticated}
                onViewResults={onViewResults}
                onViewLogs={onViewLogs}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </>
    );
  }

  // PC: sidebar task list
  return (
    <>
      {/* Header */}
      <div className="h-10 px-2 border-b flex items-center gap-1.5 shrink-0">
        <History className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate">历史任务 ({taskHistory.length})</span>
        <div className="ml-auto shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onRefresh}
            disabled={loading}
            title="刷新"
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
              <TaskCard
                key={task.taskId}
                task={task}
                expandedTaskId={expandedTaskId}
                deletingTaskId={deletingTaskId}
                isAuthenticated={isAuthenticated}
                onViewResults={onViewResults}
                onViewLogs={onViewLogs}
                onDelete={onDelete}
              />
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
    </>
  );
}
