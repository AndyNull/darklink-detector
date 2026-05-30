'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useScanStore } from '@/lib/scan-store';
import { Button } from '@/components/ui/button';
import type { LogEntry } from '@/lib/scan-store';
import {
  Terminal,
  Trash2,
  Info,
  AlertTriangle,
  AlertCircle,
  Bug,
  Copy,
  Check,
} from 'lucide-react';

const MAX_DISPLAY_LOGS = 500;
const SCROLL_BOTTOM_THRESHOLD = 40;

const levelIcons: Record<string, React.ReactNode> = {
  info: <Info className="h-3 w-3 text-blue-500" />,
  warn: <AlertTriangle className="h-3 w-3 text-yellow-500" />,
  error: <AlertCircle className="h-3 w-3 text-red-500" />,
  debug: <Bug className="h-3 w-3 text-gray-400" />,
};

const levelTextColors: Record<string, string> = {
  info: 'text-foreground',
  warn: 'text-yellow-700 dark:text-yellow-400',
  error: 'text-red-700 dark:text-red-400',
  debug: 'text-muted-foreground',
};

const LogEntryRow = memo(function LogEntryRow({
  log,
  copiedId,
  onCopy,
}: {
  log: LogEntry;
  copiedId: number | null;
  onCopy: (id: number, text: string) => void;
}) {
  const timeStr = log.timestamp instanceof Date
    ? log.timestamp.toLocaleTimeString('zh-CN', { hour12: false })
    : new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });

  const fullText = `[${timeStr}] [${log.level.toUpperCase()}] ${log.message}${log.detail ? ` — ${log.detail}` : ''}`;

  return (
    <div className="flex items-start gap-1.5 py-0.5 group">
      <span className="shrink-0 mt-0.5">
        {levelIcons[log.level]}
      </span>
      <span className="text-muted-foreground shrink-0 tabular-nums text-[9px]">
        {timeStr}
      </span>
      <span className={`flex-1 min-w-0 truncate ${levelTextColors[log.level] || ''}`} title={fullText}>
        {log.message}
        {log.detail && <span className="text-muted-foreground"> — {log.detail}</span>}
      </span>
      <button
        type="button"
        className="h-3 w-3 p-0 shrink-0 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center rounded hover:bg-muted/50 transition-opacity"
        onClick={() => onCopy(log.id, fullText)}
        aria-label="复制日志"
      >
        {copiedId === log.id ? (
          <Check className="h-2 w-2 text-green-600" />
        ) : (
          <Copy className="h-2 w-2" />
        )}
      </button>
    </div>
  );
});

export function LogPanel() {
  const logs = useScanStore(s => s.logs);
  const clearLogs = useScanStore(s => s.clearLogs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const displayLogs = logs.length > MAX_DISPLAY_LOGS
    ? logs.slice(-MAX_DISPLAY_LOGS)
    : logs;

  // Smart auto-scroll: only scroll to bottom if user is already near the bottom
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  // Track whether user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distFromBottom < SCROLL_BOTTOM_THRESHOLD;
  }, []);

  const handleCopyLog = useCallback((id: number, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact inline header */}
      <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
        <Terminal className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium">实时日志 ({logs.length})</span>
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] gap-0.5"
            onClick={clearLogs}
            disabled={logs.length === 0}
          >
            <Trash2 className="h-2.5 w-2.5" />
            清空
          </Button>
        </div>
      </div>

      {/* Log content - scrollable */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto custom-scrollbar font-mono text-[10px] leading-4 px-3 py-1"
      >
        {logs.length === 0 ? (
          <div className="text-center text-muted-foreground py-4">
            <Terminal className="h-4 w-4 mx-auto mb-1 opacity-20" />
            <p className="text-[10px]">等待扫描开始...</p>
          </div>
        ) : (
          <>
            {logs.length > MAX_DISPLAY_LOGS && (
              <div className="text-center text-[10px] text-muted-foreground py-1 border-b border-border/50 mb-1">
                显示最近 {MAX_DISPLAY_LOGS} 条，共 {logs.length} 条日志
              </div>
            )}
            {displayLogs.map((log) => (
              <LogEntryRow
                key={log.id}
                log={log}
                copiedId={copiedId}
                onCopy={handleCopyLog}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
