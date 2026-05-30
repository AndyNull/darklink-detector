'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Globe,
  Key,
  Shield,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { SourceInfo, QUERY_ONLY_SOURCES, API_KEY_SOURCES } from '../types';
import { getSourceStatus } from '../helpers';
import { SourceCard } from '../source-card';

export interface SourceListProps {
  sources: SourceInfo[];
  enabledSources: Record<string, boolean>;
  loading: boolean;
  syncingSources: Set<string>;
  apiKeys: Record<string, string>;
  onToggleSource: (id: string, enabled: boolean) => void;
  onSyncSource: (id: string) => void;
  onSyncAll: () => void;
}

export function SourceList({
  sources,
  enabledSources,
  loading,
  syncingSources,
  apiKeys,
  onToggleSource,
  onSyncSource,
  onSyncAll,
}: SourceListProps) {
  // Group sources
  const freeSources = sources.filter(s => !API_KEY_SOURCES.has(s.id) && !QUERY_ONLY_SOURCES.has(s.id) && s.status !== 'deprecated');
  const apiKeySources = sources.filter(s => API_KEY_SOURCES.has(s.id) && !QUERY_ONLY_SOURCES.has(s.id));
  const queryOnlySources = sources.filter(s => QUERY_ONLY_SOURCES.has(s.id));

  // Only count as enabled if explicitly set to true in the enabledSources map
  const totalEnabled = sources.filter(s => enabledSources[s.id] === true).length;
  const totalActive = sources.filter(s => getSourceStatus(s, !!apiKeys[s.id], s.totalCount, enabledSources[s.id] === true) === 'active').length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-medium">情报源列表</span>
      </div>
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          已启用 <span className="font-medium text-foreground">{totalEnabled}</span> / {sources.length} 个情报源，
          活跃 <span className="font-medium text-green-600">{totalActive}</span> 个
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-[10px] h-6 gap-1 px-2 cursor-pointer transition-colors"
          onClick={onSyncAll}
          disabled={syncingSources.size > 0}
        >
          {syncingSources.size > 0 ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          全部同步
        </Button>
      </div>

      {loading && sources.every(s => s.totalCount === 0) ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          <span className="text-xs">加载情报源...</span>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground px-1 flex items-center gap-1">
              <Globe className="h-3 w-3" />
              免费/公开情报源 ({freeSources.length})
            </div>
            {freeSources.map(source => (
              <SourceCard
                key={source.id}
                source={source}
                enabled={enabledSources[source.id] ?? true}
                onToggle={onToggleSource}
                onSync={onSyncSource}
                syncing={syncingSources.has(source.id)}
                apiKeyStatus={apiKeys[source.id] ? 'configured' : 'none'}
              />
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground px-1 flex items-center gap-1">
              <Key className="h-3 w-3" />
              需API Key (批量+查询) ({apiKeySources.length})
            </div>
            {apiKeySources.map(source => (
              <SourceCard
                key={source.id}
                source={source}
                enabled={enabledSources[source.id] ?? true}
                onToggle={onToggleSource}
                onSync={onSyncSource}
                syncing={syncingSources.has(source.id)}
                apiKeyStatus={apiKeys[source.id] ? 'configured' : 'none'}
              />
            ))}
          </div>

          <div className="space-y-1">
            <div className="text-[10px] font-medium text-blue-600/80 px-1 flex items-center gap-1">
              <Shield className="h-3 w-3" />
              仅查询模式 (有调用频率限制) ({queryOnlySources.length})
            </div>
            {queryOnlySources.map(source => (
              <SourceCard
                key={source.id}
                source={source}
                enabled={enabledSources[source.id] ?? true}
                onToggle={onToggleSource}
                onSync={onSyncSource}
                syncing={syncingSources.has(source.id)}
                apiKeyStatus={apiKeys[source.id] ? 'configured' : 'none'}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
