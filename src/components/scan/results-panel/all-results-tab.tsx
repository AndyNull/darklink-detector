'use client';

import React, { useMemo, useState } from 'react';
import { type ScanResultItem } from '@/lib/scan-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Code2,
  Copy,
  Check,
  ListFilter,
} from 'lucide-react';
import { toast } from 'sonner';

export type AllResultsSubFilter = 'all' | 'success' | 'failed';

export interface AllResultsTabProps {
  filteredResults: ScanResultItem[];
  copiedUrl: string | null;
  onCopy: (url: string, e?: React.MouseEvent) => void;
  onPreview: (result: ScanResultItem) => void;
}

export function AllResultsTab({ filteredResults, copiedUrl, onCopy, onPreview }: AllResultsTabProps) {
  const [subFilter, setSubFilter] = useState<AllResultsSubFilter>('all');

  // Categorize results into success and failed
  const { successResults, failedResults } = useMemo(() => {
    const success: ScanResultItem[] = [];
    const failed: ScanResultItem[] = [];
    for (const r of filteredResults) {
      if (r.status === 'error') {
        failed.push(r);
      } else {
        success.push(r);
      }
    }
    return { successResults: success, failedResults: failed };
  }, [filteredResults]);

  // Apply sub-filter
  const displayResults = useMemo(() => {
    if (subFilter === 'success') return successResults;
    if (subFilter === 'failed') return failedResults;
    return filteredResults;
  }, [subFilter, filteredResults, successResults, failedResults]);

  // Bulk copy URLs for current sub-filter
  const handleBulkCopy = async () => {
    const urls = displayResults.map(r => r.url).join('\n');
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls);
      toast.success(`已复制 ${displayResults.length} 个URL`);
    } catch {
      toast.error('复制失败');
    }
  };

  if (filteredResults.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <ShieldCheck className="h-8 w-8 mb-2 text-green-500/30" />
        <p className="text-xs">所有URL扫描完成，未发现异常</p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">检测到的暗链和QR码将显示在这里</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Sub-filter bar: 全部 / 成功 / 失败 + copy button */}
      <div className="flex items-center gap-1.5 sticky top-0 bg-background/95 backdrop-blur-sm z-10 py-1">
        <ListFilter className="h-3 w-3 text-muted-foreground shrink-0" />
        <button
          onClick={() => setSubFilter('all')}
          className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
            subFilter === 'all'
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:bg-accent/50'
          }`}
        >
          全部 ({filteredResults.length})
        </button>
        <button
          onClick={() => setSubFilter('success')}
          className={`text-[10px] px-2 py-0.5 rounded-md transition-colors flex items-center gap-0.5 ${
            subFilter === 'success'
              ? 'bg-green-500/10 text-green-700 dark:text-green-400 font-medium'
              : 'text-muted-foreground hover:bg-accent/50'
          }`}
        >
          <CheckCircle2 className="h-2.5 w-2.5" />
          成功 ({successResults.length})
        </button>
        <button
          onClick={() => setSubFilter('failed')}
          className={`text-[10px] px-2 py-0.5 rounded-md transition-colors flex items-center gap-0.5 ${
            subFilter === 'failed'
              ? 'bg-destructive/10 text-destructive font-medium'
              : 'text-muted-foreground hover:bg-accent/50'
          }`}
        >
          <XCircle className="h-2.5 w-2.5" />
          失败 ({failedResults.length})
        </button>

        <div className="flex-1" />

        <button
          onClick={handleBulkCopy}
          disabled={displayResults.length === 0}
          title={`复制当前类别所有URL（共${displayResults.length}个）`}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none"
        >
          <Copy className="h-2.5 w-2.5" />
          复制URL
        </button>
      </div>

      {/* Results list */}
      <div className="space-y-1">
        {displayResults.map((result, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 rounded-md border p-1.5 transition-all duration-150 ease-out hover:bg-accent/50 active:bg-accent/70 cursor-default"
          >
            <div className="shrink-0">
              {result.status === 'completed' ? (
                result.darkLinks > 0 ? (
                  <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                )
              ) : (
                <XCircle className="h-3.5 w-3.5 text-destructive" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-mono truncate" title={result.url}>
                {result.url}
              </div>
              {result.title && (
                <div className="text-[9px] text-muted-foreground truncate">
                  {result.title}
                </div>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              {result.statusCode ? (
                <Badge
                  variant={result.statusCode >= 400 ? 'destructive' : 'secondary'}
                  className="text-[9px] font-mono px-1 py-0"
                >
                  {result.statusCode}
                </Badge>
              ) : null}
              <span className="text-[9px] text-muted-foreground tabular-nums">
                {result.responseTime ? `${result.responseTime}ms` : ''}
              </span>
              {result.darkLinks > 0 && (
                <Badge variant="destructive" className="text-[9px] px-1 py-0">{result.darkLinks}暗链</Badge>
              )}
              {result.qrCodes > 0 && (
                <Badge className="text-[9px] px-1 py-0">{result.qrCodes}QR</Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 shrink-0"
                onClick={(e) => { e.stopPropagation(); onPreview(result); }}
                title="查看源码"
                aria-label="查看源码"
              >
                <Code2 className="h-2 w-2" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 shrink-0"
                onClick={(e) => onCopy(result.url, e)}
                aria-label="复制"
              >
                {copiedUrl === result.url ? (
                  <Check className="h-2 w-2 text-green-600" />
                ) : (
                  <Copy className="h-2 w-2" />
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
