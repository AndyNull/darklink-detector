'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { MaliciousIP } from './types';
import { EntryCard } from './entry-card';
import { EmptyState } from './empty-state';
import { PaginationBar } from './pagination-bar';

export function IpTab({
  entries,
  total,
  page,
  totalPages,
  pageSize,
  loading,
  selectionMode,
  selectedIds,
  onSelectEntry,
  onDelete,
  deleting,
  deleteTargetId,
  showDelete,
  onGoToPage,
}: {
  entries: MaliciousIP[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  loading: boolean;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onSelectEntry: (id: string, checked: boolean) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
  deleteTargetId: string | null;
  showDelete: boolean;
  onGoToPage: (page: number) => void;
}) {
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 custom-scrollbar">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            <span className="text-xs">加载中...</span>
          </div>
        ) : entries.length === 0 ? (
          <EmptyState type="ip" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
            {entries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                type="ip"
                onDelete={onDelete}
                deleting={deleting && deleteTargetId === entry.id}
                selected={selectedIds.has(entry.id)}
                onSelect={onSelectEntry}
                selectionMode={selectionMode}
                showDelete={showDelete}
              />
            ))}
          </div>
        )}
      </div>
      {total > 0 && (
        <PaginationBar
          current={page}
          total={totalPages}
          totalCount={total}
          pageSize={pageSize}
          loading={loading}
          onGoTo={onGoToPage}
        />
      )}
    </>
  );
}
