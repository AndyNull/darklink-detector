'use client';

import React from 'react';
import { type ScanResultItem } from '@/lib/scan-store';
import { XCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';

export interface ErrorsTabProps {
  results: ScanResultItem[];
}

export function ErrorsTab({ results }: ErrorsTabProps) {
  const errors = results.filter(r => r.status === 'error');

  const handleBulkCopy = async () => {
    const urls = errors.map(r => r.url).join('\n');
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls);
      toast.success(`已复制 ${errors.length} 个失败URL`);
    } catch {
      toast.error('复制失败');
    }
  };

  if (errors.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-6 text-xs">
        无错误
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Bulk copy bar */}
      <div className="flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur-sm z-10 py-1">
        <span className="text-[10px] text-muted-foreground">{errors.length} 个URL扫描失败</span>
        <button
          onClick={handleBulkCopy}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors cursor-pointer select-none"
        >
          <Copy className="h-2.5 w-2.5" />
          复制失败URL
        </button>
      </div>

      <div className="space-y-1">
        {errors.map((result, i) => (
          <div key={i} className="rounded-md border border-destructive/30 bg-destructive/5 p-1.5">
            <div className="flex items-center gap-1.5">
              <XCircle className="h-3 w-3 text-destructive shrink-0" />
              <span className="text-[10px] font-mono truncate">{result.url}</span>
            </div>
            <p className="text-[9px] text-destructive mt-0.5 ml-4">{result.errorMessage}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
