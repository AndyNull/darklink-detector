'use client';

import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Info,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { SourceInfo, QUERY_ONLY_SOURCES } from './types';
import { getSourceStatus } from './helpers';

export function SourceCard({
  source,
  enabled,
  onToggle,
  onSync,
  syncing,
  apiKeyStatus,
}: {
  source: SourceInfo;
  enabled: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onSync: (id: string) => void;
  syncing: boolean;
  apiKeyStatus: 'none' | 'configured' | 'verified';
}) {
  const status = getSourceStatus(source, apiKeyStatus !== 'none', source.totalCount, enabled);

  const typeBadgeColors: Record<string, string> = {
    domain: 'bg-blue-500/10 text-blue-600',
    ip: 'bg-orange-500/10 text-orange-600',
    both: 'bg-purple-500/10 text-purple-600',
  };

  const typeLabels: Record<string, string> = {
    domain: '域名',
    ip: 'IP',
    both: '域名+IP',
  };

  const statusBadgeConfig: Record<string, { color: string; bg: string; label: string }> = {
    active: { color: 'text-green-600', bg: 'bg-green-500/10', label: '活跃' },
    inactive: { color: 'text-muted-foreground', bg: 'bg-muted/50', label: '未启用' },
    'needs-key': { color: 'text-yellow-600', bg: 'bg-yellow-500/10', label: '需Key' },
    deprecated: { color: 'text-red-500', bg: 'bg-red-500/10', label: '已弃用' },
    stale: { color: 'text-orange-500', bg: 'bg-orange-500/10', label: '可能过时' },
    'query-only': { color: 'text-blue-600', bg: 'bg-blue-500/10', label: '查询' },
  };

  const dataQualityConfig: Record<string, { color: string; label: string }> = {
    good: { color: 'text-green-600', label: '优质' },
    limited: { color: 'text-yellow-600', label: '有限' },
    poor: { color: 'text-red-500', label: '较差' },
  };

  const statusInfo = statusBadgeConfig[status] || statusBadgeConfig.inactive;
  const qualityInfo = dataQualityConfig[source.dataQuality] || dataQualityConfig.good;

  return (
    <div className={`rounded border px-3 py-2 transition-colors ${enabled ? 'bg-background' : 'bg-muted/30 opacity-60'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onToggle(source.id, checked)}
          className="scale-75 origin-left cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium truncate">{source.name}</span>
            <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 ${typeBadgeColors[source.type] || ''}`}>
              {typeLabels[source.type] || source.type}
            </Badge>
            <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 ${statusInfo.bg} ${statusInfo.color} border-0`}>
              {statusInfo.label}
            </Badge>
            {source.keyAvailable && status === 'needs-key' && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 shrink-0 bg-blue-500/10 text-blue-600 border-0">
                可申请
              </Badge>
            )}
            {source.dataQuality !== 'good' && (
              <Badge variant="outline" className={`text-[8px] px-1 py-0 shrink-0 border-0 ${qualityInfo.color}`}>
                数据:{qualityInfo.label}
              </Badge>
            )}
          </div>
          <div className="text-[9px] text-muted-foreground truncate mt-0.5">
            {source.description}
          </div>
          {source.statusNote && (
            <div className="text-[9px] text-muted-foreground/70 mt-0.5 flex items-center gap-0.5">
              <Info className="h-2 w-2 shrink-0" />
              {source.statusNote}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 self-center">
          {/* Count display — only for bulk sources (not query-only) */}
          {!QUERY_ONLY_SOURCES.has(source.id) && (
            <div className="text-right min-w-[36px]">
              <div className="text-[10px] font-bold tabular-nums leading-none">{source.totalCount}</div>
              {(source.domainCount > 0 || source.ipCount > 0) && (
                <div className="text-[7px] text-muted-foreground leading-none mt-0.5">
                  {source.domainCount > 0 && `${source.domainCount}域`}
                  {source.domainCount > 0 && source.ipCount > 0 && '/'}
                  {source.ipCount > 0 && `${source.ipCount}IP`}
                </div>
              )}
            </div>
          )}
          {source.url && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
              asChild
            >
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          {QUERY_ONLY_SOURCES.has(source.id) ? (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 shrink-0 bg-blue-500/10 text-blue-600 border-0">
              仅查询
            </Badge>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 cursor-pointer transition-colors hover:bg-primary/10 hover:text-primary"
              onClick={() => onSync(source.id)}
              disabled={syncing || !enabled || status === 'deprecated'}
              title="同步更新"
            >
              {syncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
