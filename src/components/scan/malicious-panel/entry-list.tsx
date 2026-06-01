'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Trash2,
  Search,
  Loader2,
  Globe,
  MapPin,
  ToggleLeft,
  ToggleRight,
  ShieldAlert,
  X,
} from 'lucide-react';
import { MaliciousEntry, severityColors, severityLabels, sourceLabels } from './types';

interface EntryListProps {
  entries: MaliciousEntry[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  deletingId: string | null;
  onToggleActive: (entry: MaliciousEntry) => void;
  onDelete: (id: string) => void;
  onBatchDelete: () => void;
  batchDeleting: boolean;
  onClearSelection: () => void;
}

export function EntryList({
  entries,
  loading,
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  deletingId,
  onToggleActive,
  onDelete,
  onBatchDelete,
  batchDeleting,
  onClearSelection,
}: EntryListProps) {
  return (
    <>
      {/* Batch delete bar */}
      {selectedIds.size > 0 && (
        <div className="px-3 py-1 border-b bg-destructive/5 flex items-center gap-2 shrink-0">
          <Checkbox
            checked={selectedIds.size === entries.length}
            onCheckedChange={onToggleSelectAll}
            className="h-3.5 w-3.5"
          />
          <span className="text-[10px] font-medium text-destructive">
            已选择 {selectedIds.size} 项
          </span>
          <Button
            variant="destructive"
            size="sm"
            className="h-6 text-[10px] px-2 ml-auto gap-1"
            onClick={onBatchDelete}
            disabled={batchDeleting}
          >
            {batchDeleting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            批量删除
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={onClearSelection}
          >
            <X className="h-3 w-3" />
            取消
          </Button>
        </div>
      )}

      {/* Filter bar */}
      <div className="px-3 py-1.5 border-b flex items-center gap-1.5 shrink-0">
        {selectedIds.size === 0 && (
          <Checkbox
            checked={false}
            onCheckedChange={onToggleSelectAll}
            className="h-3.5 w-3.5"
            title="全选"
          />
        )}
        <div className="relative flex-1">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="搜索IP或域名..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-7 text-[10px] pl-6"
          />
        </div>
        <Select value={typeFilter} onValueChange={onTypeFilterChange}>
          <SelectTrigger size="sm" className="w-[70px] text-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="ip">IP</SelectItem>
            <SelectItem value="domain">域名</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-xs text-muted-foreground">加载中...</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-xs">
            <ShieldAlert className="h-6 w-6 mx-auto mb-2 opacity-20" />
            <p>暂无恶意条目</p>
            <p className="text-[10px] mt-1">可通过扫描结果、手动添加或批量导入</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={`group rounded-md border px-2.5 py-1.5 transition-all duration-150 ease-out ${
                  selectedIds.has(entry.id) ? 'ring-1 ring-primary/40 bg-primary/5' :
                  !entry.isActive ? 'opacity-50 bg-muted/30' : 'bg-card hover:bg-accent/40 active:bg-accent/60'
                }`}
              >
                {/* Row 1: Checkbox + Type icon + Value + Actions */}
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    checked={selectedIds.has(entry.id)}
                    onCheckedChange={() => onToggleSelect(entry.id)}
                    className="h-3.5 w-3.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  />
                  {entry.type === 'ip' ? (
                    <MapPin className="h-3 w-3 text-orange-500 shrink-0" />
                  ) : (
                    <Globe className="h-3 w-3 text-blue-500 shrink-0" />
                  )}
                  <span className="text-[11px] font-mono truncate flex-1" title={entry.value}>
                    {entry.value}
                  </span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-muted-foreground"
                      onClick={() => onToggleActive(entry)}
                      title={entry.isActive ? '禁用' : '启用'}
                      aria-label={entry.isActive ? '禁用' : '启用'}
                    >
                      {entry.isActive ? (
                        <ToggleRight className="h-3 w-3 text-green-600" />
                      ) : (
                        <ToggleLeft className="h-3 w-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(entry.id)}
                      disabled={deletingId === entry.id}
                      title="删除"
                      aria-label="删除"
                    >
                      {deletingId === entry.id ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-2.5 w-2.5" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Row 2: Badges */}
                <div className="flex items-center gap-1 mt-0.5 ml-5">
                  <Badge className={`text-[8px] px-1 py-0 ${severityColors[entry.severity] || ''}`}>
                    {severityLabels[entry.severity] || entry.severity}
                  </Badge>
                  <Badge variant="outline" className="text-[8px] px-1 py-0">
                    {sourceLabels[entry.source] || entry.source}
                  </Badge>
                  {entry.type === 'ip' ? (
                    <Badge variant="outline" className="text-[8px] px-1 py-0">IP</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[8px] px-1 py-0">域名</Badge>
                  )}
                  {entry.tags && (
                    <span className="text-[8px] text-muted-foreground truncate">
                      {entry.tags}
                    </span>
                  )}
                </div>

                {/* Row 3: Reason (if any) */}
                {entry.reason && (
                  <div className="text-[9px] text-muted-foreground mt-0.5 ml-5 truncate" title={entry.reason}>
                    {entry.reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
