'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Globe, Server, Trash2, Loader2 } from 'lucide-react';
import {
  MaliciousEntry,
  MaliciousDomain,
  MaliciousIP,
  severityLabels,
  categoryLabels,
  sourceLabels,
} from './types';

export const EntryCard = React.memo(function EntryCard({
  entry,
  type,
  onDelete,
  deleting,
  selected,
  onSelect,
  selectionMode,
  showDelete,
}: {
  entry: MaliciousEntry;
  type: 'domain' | 'ip';
  onDelete: (id: string) => void;
  deleting: boolean;
  selected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
  selectionMode?: boolean;
  showDelete?: boolean;
}) {
  const value = type === 'domain' ? (entry as MaliciousDomain).domain : (entry as MaliciousIP).ip;
  const severity = entry.severity || 'high';

  const dotColors: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-emerald-500',
  };

  return (
    <div className={`rounded border px-2 py-1 transition-all duration-150 ease-out group cursor-default ${selected ? 'bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-accent/40 active:bg-accent/60'}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        {/* Selection checkbox */}
        {selectionMode && onSelect && (
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelect(entry.id, !!checked)}
            className="h-3 w-3 shrink-0"
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {/* Severity dot */}
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[severity] || 'bg-gray-400'}`} title={severityLabels[severity] || severity} />

        {/* Domain/IP value */}
        {type === 'domain' ? (
          <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <Server className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <span className="text-[11px] font-mono font-semibold truncate" title={value}>
          {value}
        </span>

        {/* Category badge */}
        {entry.category && (
          <Badge variant="outline" className="text-[8px] px-1 py-0 shrink-0">
            {categoryLabels[entry.category] || entry.category}
          </Badge>
        )}

        {/* Source badge */}
        <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground shrink-0">
          {sourceLabels[entry.source] || entry.source}
        </Badge>

        {/* Delete button - only show when authenticated */}
        {showDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-4 w-4 p-0 ml-auto shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
            onClick={() => onDelete(entry.id)}
            disabled={deleting}
            aria-label="删除"
          >
            {deleting ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <Trash2 className="h-2.5 w-2.5" />
            )}
          </Button>
        )}
      </div>

      {/* Reason - second row, only if present */}
      {entry.reason && (
        <div className="text-[9px] text-muted-foreground truncate mt-0.5 pl-5" title={entry.reason}>
          {entry.reason}
        </div>
      )}
    </div>
  );
});
