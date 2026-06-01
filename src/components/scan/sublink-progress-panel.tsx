'use client';

import { memo } from 'react';
import { useScanStore } from '@/lib/scan-store';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Network,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Clock,
} from 'lucide-react';

/** Format ms to a human-readable ETA string */
function formatEta(ms: number): string {
  if (ms < 1000) return '< 1秒';
  if (ms < 60000) return `~${Math.ceil(ms / 1000)}秒`;
  return `~${Math.ceil(ms / 60000)}分钟`;
}

/**
 * SublinkProgressPanel - Displays progress of sublink discovery and scanning.
 * Shown in the URL input panel when sublink scanning is active.
 * Memoized to prevent unnecessary re-renders.
 */
export const SublinkProgressPanel = memo(function SublinkProgressPanel() {
  const sublinkStatus = useScanStore(s => s.sublinkStatus);
  const sublinkProgress = useScanStore(s => s.sublinkProgress);

  if (!sublinkProgress) return null;

  const { discovered, scanned, total, sublinks, sourcesProgress, eta } = sublinkProgress;

  const isDiscovering = sublinkStatus === 'discovering';
  const isScanning = sublinkStatus === 'scanning';
  const isComplete = sublinkStatus === 'complete';
  const isError = sublinkStatus === 'error';
  const isDiscovered = sublinkStatus === 'discovered';

  const scanPercent = total > 0 ? Math.round((scanned / total) * 100) : 0;
  const doneSources = sourcesProgress?.filter(s => s.status === 'done').length || 0;
  const totalSources = sourcesProgress?.length || 0;

  return (
    <div className="mx-3 mt-1.5 rounded-md border bg-card overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
        <Network className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-[11px] font-semibold">子链扫描</span>
        {isDiscovering && (
          <Badge variant="outline" className="text-[8px] px-1.5 py-0 text-blue-600 border-blue-300">
            <Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" />
            发现中
          </Badge>
        )}
        {isDiscovered && (
          <Badge variant="outline" className="text-[8px] px-1.5 py-0 text-yellow-600 border-yellow-300">
            等待扫描
          </Badge>
        )}
        {isScanning && (
          <Badge variant="outline" className="text-[8px] px-1.5 py-0 text-orange-600 border-orange-300">
            <Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" />
            扫描中
          </Badge>
        )}
        {isComplete && (
          <Badge variant="outline" className="text-[8px] px-1.5 py-0 text-green-600 border-green-300">
            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
            完成
          </Badge>
        )}
        {isError && (
          <Badge variant="outline" className="text-[8px] px-1.5 py-0 text-red-600 border-red-300">
            <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
            错误
          </Badge>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          发现 <span className="font-bold text-foreground">{discovered}</span> 个子链
          {isDiscovering && totalSources > 1 && (
            <span className="ml-1">({doneSources}/{totalSources} 源)</span>
          )}
        </span>
      </div>

      {/* ETA display */}
      {eta != null && eta > 0 && (isDiscovering || isScanning) && (
        <div className="flex items-center gap-1 px-3 py-1 border-b bg-muted/10">
          <Clock className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
          <span className="text-[9px] text-muted-foreground">
            {isDiscovering ? '预计发现剩余' : '预计扫描剩余'}: <span className="font-medium text-foreground">{formatEta(eta)}</span>
          </span>
        </div>
      )}

      {/* Source progress */}
      {sourcesProgress && sourcesProgress.length > 0 && (
        <div className="px-3 py-1.5 space-y-1">
          {sourcesProgress.map((source, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-[10px]">
              {source.status === 'discovering' && <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-500 shrink-0" />}
              {source.status === 'done' && <CheckCircle2 className="h-2.5 w-2.5 text-green-500 shrink-0" />}
              {source.status === 'error' && <AlertCircle className="h-2.5 w-2.5 text-red-500 shrink-0" />}
              {source.status === 'pending' && <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30 shrink-0" />}
              <span className="text-muted-foreground truncate flex-1 font-mono">{source.hostname}</span>
              <span className="text-muted-foreground shrink-0">{source.sublinkCount} 个子链</span>
            </div>
          ))}
        </div>
      )}

      {/* Scan progress */}
      {(isScanning || isComplete) && total > 0 && (
        <div className="px-3 py-1.5 border-t">
          <div className="flex items-center gap-2">
            <Progress value={scanPercent} className="flex-1 h-1.5" />
            <span className="text-[10px] font-bold tabular-nums shrink-0">{scanPercent}%</span>
            <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
              {scanned}/{total}
            </span>
          </div>
          {sublinkProgress.currentUrl && isScanning && (
            <div className="flex items-center gap-1 mt-1">
              <ExternalLink className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              <span className="text-[9px] text-muted-foreground font-mono truncate">
                {sublinkProgress.currentUrl}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Sublinks list (collapsible, max 5 shown) */}
      {sublinks.length > 0 && (
        <div className="px-3 py-1.5 border-t max-h-24 overflow-y-auto custom-scrollbar">
          <div className="space-y-0.5">
            {sublinks.slice(0, 20).map((link, idx) => (
              <div key={idx} className="flex items-center gap-1 text-[9px]">
                <span className="text-muted-foreground shrink-0">{idx + 1}.</span>
                <span className="font-mono text-muted-foreground truncate">{link}</span>
              </div>
            ))}
            {sublinks.length > 20 && (
              <div className="text-[9px] text-muted-foreground text-center">
                ... 还有 {sublinks.length - 20} 个子链
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
