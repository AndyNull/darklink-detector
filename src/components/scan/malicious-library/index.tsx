'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Shield,
  Search,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  Server,
  FileUp,
  Download,
  Globe,
  Hash,
  Trash2 as Trash2Icon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth, getAuthHeaders } from '@/lib/auth-context';
import { useDataSyncStore } from '@/lib/data-sync-store';
import { invalidateMaliciousCache, fetchMaliciousEntries } from '@/lib/api-client';
import { useEngineStatusStore } from '@/lib/engine-status-store';
import { MaliciousDomain, MaliciousIP } from './types';

// ──── Lazy-loaded sub-components ────

const AddEntryDialog = lazy(() =>
  import('./add-entry-dialog').then(mod => ({ default: mod.AddEntryDialog }))
);

const BatchImportDialog = lazy(() =>
  import('./batch-import-dialog').then(mod => ({ default: mod.BatchImportDialog }))
);

const DeleteConfirmDialog = lazy(() =>
  import('./delete-confirm-dialog').then(mod => ({ default: mod.DeleteConfirmDialog }))
);

const DomainTab = lazy(() =>
  import('./domain-tab').then(mod => ({ default: mod.DomainTab }))
);

const IpTab = lazy(() =>
  import('./ip-tab').then(mod => ({ default: mod.IpTab }))
);

const ThreatIntelSourcesTab = lazy(() =>
  import('./sources-tab').then(mod => ({ default: mod.ThreatIntelSourcesTab }))
);

// ──── Suspense fallback ────

function TabLoadingFallback() {
  return (
    <div className="flex items-center justify-center py-6 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
      <span className="text-xs">加载中...</span>
    </div>
  );
}

// ──── Main Component ────

