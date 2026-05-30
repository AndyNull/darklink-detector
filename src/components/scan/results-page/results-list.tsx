'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Loader2,
  Terminal,
  AlertTriangle,
  Globe,
  ArrowLeft,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ResultsPanel } from '@/components/scan/results-panel';
import { UrlDetailsPanel } from '@/components/scan/url-details-panel';
import { LogEntry } from '@/lib/scan-store';
import { isResultLog, renderResultText } from './types';

export interface ResultsListProps {
  expandedTaskId: string | null;
  taskFirstUrl: string | null;
  isMobile: boolean;
  onBackToHistory: () => void;
  // Log dialog
  logDialogTaskId: string | null;
  taskLogs: LogEntry[];
  loadingLogs: boolean;
  onCloseLogDialog: () => void;
  // Delete confirmation
  confirmDeleteId: string | null;
  deletingTaskId: string | null;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

export function ResultsList({
  expandedTaskId,
  taskFirstUrl,
  isMobile,
  onBackToHistory,
  logDialogTaskId,
  taskLogs,
  loadingLogs,
  onCloseLogDialog,
  confirmDeleteId,
  deletingTaskId,
  onCancelDelete,
  onConfirmDelete,
}: ResultsListProps) {
  // ─── Log Dialog ───
  const LogDialog = (
    <Dialog open={logDialogTaskId !== null} onOpenChange={(open) => { if (!open) onCloseLogDialog(); }}>
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
    <Dialog open={confirmDeleteId !== null} onOpenChange={(open) => { if (!open) onCancelDelete(); }}>
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
            onClick={onCancelDelete}
            disabled={deletingTaskId !== null}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="text-xs"
            onClick={onConfirmDelete}
            disabled={deletingTaskId !== null}
          >
            {deletingTaskId && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ─── Mobile Layout with expanded results ───
  if (isMobile && expandedTaskId) {
    return (
      <>
        <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 px-2"
            onClick={onBackToHistory}
          >
            <ArrowLeft className="h-3 w-3" />
            返回历史
          </Button>
          <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
            {taskFirstUrl || expandedTaskId.slice(0, 12)}
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
        {LogDialog}
        {DeleteConfirmDialog}
      </>
    );
  }

  // ─── PC Layout with expanded results ───
  if (expandedTaskId) {
    return (
      <>
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
        {LogDialog}
        {DeleteConfirmDialog}
      </>
    );
  }

  // ─── PC: Empty state when no task selected ───
  return (
    <>
      <div className="flex-1 flex items-center justify-center text-muted-foreground bg-muted/10">
        <div className="text-center">
          <Globe className="h-10 w-10 mx-auto mb-3 opacity-15" />
          <p className="text-sm font-medium">选择一个历史任务</p>
          <p className="text-[11px] mt-1">点击任务卡片查看扫描结果和域名详情</p>
        </div>
      </div>
      {LogDialog}
      {DeleteConfirmDialog}
    </>
  );
}
