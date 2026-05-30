'use client';

import React, { Suspense, useState, useCallback, useEffect, useRef, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import { useScanStore, LogEntry } from '@/lib/scan-store';
import { getTaskList, deleteScan, getScanResults, type ApiLogEntry } from '@/lib/scan-api';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/lib/auth-context';

// ──── Lazy-loaded sub-components for code splitting ────
const SummarySection = lazy(() =>
  import('./summary-section').then(m => ({ default: m.SummarySection }))
);
const ResultsList = lazy(() =>
  import('./results-list').then(m => ({ default: m.ResultsList }))
);

export function ResultsPage({ onNavigateToScan, isMobile: isMobileProp }: { onNavigateToScan?: () => void; isMobile?: boolean }) {
  const hookIsMobile = useIsMobile();
  const isMobile = isMobileProp ?? hookIsMobile;
  const { requireAuth, isAuthenticated } = useAuth();

  const {
    taskHistory,
    setTaskHistory,
    loadTaskResults,
    scanStatus,
  } = useScanStore();

  const [loading, setLoading] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [logDialogTaskId, setLogDialogTaskId] = useState<string | null>(null);
  const [taskLogs, setTaskLogs] = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const prevScanStatusRef = useRef(scanStatus);

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
    const prevStatus = prevScanStatusRef.current;
    prevScanStatusRef.current = scanStatus;

    // Fetch on mount (prevStatus is initial value) or when scan transitions to completed/stopped
    const isInitialLoad = prevStatus === scanStatus; // first run: ref hasn't been updated yet
    const justCompleted = scanStatus === 'completed' && prevStatus !== 'completed';
    const justStopped = scanStatus === 'stopped' && prevStatus !== 'stopped';

    if (isInitialLoad || justCompleted || justStopped) {
      fetchTasks();
    }
  }, [fetchTasks, scanStatus]);

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
      const logs: LogEntry[] = (data.logs || []).map((l: ApiLogEntry) => ({
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

  // Find the firstUrl for the expanded task
  const taskFirstUrl = expandedTaskId ? taskHistory.find(t => t.taskId === expandedTaskId)?.firstUrl || null : null;

  // Mobile: full-width layout
  if (isMobile) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {expandedTaskId ? (
          // Mobile: viewing results
          <Suspense fallback={<div className="flex items-center justify-center py-8"><Loader2 className="h-4 w-4 animate-spin mr-2" /><span className="text-xs text-muted-foreground">加载结果...</span></div>}>
            <ResultsList
              expandedTaskId={expandedTaskId}
              taskFirstUrl={taskFirstUrl}
              isMobile={isMobile}
              onBackToHistory={() => setExpandedTaskId(null)}
              logDialogTaskId={logDialogTaskId}
              taskLogs={taskLogs}
              loadingLogs={loadingLogs}
              onCloseLogDialog={() => setLogDialogTaskId(null)}
              confirmDeleteId={confirmDeleteId}
              deletingTaskId={deletingTaskId}
              onCancelDelete={() => setConfirmDeleteId(null)}
              onConfirmDelete={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
            />
          </Suspense>
        ) : (
          // Mobile: history list (full width)
          <Suspense fallback={<div className="flex items-center justify-center py-8"><Loader2 className="h-4 w-4 animate-spin mr-2" /><span className="text-xs text-muted-foreground">加载中...</span></div>}>
            <SummarySection
              taskHistory={taskHistory}
              expandedTaskId={expandedTaskId}
              deletingTaskId={deletingTaskId}
              loading={loading}
              isMobile={isMobile}
              isAuthenticated={isAuthenticated}
              onRefresh={fetchTasks}
              onViewResults={handleViewResults}
              onViewLogs={handleViewLogs}
              onDelete={(taskId) => setConfirmDeleteId(taskId)}
              onNavigateToScan={onNavigateToScan}
            />
          </Suspense>
        )}
      </div>
    );
  }

  // ─── PC Layout ───
  return (
    <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
      {/* Left column: compact history sidebar (~260px) */}
      <div className="flex flex-col border-r shrink-0 overflow-hidden" style={{ width: 260 }}>
        <Suspense fallback={<div className="flex items-center justify-center py-8"><Loader2 className="h-4 w-4 animate-spin mr-2" /><span className="text-xs text-muted-foreground">加载中...</span></div>}>
          <SummarySection
            taskHistory={taskHistory}
            expandedTaskId={expandedTaskId}
            deletingTaskId={deletingTaskId}
            loading={loading}
            isMobile={isMobile}
            isAuthenticated={isAuthenticated}
            onRefresh={fetchTasks}
            onViewResults={handleViewResults}
            onViewLogs={handleViewLogs}
            onDelete={(taskId) => setConfirmDeleteId(taskId)}
            onNavigateToScan={onNavigateToScan}
          />
        </Suspense>
      </div>

      {/* Right side: Results + Domain list (resizable panels) */}
      <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="h-4 w-4 animate-spin mr-2" /><span className="text-xs text-muted-foreground">加载结果...</span></div>}>
        <ResultsList
          expandedTaskId={expandedTaskId}
          taskFirstUrl={taskFirstUrl}
          isMobile={isMobile}
          onBackToHistory={() => setExpandedTaskId(null)}
          logDialogTaskId={logDialogTaskId}
          taskLogs={taskLogs}
          loadingLogs={loadingLogs}
          onCloseLogDialog={() => setLogDialogTaskId(null)}
          confirmDeleteId={confirmDeleteId}
          deletingTaskId={deletingTaskId}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onConfirmDelete={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        />
      </Suspense>
    </div>
  );
}