export function MaliciousLibrary() {
  const { requireAuth, isAuthenticated } = useAuth();
  const dataSync = useDataSyncStore();
  const { maliciousStats } = dataSync;
  const lastMaliciousUpdate = useDataSyncStore(s => s.lastUpdated.maliciousStats);
  const dataSyncStatus = useEngineStatusStore((s) => s.dataSyncStatus);

  const [activeTab, setActiveTab] = useState<'domain' | 'ip' | 'sources'>('domain');
  const [search, setSearch] = useState('');
  const [domainEntries, setDomainEntries] = useState<MaliciousDomain[]>([]);
  const [ipEntries, setIpEntries] = useState<MaliciousIP[]>([]);
  const [domainTotal, setDomainTotal] = useState(0);
  const [ipTotal, setIpTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [domainPage, setDomainPage] = useState(1);
  const [ipPage, setIpPage] = useState(1);
  const PAGE_SIZE = 50;
  const domainTotalPages = Math.max(1, Math.ceil(domainTotal / PAGE_SIZE));
  const ipTotalPages = Math.max(1, Math.ceil(ipTotal / PAGE_SIZE));
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'domain' | 'ip' } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ──── Batch selection state ────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  // ──── Refs for current page values (avoids re-creating fetchEntries on page change) ────
  const domainPageRef = useRef(1);
  const ipPageRef = useRef(1);

  // Keep refs in sync with state
  useEffect(() => { domainPageRef.current = domainPage; }, [domainPage]);
  useEffect(() => { ipPageRef.current = ipPage; }, [ipPage]);

  // ──── Initialize data-sync store (with cleanup) ────
  useEffect(() => {
    if (!dataSync.initialized) {
      dataSync.init();
    }
    // Note: we don't destroy on unmount because other components may still
    // need the data-sync store. The store handles its own lifecycle.
  }, [dataSync]);

  // ──── Derived total count from store stats ────
  const wsTotalCount = (maliciousStats.domainCount > 0 || maliciousStats.ipCount > 0)
    ? maliciousStats.domainCount + maliciousStats.ipCount
    : 0;

  // ──── Source statistics ────
  const [sourceStats, setSourceStats] = useState<Record<string, number>>({});

  // Calculate source stats from entries
  useEffect(() => {
    const stats: Record<string, number> = {};
    const entries = activeTab === 'domain' ? domainEntries : ipEntries;
    for (const entry of entries) {
      stats[entry.source] = (stats[entry.source] || 0) + 1;
    }
    setSourceStats(stats);
  }, [domainEntries, ipEntries, activeTab]);

  // ──── In-flight request guard to prevent duplicate fetches ────
  const inflightRef = useRef<Set<string>>(new Set());

  // ──── Track whether each tab's current data was fetched with a search filter ────
  // This prevents re-fetching when switching tabs if data is already loaded (not filtered)
  const wasFilteredRef = useRef<Record<string, boolean>>({ domain: false, ip: false });

  // ──── Track which types have been loaded (pre-loaded or fetched) ────
  // This prevents the search/tab effect from re-fetching data that was already
  // loaded (avoids duplicate API requests)
  const loadedRef = useRef<Set<string>>(new Set());

  // ──── Track whether the component has done its initial load ────
  // Prevents re-fetching on tab switch before any data has been loaded
  const hasInitializedRef = useRef(false);

  // Fetch entries — always use REST API (no more Socket.io)
  const fetchEntries = useCallback(async (
    type: 'domain' | 'ip',
    searchQuery: string = '',
    explicitPage?: number,
    isBackgroundRefresh?: boolean,
  ) => {
    const isDomain = type === 'domain';
    const currentPage = explicitPage ?? (isDomain ? domainPageRef.current : ipPageRef.current);
    const page = Math.max(1, currentPage);

    // Deduplicate: skip if already in-flight for this exact request
    const fetchKey = `${type}:${page}:${searchQuery}`;
    if (inflightRef.current.has(fetchKey)) return;
    inflightRef.current.add(fetchKey);

    // Only show loading spinner on initial load, not background refreshes
    // Background refresh = data already exists for this type
    const hasData = isDomain ? domainEntries.length > 0 || domainTotal > 0 : ipEntries.length > 0 || ipTotal > 0;
    if (!isBackgroundRefresh || !hasData) {
      setLoading(true);
    }

    try {
      const data = await fetchMaliciousEntries({
        type,
        page,
        pageSize: PAGE_SIZE,
        search: searchQuery,
      });
      const items = data.items || [];
      const total = data.total || 0;

      if (isDomain) {
        setDomainEntries(items);
        setDomainTotal(total);
        setDomainPage(page);
      } else {
        setIpEntries(items);
        setIpTotal(total);
        setIpPage(page);
      }

      // Track whether this fetch was filtered (had a search query)
      wasFilteredRef.current[type] = !!searchQuery;
      // Mark this type as loaded
      loadedRef.current.add(type);
    } catch (err) {
      console.error('Failed to fetch malicious entries:', err);
    } finally {
      setLoading(false);
      inflightRef.current.delete(fetchKey);
    }
  // NOTE: domainEntries/ipEntries/domainTotal/ipTotal are intentionally NOT in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [PAGE_SIZE]);

  // Refresh entries when malicious stats are updated (e.g., after sync completes)
  // Skip if user has an active search — don't clear their search results
  useEffect(() => {
    if (lastMaliciousUpdate > 0) {
      // Don't auto-refresh if user is actively searching or viewing filtered results
      const isSearching = search.length > 0;
      const hasFilteredView = wasFilteredRef.current.domain || wasFilteredRef.current.ip;
      if (isSearching || hasFilteredView) return;

      fetchEntries('domain', '', undefined, true);
      fetchEntries('ip', '', undefined, true);
    }
  // NOTE: search is intentionally in deps so we react to its current value
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMaliciousUpdate, fetchEntries]);

  // Search with debounce & initial load — only for domain/ip tabs
  useEffect(() => {
    if (activeTab === 'sources') return; // Don't fetch on sources tab

    // If no search and data already loaded (not filtered), skip the fetch
    if (!search && !wasFilteredRef.current[activeTab]) {
      if (loadedRef.current.has(activeTab)) return;
    }

    const timer = setTimeout(() => {
      fetchEntries(activeTab, search);
      // Mark as initialized after first successful fetch
      if (!hasInitializedRef.current) {
        hasInitializedRef.current = true;
        // Also pre-load the other tab on first mount
        const otherTab = activeTab === 'domain' ? 'ip' : 'domain';
        if (!loadedRef.current.has(otherTab)) {
          fetchEntries(otherTab, '');
        }
      }
    }, search ? 300 : 0); // Immediate on tab change, debounce on search
    return () => clearTimeout(timer);
  // NOTE: domainEntries/ipEntries are intentionally NOT in deps — we only READ them
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeTab, fetchEntries]);

  // Tab change — just switch tab, don't re-fetch (the useEffect handles it)
  const handleTabChange = (value: string) => {
    const tab = value as 'domain' | 'ip' | 'sources';
    setActiveTab(tab);
    setSearch('');
    // No explicit fetchEntries call here — the search useEffect handles tab switches
    // It will skip the fetch if data is already loaded and not filtered
  };

  // Helper: invalidate caches and refresh after mutations
  const refreshAfterMutation = useCallback((type: 'domain' | 'ip') => {
    // Invalidate API client cache
    invalidateMaliciousCache();
    // Reset loaded tracking so re-fetches go through
    loadedRef.current.delete(type);
    const otherType = type === 'domain' ? 'ip' : 'domain';
    loadedRef.current.delete(otherType);
    // Re-fetch entries
    fetchEntries(type, '', 1);
    fetchEntries(otherType, '', 1);
    // Re-mark as loaded
    loadedRef.current.add(type);
    loadedRef.current.add(otherType);
    // Refresh stats
    dataSync.refreshMaliciousStats();
  }, [fetchEntries, dataSync]);

  // Delete handler
  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (!requireAuth(() => {})) return;

    setDeleting(true);
    try {
      const res = await fetch(
        `/api/malicious?type=${deleteTarget.type}&id=${deleteTarget.id}`,
        { method: 'DELETE', headers: getAuthHeaders() }
      );
      if (!res.ok) throw new Error('Failed to delete');

      refreshAfterMutation(deleteTarget.type);
      toast.success('删除成功');
    } catch (err) {
      console.error('Failed to delete entry:', err);
      toast.error('删除失败');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // ──── Batch delete handler ────
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!requireAuth(() => {})) return;
    setBatchDeleting(true);
    try {
      const type = activeTab as 'domain' | 'ip';
      const res = await fetch(`/api/malicious?action=batch&type=${type}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ type, ids: Array.from(selectedIds) }),
      });
      if (!res.ok) throw new Error('Batch delete failed');
      const count = selectedIds.size;
      setSelectedIds(new Set());
      setSelectionMode(false);
      refreshAfterMutation(type);
      toast.success(`已删除 ${count} 条记录`);
    } catch (err) {
      console.error('Batch delete failed:', err);
      toast.error('批量删除失败');
    } finally {
      setBatchDeleting(false);
      setBatchDeleteConfirmOpen(false);
    }
  };

  const handleSelectEntry = useCallback((id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Page navigation helper
  const goToPage = (page: number) => {
    const isDomain = activeTab === 'domain';
    const totalPages = isDomain ? domainTotalPages : ipTotalPages;
    const clamped = Math.max(1, Math.min(page, totalPages));
    if (activeTab === 'domain' || activeTab === 'ip') {
      fetchEntries(activeTab, search, clamped);
    }
  };

  // Export handler (requires authentication)
  const handleExport = async (format: 'json' | 'csv') => {
    if (!requireAuth(() => {})) return;
    const exportType = activeTab === 'ip' ? 'ip' : 'domain';
    setExporting(true);
    try {
      const res = await fetch(`/api/malicious?action=export&type=${exportType}&format=${format}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Export failed');

      let blob: Blob;
      let filename: string;
      const dateStr = new Date().toISOString().slice(0, 10);

      if (format === 'csv') {
        const text = await res.text();
        blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
        filename = `malicious_${exportType}s_${dateStr}.csv`;
      } else {
        const data = await res.json();
        const text = JSON.stringify(data, null, 2);
        blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        filename = `malicious_${exportType}s_${dateStr}.json`;
      }

      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('导出成功');
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header — title + total count */}
      <div className="h-10 px-3 border-b flex items-center gap-2 shrink-0">
        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">恶意库</span>
        <Badge variant="outline" className="text-[9px] px-1 py-0 ml-0.5">
          {wsTotalCount > 0 ? wsTotalCount : domainTotal + ipTotal}
        </Badge>
      </div>

      {/* Controls row */}
      <div className="px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
          <div className={`relative ${isAuthenticated ? 'w-[120px] sm:w-[160px]' : 'flex-1'} shrink-0`}>
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="搜索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { fetchEntries(activeTab, search); } }}
              className="h-7 w-full text-[11px] pl-6"
            />
          </div>
          {/* Search button — always visible, compact sizing */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1 px-1.5 shrink-0"
            onClick={() => fetchEntries(activeTab, search)}
          >
            <Search className="h-3 w-3" />
            {!isAuthenticated && '搜索'}
          </Button>
          {isAuthenticated && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1 px-2 shrink-0"
              onClick={() => setBatchDialogOpen(true)}
            >
              <FileUp className="h-3 w-3" />
              导入
            </Button>
          )}
          {isAuthenticated && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1 px-2 shrink-0"
                  disabled={exporting}
                >
                  {exporting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  导出
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport('json')}>
                  <Download className="h-3 w-3 mr-1.5" />
                  导出JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('csv')}>
                  <Download className="h-3 w-3 mr-1.5" />
                  导出CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isAuthenticated && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1 px-2 shrink-0"
              onClick={() => setAddDialogOpen(true)}
            >
              <Plus className="h-3 w-3" />
              添加
            </Button>
          )}
          {/* Batch select toggle - auth required */}
          {isAuthenticated && activeTab !== 'sources' && (
            <Button
              variant={selectionMode ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-[11px] gap-1 px-2 shrink-0"
              onClick={() => {
                setSelectionMode(!selectionMode);
                setSelectedIds(new Set());
              }}
            >
              <Hash className="h-3 w-3" />
              {selectionMode ? '取消' : '批量'}
            </Button>
          )}
          {/* Batch delete button */}
          {selectionMode && selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-[11px] gap-1 px-2 shrink-0"
              onClick={() => setBatchDeleteConfirmOpen(true)}
              disabled={batchDeleting}
            >
              {batchDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2Icon className="h-3 w-3" />}
              删除({selectedIds.size})
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex-1 flex flex-col min-h-0"
      >
        {/* Reserve scrollbar-width (4px) right padding so tab buttons align with content edges below */}
        <TabsList className="w-full h-8 shrink-0 pl-3 pr-[16px] pt-1 bg-transparent gap-1">
          <TabsTrigger value="domain" className="text-[11px] h-7 px-2.5 gap-1 min-w-0 data-[state=active]:bg-blue-500/10 data-[state=active]:text-blue-600 hover:bg-muted/50 transition-colors cursor-pointer [&[data-state=active]_.tab-badge]:!bg-muted/50 [&[data-state=active]_.tab-badge]:!text-muted-foreground">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">域名</span>
            <Badge variant="secondary" className="tab-badge text-[8px] px-1 py-0 h-4 min-w-[16px] justify-center tabular-nums bg-muted/50 text-muted-foreground">{domainTotal}</Badge>
          </TabsTrigger>
          <TabsTrigger value="ip" className="text-[11px] h-7 px-2.5 gap-1 min-w-0 data-[state=active]:bg-orange-500/10 data-[state=active]:text-orange-600 hover:bg-muted/50 transition-colors cursor-pointer [&[data-state=active]_.tab-badge]:!bg-muted/50 [&[data-state=active]_.tab-badge]:!text-muted-foreground">
            <Server className="h-3 w-3 shrink-0" />
            <span className="truncate">IP</span>
            <Badge variant="secondary" className="tab-badge text-[8px] px-1 py-0 h-4 min-w-[16px] justify-center tabular-nums bg-muted/50 text-muted-foreground">{ipTotal}</Badge>
          </TabsTrigger>
          <TabsTrigger value="sources" className="text-[11px] h-7 px-2.5 gap-1 min-w-0 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-600 hover:bg-muted/50 transition-colors cursor-pointer">
            <Shield className="h-3 w-3 shrink-0" />
            <span className="truncate">情报源</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="domain" className="flex-1 min-h-0 mt-0 flex flex-col">
          <Suspense fallback={<TabLoadingFallback />}>
            <DomainTab
              entries={domainEntries}
              total={domainTotal}
              page={domainPage}
              totalPages={domainTotalPages}
              pageSize={PAGE_SIZE}
              loading={loading}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onSelectEntry={handleSelectEntry}
              onDelete={(id) => { setDeleteTarget({ id, type: 'domain' }); }}
              deleting={deleting}
              deleteTargetId={deleteTarget?.id ?? null}
              showDelete={isAuthenticated}
              onGoToPage={goToPage}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="ip" className="flex-1 min-h-0 mt-0 flex flex-col">
          <Suspense fallback={<TabLoadingFallback />}>
            <IpTab
              entries={ipEntries}
              total={ipTotal}
              page={ipPage}
              totalPages={ipTotalPages}
              pageSize={PAGE_SIZE}
              loading={loading}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onSelectEntry={handleSelectEntry}
              onDelete={(id) => { setDeleteTarget({ id, type: 'ip' }); }}
              deleting={deleting}
              deleteTargetId={deleteTarget?.id ?? null}
              showDelete={isAuthenticated}
              onGoToPage={goToPage}
            />
          </Suspense>
        </TabsContent>

        {/* Sources tab — show threat intel data sources */}
        <TabsContent value="sources" className="flex-1 min-h-0 mt-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-3 custom-scrollbar">
            <Suspense fallback={<TabLoadingFallback />}>
              <ThreatIntelSourcesTab
                domainTotal={domainTotal}
                ipTotal={ipTotal}
                onRefresh={() => {
                  invalidateMaliciousCache();
                  fetchEntries('domain');
                  fetchEntries('ip');
                }}
              />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>

      {/* Lazy-loaded Dialogs */}
      <Suspense fallback={null}>
        <AddEntryDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          type={activeTab === 'ip' ? 'ip' : 'domain'}
          onAdded={() => {
            refreshAfterMutation(activeTab === 'ip' ? 'ip' : 'domain');
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <BatchImportDialog
          open={batchDialogOpen}
          onOpenChange={setBatchDialogOpen}
          type={activeTab === 'ip' ? 'ip' : 'domain'}
          onAdded={() => {
            refreshAfterMutation(activeTab === 'ip' ? 'ip' : 'domain');
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <DeleteConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          onConfirm={handleDelete}
          deleting={deleting}
        />
      </Suspense>

      {/* Batch Delete Confirmation Dialog (inline — small enough) */}
      <Dialog open={batchDeleteConfirmOpen} onOpenChange={setBatchDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[320px] p-4 gap-3">
          <DialogHeader className="pb-0">
            <DialogTitle className="text-sm flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              批量删除确认
            </DialogTitle>
            <DialogDescription className="text-[10px]">
              确定要删除选中的 {selectedIds.size} 条记录吗？此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-1.5 pt-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setBatchDeleteConfirmOpen(false)}
              disabled={batchDeleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="text-xs"
              onClick={handleBatchDelete}
              disabled={batchDeleting}
            >
              {batchDeleting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              删除 {selectedIds.size} 条
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
